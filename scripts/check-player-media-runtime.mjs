// 在最终生产镜像内运行；只用内存合成图片，不打开数据库、不访问网络。
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { sanitizePlayerPhoto } from "../server/player-media-store.mjs";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const sharp = require("sharp");
const input = await sharp({
  create: {
    width: 4,
    height: 4,
    channels: 4,
    background: { r: 80, g: 0, b: 120, alpha: 0 },
  },
}).png().toBuffer();
const result = await sanitizePlayerPhoto(`data:image/png;base64,${input.toString("base64")}`);
assert.equal(result.mimeType, "image/jpeg");
assert.equal(result.width, 4);
assert.equal(result.height, 4);
const output = Buffer.from(result.dataUrl.split(",")[1], "base64");
assert.equal(output.length, result.byteSize);
const metadata = await sharp(output).metadata();
assert.equal(metadata.format, "jpeg");
assert.equal(metadata.exif, undefined);
assert.equal(metadata.icc, undefined);
const pixels = await sharp(output).removeAlpha().raw().toBuffer();
assert.ok(pixels.every((value) => value >= 250), "透明照片应转换为白底");
console.log("球员照片生产运行时检查通过：完整解码、白底重编码、无原始元数据。");
