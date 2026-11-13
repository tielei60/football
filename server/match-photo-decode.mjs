import { createRequire } from "node:module";
import { FootballError } from "./football-store.mjs";
import {
  validateMatchPhoto,
  MAX_MATCH_PHOTOS,
  MAX_MATCH_PHOTO_TOTAL_BYTES,
} from "./match-images.mjs";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const sharp = require("sharp");
const invalid = () => {
  throw new FootballError(
    400,
    "照片无法完整读取。请使用有效的静态 PNG、JPEG、WebP 或 GIF 图片，最多 1600 万像素。",
  );
};

// Public uploads need full pixel decoding, not just the synchronous container
// checks used by the internal store/seed API. Only in-memory validated bytes are
// passed to sharp: never a path, URL, user-supplied loader option, or remote input.
export async function validateMatchPhotoUploads(input) {
  if (
    !input ||
    typeof input !== "object" ||
    !Array.isArray(input.photos) ||
    input.photos.length > MAX_MATCH_PHOTOS
  )
    throw new FootballError(400, "每场比赛最多保存 10 张照片。");
  let uploadedBytes = 0;
  // Decode sequentially: a single 16MP RGBA result is at most 64MB. Do not retain
  // decoded buffers across photos. Original validated bytes are stored unchanged.
  for (const photo of input.photos) {
    if (!photo || typeof photo !== "object" || Array.isArray(photo)) invalid();
    if (photo.data === undefined) continue; // The transaction validates retained IDs.
    const { mime, bytes } = validateMatchPhoto(photo.data);
    uploadedBytes += bytes.length;
    if (uploadedBytes > MAX_MATCH_PHOTO_TOTAL_BYTES)
      throw new FootballError(413, "单场照片总量不能超过 16 MiB。");
    try {
      const image = sharp(bytes, {
        failOn: "warning",
        limitInputPixels: 16_000_000,
        sequentialRead: true,
        pages: 1,
      }).timeout({ seconds: 5 });
      const metadata = await image.metadata();
      if (
        metadata.format !== mime.slice("image/".length) ||
        (metadata.pages ?? 1) !== 1 ||
        !metadata.width ||
        !metadata.height ||
        metadata.width > 16384 ||
        metadata.height > 16384 ||
        metadata.width * metadata.height > 16_000_000
      )
        invalid();
      const decoded = await image
        .toColourspace("srgb")
        .ensureAlpha()
        .raw({ depth: "uchar" })
        .toBuffer({ resolveWithObject: true });
      if (
        decoded.info.width !== metadata.width ||
        decoded.info.height !== metadata.height ||
        decoded.info.channels !== 4 ||
        decoded.data.length !== metadata.width * metadata.height * 4
      )
        invalid();
    } catch {
      invalid();
    }
  }
}
