// A browser JS API key is intentionally sent to the official SDK. Never add
// server-side signing secrets or unrelated environment values to this object.
export function tencentMapConfig(value = "") {
  if (typeof value !== "string")
    throw new Error("腾讯地图浏览器 Key 配置格式不正确。");
  const key = value.trim();
  if (key && !/^[A-Za-z0-9-]{10,128}$/.test(key))
    throw new Error("腾讯地图浏览器 Key 配置格式不正确。");
  return { provider: "tencent", enabled: key.length > 0, key: key || null };
}
