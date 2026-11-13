import assert from "node:assert/strict";
import { readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
for (const [directory, extension, budget] of [
  ["js", ".js", 850000],
  ["css", ".css", 160000],
]) {
  let bytes = 0;
  for (const name of await readdir(join(dist, directory))) {
    if (!name.endsWith(extension)) continue;
    const size = (await stat(join(dist, directory, name))).size;
    bytes += size;
  }
  console.log(`${directory}: ${bytes} bytes (budget ${budget})`);
  assert.ok(bytes <= budget, `${directory} exceeds the production bundle budget`);
}
