import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createFootballServer } from "./index.mjs";
const sharp = createRequire(new URL("../app/package.json", import.meta.url))(
  "sharp",
);
const credentials = { username: "owner", password: "owner-password-123" };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "football-media-"));
  const databasePath = join(directory, "test.sqlite");
  const server = createFootballServer({
    databasePath,
    bootstrapAdmin: credentials,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  // Model native wx.request, not browser fetch (Node fetch also adds Sec-Fetch-Mode).
  function call(path, { method = "GET", body, token, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        base + path,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(body !== undefined
              ? { "Content-Length": Buffer.byteLength(JSON.stringify(body)) }
              : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
          },
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: data ? JSON.parse(data) : null,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const login = (body = credentials) =>
    call("/api/auth/native-login", {
      method: "POST",
      body,
      headers: { "X-Football-Client": "native-v1" },
    });
  return { call, login, databasePath, base };
}

test("player photo HTTP routes enforce authorization, metadata, revision and DELETE body", async (t) => {
  const f = await fixture(t),
    token = (await f.login()).body.token;
  const player = (
    await f.call("/api/players", {
      token,
      method: "POST",
      body: { name: "合成照片测试" },
    })
  ).body;
  const path = "/api/players/" + player.id + "/photos";
  assert.equal((await f.call(path)).status, 401);
  assert.equal((await f.call(path, { token })).body.revision, 1);
  const dataUrl =
    "data:image/png;base64," +
    (
      await sharp({
        create: { width: 8, height: 8, channels: 3, background: "#8845a0" },
      })
        .png()
        .toBuffer()
    ).toString("base64");
  let response = await f.call(path, {
    token,
    method: "POST",
    body: {
      revision: 1,
      requestId: "http-upload-request-001",
      dataUrl,
      caption: "合成",
    },
  });
  assert.equal(response.status, 201);
  let album = response.body,
    pid = album.photos[0].id;
  assert.equal(album.photos[0].dataUrl, undefined);
  response = await f.call(path + "/" + pid, { token });
  assert.equal(response.status, 200);
  assert.match(response.body.dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(response.headers["cache-control"], "no-store");
  response = await f.call(path + "/" + pid, {
    token,
    method: "PUT",
    body: { revision: album.revision, caption: "更新" },
  });
  assert.equal(response.status, 200);
  album = response.body;
  assert.equal(
    (
      await f.call(path + "/order", {
        token,
        method: "PUT",
        body: { revision: 1, photoIds: [pid] },
      })
    ).status,
    409,
  );
  response = await f.call(path + "/" + pid, {
    token,
    method: "DELETE",
    body: { revision: album.revision },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.coverPhotoId, null);
  assert.equal(response.body.photos.length, 0);
  assert.equal((await f.call(path + "/" + pid, { token })).status, 404);
});
