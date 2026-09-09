import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { createFootballServer } from "./index.mjs";

test("production assets use negotiated gzip, conditional requests and safe cache lifetimes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "football-static-"));
  await mkdir(join(root, "js"));
  const source = "export const football = true;".repeat(500);
  await writeFile(join(root, "js/app-Abcd1234.js"), source);
  await writeFile(join(root, "js/app-Abcd1234.js.gz"), gzipSync(source));
  await writeFile(join(root, "index.html"), "<html>Football</html>");
  await writeFile(join(root, "sw.js"), "// service worker");
  const server = createFootballServer({
    databasePath: ":memory:",
    staticDirectory: root,
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const asset = origin + "/js/app-Abcd1234.js";
  const compressed = await fetch(asset, {
    headers: { "Accept-Encoding": "gzip" },
  });
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.equal(await compressed.text(), source);
  assert.match(compressed.headers.get("cache-control"), /immutable/);
  assert.equal(compressed.headers.get("vary"), "Accept-Encoding");
  const etag = compressed.headers.get("etag");
  assert.ok(etag);
  const unchanged = await fetch(asset, {
    headers: { "Accept-Encoding": "gzip", "If-None-Match": etag },
  });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  const plain = await fetch(asset, {
    headers: { "Accept-Encoding": "gzip;q=0, identity" },
  });
  assert.equal(plain.headers.get("content-encoding"), null);
  assert.equal(await plain.text(), source);
  const head = await fetch(asset, {
    method: "HEAD",
    headers: { "Accept-Encoding": "gzip" },
  });
  assert.equal(
    head.headers.get("content-length"),
    compressed.headers.get("content-length"),
  );
  assert.equal(await head.text(), "");
  for (const path of ["/board", "/sw.js"]) {
    const response = await fetch(origin + path);
    assert.equal(response.headers.get("cache-control"), "no-cache");
  }
  assert.equal(
    (await fetch(origin + "/api/coaching-desk")).headers.get("cache-control"),
    "no-store",
  );
});
