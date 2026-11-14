// 球员照片专用临时缓存；与头像缓存隔离，不删除系统选图文件。
const LIMIT = 32 * 1024 * 1024;
const IMAGE_LIMIT = 2 * 1024 * 1024;
const FILE = /^photo-\d+-\d+\.(png|jpeg)$/;
const scopes = new Set();
const files = new Map();
let sequence = 0;
let bytes = 0;
let unknownDiskUsage = false;
function target() {
  try {
    if (typeof wx === "undefined" || !wx.env?.USER_DATA_PATH || typeof wx.getFileSystemManager !== "function") return null;
    return { fs: wx.getFileSystemManager(), dir: wx.env.USER_DATA_PATH + "/football-player-photo-images" };
  } catch (_) { return null; }
}
function parse(value) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(IMAGE_LIMIT / 3) * 4 + 32
  )
    return null;
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!match) return null;
  const encoded = match[2];
  if (encoded.length % 4 !== 0) return null;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const length = (encoded.length / 4) * 3 - padding;
  if (!length || length > IMAGE_LIMIT) return null;
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (
    padding &&
    alphabet.indexOf(encoded[encoded.length - padding - 1]) &
      (padding === 2 ? 15 : 3)
  )
    return null;
  if (
    match[1] === "png"
      ? !encoded.startsWith("iVBORw0KGgo")
      : !encoded.startsWith("/9j/")
  )
    return null;
  return { extension: match[1], encoded, bytes: length };
}
function unlink(entry) {
  const t = target();
  if (!t || !FILE.test(entry.name) || entry.path !== t.dir + "/" + entry.name)
    return false;
  try {
    t.fs.unlinkSync(entry.path);
  } catch (error) {
    // 已不存在可释放占用；其他错误保守保留，供下次重试。
    if (
      !/ENOENT|no such file|not exist/i.test(
        String(error?.errMsg || error?.message || error),
      )
    )
      return false;
  }
  if (files.delete(entry.path)) bytes -= entry.bytes;
  return true;
}
function rejectUnknown(entry) {
  unknownDiskUsage = true;
  entry.released = true;
  entry.bytes = 0;
  entry.unknown = true;
  files.set(entry.path, entry);
  unlink(entry);
}
function retryReleased() {
  for (const entry of files.values()) if (entry.released) unlink(entry);
}
function createScope() {
  retryReleased();
  const scope = { active: true, entries: new Map() };
  scopes.add(scope);
  return scope;
}
function put(scope, photoId, value) {
  if (
    !scopes.has(scope) ||
    !scope.active ||
    !["string", "number"].includes(typeof photoId)
  )
    return "";
  const id = String(photoId);
  if (!id || id.length > 200) return "";
  const data = parse(value);
  if (!data) return "";
  // 照片内容在服务端不可就地替换；同一ID复用文件，说明/排序不重复写图。
  const previous = scope.entries.get(id);
  if (previous) return previous.path;
  retryReleased();
  if (unknownDiskUsage || bytes + data.bytes > LIMIT) return "";
  const t = target();
  if (!t) return "";
  const name = "photo-" + Date.now() + "-" + ++sequence + "." + data.extension;
  const entry = {
    name,
    path: t.dir + "/" + name,
    bytes: data.bytes,
    released: false,
  };
  try {
    try {
      t.fs.mkdirSync(t.dir, true);
    } catch (_) {
      /* 已存在时继续写入 */
    }
    t.fs.writeFileSync(entry.path, data.encoded, "base64");
    const size = t.fs.statSync(entry.path).size;
    if (!Number.isSafeInteger(size) || size !== data.bytes)
      throw new Error("缓存字节数不符");
    files.set(entry.path, entry);
    bytes += size;
    scope.entries.set(id, entry);
    return entry.path;
  } catch (_) {
    // 写入可能留下部分文件，只按实际已落盘大小计数并尝试清除。
    try {
      const size = t.fs.statSync(entry.path).size;
      if (Number.isSafeInteger(size) && size >= 0) {
        entry.bytes = size;
        entry.released = true;
        files.set(entry.path, entry);
        bytes += size;
        unlink(entry);
      } else rejectUnknown(entry);
    } catch (error) {
      if (
        !/ENOENT|no such file|not exist/i.test(
          String(error?.errMsg || error?.message || error),
        )
      ) {
        entry.released = true;
        if (!files.has(entry.path)) {
          files.set(entry.path, entry);
          bytes += entry.bytes;
        }
        unlink(entry);
      }
    }
    return "";
  }
}
function remove(scope, photoId) {
  if (!scopes.has(scope) || !scope.active) return false;
  const entry = scope.entries.get(String(photoId));
  if (!entry) return true;
  scope.entries.delete(String(photoId));
  entry.released = true;
  return unlink(entry);
}
function dispose(scope) {
  if (!scopes.has(scope)) return;
  scope.active = false;
  scopes.delete(scope);
  for (const entry of scope.entries.values()) {
    entry.released = true;
    unlink(entry);
  }
  scope.entries.clear();
  retryReleased();
}
function clearAll() {
  unknownDiskUsage = false;
  for (const scope of [...scopes]) dispose(scope);
  retryReleased();
  const t = target();
  if (!t) return;
  // 专用目录中符合本模块命名格式的遗留文件；不跟随目录或其他路径。
  try {
    for (const name of t.fs.readdirSync(t.dir)) {
      if (!FILE.test(name)) continue;
      const path = t.dir + "/" + name;
      if (files.has(path)) {
        if (files.get(path).unknown) unknownDiskUsage = true;
        continue;
      }
      try {
        const stat = t.fs.statSync(path);
        if (typeof stat.isFile === "function" && !stat.isFile()) continue;
        if (!Number.isSafeInteger(stat.size) || stat.size < 0) {
          rejectUnknown({ name, path });
          continue;
        }
        const entry = { name, path, bytes: stat.size, released: true };
        files.set(path, entry);
        bytes += stat.size;
        unlink(entry);
      } catch (_) {
        unknownDiskUsage = true; /* 无法确认占用时拒绝新增缓存 */
      }
    }
  } catch (error) {
    if (
      !/ENOENT|no such file|not exist/i.test(
        String(error?.errMsg || error?.message || error),
      )
    )
      unknownDiskUsage = true;
  }
}
module.exports = { createScope, put, remove, dispose, clearAll };
