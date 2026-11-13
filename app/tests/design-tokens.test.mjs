import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../src/assets/styles/design-tokens.css", import.meta.url), "utf8");
const tokens = new Map([...css.matchAll(/(--[a-z\d-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
function resolve(name, seen = new Set()) {
  assert.ok(tokens.has(name), `missing token ${name}`);
  assert.ok(!seen.has(name), `cyclic token ${name}`);
  seen.add(name);
  const value = tokens.get(name);
  const alias = /^var\((--[a-z\d-]+)\)$/.exec(value);
  return alias ? resolve(alias[1], seen) : value;
}
function luminance(hex) {
  assert.match(hex, /^#[a-f\d]{6}$/i);
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((channel) => parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(foreground, background) {
  const levels = [luminance(resolve(foreground)), luminance(resolve(background))].sort((a, b) => b - a);
  return (levels[0] + 0.05) / (levels[1] + 0.05);
}

test("semantic palette and compatibility aliases resolve without cycles", () => {
  for (const [name, value] of tokens) if (value.startsWith("var(")) assert.ok(resolve(name));
  assert.equal(resolve("--el-color-primary"), resolve("--color-brand"));
  assert.equal(resolve("--primary-color"), resolve("--color-brand"));
  assert.equal(resolve("--surface"), resolve("--color-surface"));
  assert.equal(resolve("--pitch-500"), resolve("--color-brand"));
});

test("body, muted, sidebar and primary action colors meet normal-text contrast", () => {
  for (const pair of [
    ["--color-text", "--color-bg"],
    ["--color-text-muted", "--color-bg"],
    ["--color-text-muted", "--color-sidebar"],
    ["--color-text-subtle", "--color-surface"],
    ["--color-on-brand", "--color-brand"],
    ["--color-on-brand", "--color-brand-hover"],
    ["--color-brand-active", "--color-brand-soft"],
    ["--pitch-label", "--pitch-bg"],
  ])
    assert.ok(contrast(...pair) >= 4.5, `${pair.join(" / ")} contrast ${contrast(...pair).toFixed(2)}`);
});

test("semantic feedback colors remain legible on their soft surfaces", () => {
  for (const state of ["success", "warning", "danger", "info"]) {
    assert.ok(contrast(`--color-${state}`, `--color-${state}-soft`) >= 4.5, `${state} needs readable text`);
  }
});

test("legacy main stylesheet has no independent hard-coded theme palette", async () => {
  const main = await readFile(new URL("../src/assets/styles/main.css", import.meta.url), "utf8");
  assert.match(main, /@import\s+"\.\/design-tokens\.css"/);
  assert.doesNotMatch(main, /#[a-f\d]{3,8}\b/i);
});
