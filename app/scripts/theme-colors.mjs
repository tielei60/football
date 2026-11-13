// Build-time consumers (manifest and HTML meta) share the CSS source of truth.
export function readThemeColor(css, token, seen = new Set()) {
  if (!/^--[a-z0-9-]+$/.test(token) || seen.has(token)) throw new Error(`Invalid or circular theme color: ${token}`);
  seen.add(token);
  const match = css.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
  const value = match?.[1].trim();
  if (/^#[\da-f]{6}$/i.test(value || "")) return value;
  const alias = value?.match(/^var\((--[a-z0-9-]+)\)$/);
  if (alias) return readThemeColor(css, alias[1], seen);
  throw new Error(`Theme color ${token} must resolve to a six-digit hex color`);
}
