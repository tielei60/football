import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const folder = await mkdtemp(join(tmpdir(), "football-pointer-model-"));
const bundle = join(folder, "model.cjs");
after(() => rm(folder, { recursive: true, force: true }));
await build({
  entryPoints: [fileURLToPath(new URL("./pointer-lifecycle.model.ts", import.meta.url))],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  loader: { ".svg": "dataurl" },
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
  define: { "import.meta.env.PROD": "false", "import.meta.env.DEV": "true" },
});
["eraser", "path", "pen", "bounds"].forEach((mode) => {
  test(`real pointer composable model: ${mode}`, () => {
    const result = spawnSync(process.execPath, [bundle, mode], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});
