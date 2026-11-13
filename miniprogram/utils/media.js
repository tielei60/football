// Private, recoverable image cache. Never send large base64 strings through setData.
const config = require('../config');
let entries = new Map();
let sequence = 0;
let cachedBytes = 0;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const NAME = /^img-[0-9]+-[0-9]+\.(png|jpeg|webp|gif)$/;
function location() {
  if (typeof wx === 'undefined' || !wx.env || !wx.env.USER_DATA_PATH || typeof wx.getFileSystemManager !== 'function') return null;
  return { fs: wx.getFileSystemManager(), directory: wx.env.USER_DATA_PATH + '/football-native-images' };
}
function imageSource(value) {
  if (typeof value !== 'string') return '';
  const data = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (data) {
    if (entries.has(value)) return entries.get(value);
    const bytes = data[2].length * 3 / 4;
    if (bytes > 2 * 1024 * 1024 + 2 || bytes + cachedBytes > MAX_CACHE_BYTES) return '';
    const target = location(); if (!target) return '';
    try {
      try { target.fs.mkdirSync(target.directory, true); } catch (_) { /* existing directory */ }
      const path = target.directory + '/img-' + Date.now() + '-' + (++sequence) + '.' + data[1];
      target.fs.writeFileSync(path, data[2], 'base64');
      entries.set(value, path); cachedBytes += bytes;
      return path;
    } catch (_) { return ''; } // Native image placeholder stays available if disk is full.
  }
  if (!/^\/(?!\/)[A-Za-z0-9_./-]+$/.test(value) || value.includes('..')) return '';
  const base = String(config.apiBaseUrl || '').replace(/\/$/, '');
  const secure = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base);
  const local = config.allowLocalHttp === true && /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/.test(base);
  return secure || local ? base + value : '';
}
function clearImageCache() {
  entries = new Map(); cachedBytes = 0;
  const target = location(); if (!target) return;
  try {
    for (const name of target.fs.readdirSync(target.directory)) {
      if (NAME.test(name)) {
        try { target.fs.unlinkSync(target.directory + '/' + name); } catch (_) { /* best effort cache cleanup */ }
      }
    }
  } catch (_) { /* no cache yet */ }
}
module.exports = { imageSource, clearImageCache };
