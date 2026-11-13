import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const source = await readFile(new URL("../src/components/DragToolsPanel.vue", import.meta.url), "utf8");
// Execute the actual SFC script with only the compile-time props macro supplied.
const script = source
  .match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  .replace("const itemStore =", "export function createHarness() {\nconst itemStore =")
  .replace("defineProps<{ portrait?: boolean }>()", "({ portrait: false })")
  .concat("\nreturn { startDragNewItem, toolItems }; }");
const folder = await mkdtemp(join(tmpdir(), "football-palette-model-"));
after(() => rm(folder, { recursive: true, force: true }));
const outfile = join(folder, "model.cjs");
await build({
  entryPoints: [fileURLToPath(new URL("./palette-pointer.model.ts", import.meta.url))],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  loader: { ".svg": "dataurl" },
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  define: { "import.meta.env.PROD": "false", "import.meta.env.DEV": "true" },
  plugins: [
    {
      name: "actual-palette-script",
      setup(builder) {
        builder.onResolve({ filter: /^palette-script$/ }, () => ({ path: "palette-script", namespace: "model" }));
        builder.onLoad({ filter: /.*/, namespace: "model" }, () => ({
          contents: script,
          loader: "ts",
          resolveDir: fileURLToPath(new URL("../src/components", import.meta.url)),
        }));
      },
    },
  ],
});
["cancel", "outside", "identity", "blur-unmount", "normal"].forEach((mode) => {
  test(`actual palette pointer lifecycle: ${mode}`, () => {
    const result = spawnSync(process.execPath, [outfile, mode], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
