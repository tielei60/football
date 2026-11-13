import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readThemeColor } from "../scripts/theme-colors.mjs";

test("manifest and document colors resolve from the same semantic CSS tokens", () => {
  const css = readFileSync(new URL("../src/assets/styles/design-tokens.css", import.meta.url), "utf8");
  assert.match(readThemeColor(css, "--color-brand"), /^#[\da-f]{6}$/i);
  assert.match(readThemeColor(css, "--color-bg"), /^#[\da-f]{6}$/i);
  assert.equal(readThemeColor("--color-brand: #123456; --theme: var(--color-brand);", "--theme"), "#123456");
});

test("missing or circular theme colors fail clearly instead of silently reverting to stale branding", () => {
  assert.throws(() => readThemeColor("--a: var(--b); --b: var(--a);", "--a"), /circular/);
  assert.throws(() => readThemeColor("", "--color-brand"), /must resolve/);
});
