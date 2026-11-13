import { inflateSync } from "node:zlib";
import { FootballError } from "./football-store.mjs";

export const MAX_MATCH_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_MATCH_PHOTO_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_MATCH_PHOTOS = 10;
const MAX_PIXELS = 16_000_000;
const invalid = () => {
  throw new FootballError(
    400,
    "照片须为有效的静态 PNG、JPEG、WebP 或 GIF，单张最多 2 MiB，尺寸不超过 1600 万像素。",
  );
};
function dimensions(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > MAX_PIXELS
  )
    invalid();
}
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(bytes) {
  if (
    bytes.length < 45 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    invalid();
  let at = 8,
    header = false,
    end = false;
  const compressed = [];
  while (at + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(at),
      next = at + 12 + size;
    if (next > bytes.length) invalid();
    const type = bytes.toString("ascii", at + 4, at + 8);
    if (crc(bytes.subarray(at + 4, next - 4)) !== bytes.readUInt32BE(next - 4))
      invalid();
    if (!header) {
      if (type !== "IHDR" || size !== 13) invalid();
      dimensions(bytes.readUInt32BE(at + 8), bytes.readUInt32BE(at + 12));
      if (
        ![1, 2, 4, 8, 16].includes(bytes[at + 16]) ||
        ![0, 2, 3, 4, 6].includes(bytes[at + 17]) ||
        bytes[at + 18] !== 0 ||
        bytes[at + 19] !== 0 ||
        bytes[at + 20] > 1
      )
        invalid();
      header = true;
    } else if (type === "IHDR") invalid();
    if (["acTL", "fcTL", "fdAT"].includes(type)) invalid();
    if (type === "IDAT") compressed.push(bytes.subarray(at + 8, next - 4));
    if (type === "IEND") {
      if (size !== 0 || next !== bytes.length) invalid();
      end = true;
    }
    at = next;
  }
  if (!end || !compressed.length || at !== bytes.length) invalid();
  try {
    if (
      !inflateSync(Buffer.concat(compressed), {
        maxOutputLength: 64 * 1024 * 1024,
      }).length
    )
      invalid();
  } catch {
    invalid();
  }
}
function jpeg(bytes) {
  if (
    bytes.length < 12 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  )
    invalid();
  let at = 2,
    frame = false,
    scan = false;
  while (at < bytes.length - 2) {
    if (bytes[at++] !== 255) invalid();
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 0 || marker === 216 || marker === 217) invalid();
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (at + 2 > bytes.length) invalid();
    const size = bytes.readUInt16BE(at);
    if (size < 2 || at + size > bytes.length - 2) invalid();
    if (
      [
        192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
      ].includes(marker)
    ) {
      if (size < 8) invalid();
      dimensions(bytes.readUInt16BE(at + 5), bytes.readUInt16BE(at + 3));
      frame = true;
    }
    at += size;
    if (marker === 218) {
      scan = true;
      while (at < bytes.length - 2) {
        if (bytes[at] !== 255) {
          at++;
          continue;
        }
        if (
          bytes[at + 1] === 0 ||
          (bytes[at + 1] >= 208 && bytes[at + 1] <= 215)
        ) {
          at += 2;
          continue;
        }
        break;
      }
    }
  }
  if (!frame || !scan || at !== bytes.length - 2) invalid();
}
function webp(bytes) {
  if (
    bytes.length < 26 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) !== bytes.length - 8
  )
    invalid();
  let at = 12,
    image = false;
  while (at + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", at, at + 4),
      size = bytes.readUInt32LE(at + 4),
      p = at + 8;
    if (p + size > bytes.length) invalid();
    if (kind === "VP8X") {
      if (size !== 10) invalid();
      dimensions(
        1 + bytes.readUIntLE(p + 4, 3),
        1 + bytes.readUIntLE(p + 7, 3),
      );
    }
    if (kind === "VP8 ") {
      if (size < 10 || bytes.toString("hex", p + 3, p + 6) !== "9d012a")
        invalid();
      dimensions(
        bytes.readUInt16LE(p + 6) & 16383,
        bytes.readUInt16LE(p + 8) & 16383,
      );
      image = true;
    }
    if (kind === "VP8L") {
      if (size < 5 || bytes[p] !== 47) invalid();
      const bits = bytes.readUInt32LE(p + 1);
      dimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1);
      image = true;
    }
    // Albums are static images; animated containers can multiply decoder memory.
    if (kind === "ANIM" || kind === "ANMF") invalid();
    at = p + size + (size % 2);
  }
  if (!image || at !== bytes.length) invalid();
}
// libvips deliberately recovers some truncated GIF streams. Require an actual
// LZW end code and exactly the declared pixel count before trusting that recovery.
function gifPixels(data, minimum, expected, paletteSize) {
  if (!data.length) invalid();
  const clear = 1 << minimum,
    end = clear + 1;
  const lengths = new Uint32Array(4096);
  for (let code = 0; code < clear; code++) lengths[code] = 1;
  let bits = minimum + 1,
    next = end + 1,
    previous = -1,
    offset = 0,
    pixels = 0;
  while (offset + bits <= data.length * 8) {
    let code = 0;
    for (let bit = 0; bit < bits; bit++, offset++)
      code |= ((data[offset >>> 3] >>> (offset & 7)) & 1) << bit;
    if (code === clear) {
      bits = minimum + 1;
      next = end + 1;
      previous = -1;
      continue;
    }
    if (code === end) {
      if (pixels !== expected) invalid();
      return;
    }
    if (code < clear && code >= paletteSize) invalid();
    let length;
    if (code < next) length = lengths[code];
    else if (code === next && previous !== -1) length = lengths[previous] + 1;
    else invalid();
    pixels += length;
    if (!length || pixels > expected) invalid();
    if (previous !== -1 && next < 4096) {
      lengths[next++] = lengths[previous] + 1;
      if (next === 1 << bits && bits < 12) bits++;
    }
    previous = code;
  }
  invalid();
}
function gif(bytes) {
  if (
    bytes.length < 14 ||
    !["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) ||
    bytes.at(-1) !== 59
  )
    invalid();
  const canvasWidth = bytes.readUInt16LE(6),
    canvasHeight = bytes.readUInt16LE(8);
  dimensions(canvasWidth, canvasHeight);
  const globalPalette = bytes[10] & 128 ? 2 ** ((bytes[10] & 7) + 1) : 0;
  let at = 13 + 3 * globalPalette,
    images = 0;
  function blocks() {
    const parts = [];
    while (at < bytes.length) {
      const n = bytes[at++];
      if (!n) return Buffer.concat(parts);
      if (at + n > bytes.length) invalid();
      parts.push(bytes.subarray(at, at + n));
      at += n;
    }
    invalid();
  }
  while (at < bytes.length - 1) {
    const kind = bytes[at++];
    if (kind === 33) {
      at++;
      blocks();
    } else if (kind === 44) {
      if (at + 9 >= bytes.length) invalid();
      const width = bytes.readUInt16LE(at + 4),
        height = bytes.readUInt16LE(at + 6);
      dimensions(width, height);
      if (
        bytes.readUInt16LE(at) + width > canvasWidth ||
        bytes.readUInt16LE(at + 2) + height > canvasHeight
      )
        invalid();
      const packed = bytes[at + 8],
        localPalette = packed & 128 ? 2 ** ((packed & 7) + 1) : 0;
      if (!localPalette && !globalPalette) invalid();
      at += 9 + 3 * localPalette;
      const minimum = bytes[at++];
      if (minimum < 2 || minimum > 8) invalid();
      gifPixels(
        blocks(),
        minimum,
        width * height,
        localPalette || globalPalette,
      );
      if (++images > 1) invalid();
    } else invalid();
  }
  if (!images || at !== bytes.length - 1) invalid();
}
// Synchronous size/container preflight only. HTTP uploads must additionally pass
// validateMatchPhotoUploads full pixel decoding before entering the transaction.
export function validateMatchPhoto(value) {
  if (
    typeof value !== "string" ||
    value.length > 4 * Math.ceil(MAX_MATCH_PHOTO_BYTES / 3) + 40
  )
    invalid();
  const match =
    /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match) invalid();
  const bytes = Buffer.from(match[2], "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_MATCH_PHOTO_BYTES ||
    bytes.toString("base64") !== match[2]
  )
    invalid();
  try {
    ({ png, jpeg, webp, gif })[match[1]](bytes);
  } catch {
    invalid();
  }
  return { mime: `image/${match[1]}`, bytes };
}
