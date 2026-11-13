import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createFootballServer } from "./index.mjs";

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

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0i8AAAAASUVORK5CYII=";
async function matchFixture(t) {
  const f = await fixture(t);
  const token = (await f.login()).body.token;
  const match = (
    await f.call("/api/matches", {
      token,
      method: "POST",
      body: { opponent: "图集演练", date: "2026-12-20", notice: "请提前到场" },
    })
  ).body;
  return { ...f, token, match, path: `/api/matches/${match.id}/photos` };
}
test("match media metadata, image retrieval, idempotency, cover and removal share revision", async (t) => {
  const f = await matchFixture(t);
  let revision = f.match.revision;
  let upload = await f.call(f.path, {
    token: f.token,
    method: "POST",
    body: {
      revision,
      requestId: "request-photo-00000001",
      dataUrl: png,
      caption: "合影",
    },
  });
  assert.equal(upload.status, 201);
  const photo = upload.body.photo;
  assert.equal(upload.body.revision, revision + 1);
  assert.equal(upload.body.coverPhotoId, photo.id);
  revision = upload.body.revision;
  assert.equal("dataUrl" in photo, false);
  const retry = await f.call(f.path, {
    token: f.token,
    method: "POST",
    body: {
      revision: f.match.revision,
      requestId: "request-photo-00000001",
      dataUrl: png,
      caption: "合影",
    },
  });
  assert.equal(retry.status, 201);
  assert.equal(retry.body.photo.id, photo.id);
  assert.equal(retry.body.revision, revision);
  assert.equal(
    (
      await f.call(f.path, {
        token: f.token,
        method: "POST",
        body: {
          revision,
          requestId: "request-photo-00000001",
          dataUrl: png,
          caption: "不同说明",
        },
      })
    ).status,
    409,
  );
  const list = (await f.call(f.path, { token: f.token })).body;
  assert.equal(list.photos.length, 1);
  assert.equal(JSON.stringify(list).includes("base64"), false);
  const detail = (await f.call(f.path + "/" + photo.id, { token: f.token }))
    .body;
  assert.equal(detail.dataUrl, png);
  const matches = (await f.call("/api/matches", { token: f.token })).body;
  assert.equal(JSON.stringify(matches).includes("base64"), false);
  assert.equal(matches[0].notice, "请提前到场");
  const second = (
    await f.call(f.path, {
      token: f.token,
      method: "POST",
      body: { revision, requestId: "request-photo-00000002", dataUrl: png },
    })
  ).body;
  revision = second.revision;
  const cover = (
    await f.call(f.path + "/cover", {
      token: f.token,
      method: "PUT",
      body: { revision, photoId: second.photo.id },
    })
  ).body;
  assert.equal(cover.coverPhotoId, second.photo.id);
  revision = cover.revision;
  const removed = await f.call(f.path + "/" + second.photo.id, {
    token: f.token,
    method: "DELETE",
    body: { revision },
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.coverPhotoId, photo.id);
  revision = removed.body.revision;
  assert.equal(
    (await f.call(f.path + "/" + second.photo.id, { token: f.token })).status,
    404,
  );
  assert.equal(
    (
      await f.call(f.path, {
        token: f.token,
        method: "POST",
        body: { revision, requestId: "request-photo-00000002", dataUrl: png },
      })
    ).status,
    409,
  );
  const final = (
    await f.call(f.path + "/" + photo.id, {
      token: f.token,
      method: "DELETE",
      body: { revision },
    })
  ).body;
  assert.equal(final.coverPhotoId, null);
  assert.equal(final.photos.length, 0);
  const db = new DatabaseSync(f.databasePath);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM club_match_photos WHERE data_url IS NOT NULL",
      )
      .get().n,
    0,
  );
  db.close();
});
test("media validates formats, dimensions, limits, request IDs, stale revisions and notices", async (t) => {
  const f = await matchFixture(t);
  let revision = f.match.revision;
  const base = { revision, requestId: "request-photo-00000001", dataUrl: png };
  for (const bad of [
    { dataUrl: "https://evil.example/photo.jpg" },
    { dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" },
    { dataUrl: "data:image/png;base64,YQ==" },
    { requestId: "short" },
    { caption: 123 },
    { caption: "a".repeat(201) },
  ])
    assert.equal(
      (
        await f.call(f.path, {
          token: f.token,
          method: "POST",
          body: { ...base, ...bad },
        })
      ).status,
      400,
    );
  const large = Buffer.from(png.split(",")[1], "base64");
  large.writeUInt32BE(9000, 16);
  assert.equal(
    (
      await f.call(f.path, {
        token: f.token,
        method: "POST",
        body: {
          ...base,
          dataUrl: "data:image/png;base64," + large.toString("base64"),
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(f.path, {
        token: f.token,
        method: "POST",
        body: { ...base, revision: undefined },
      })
    ).status,
    428,
  );
  for (let i = 0; i < 9; i++) {
    const r = await f.call(f.path, {
      token: f.token,
      method: "POST",
      body: {
        ...base,
        revision,
        requestId: "request-photo-" + String(i).padStart(8, "0"),
      },
    });
    assert.equal(r.status, 201);
    revision = r.body.revision;
  }
  assert.equal(
    (
      await f.call(f.path, {
        token: f.token,
        method: "POST",
        body: { ...base, revision, requestId: "request-photo-00000099" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(f.path + "/cover", {
        token: f.token,
        method: "PUT",
        body: { revision: f.match.revision, photoId: null },
      })
    ).status,
    409,
  );
  const edit = (
    await f.call("/api/matches/" + f.match.id, {
      token: f.token,
      method: "PUT",
      body: { revision, analysis: "旧端改复盘" },
    })
  ).body;
  assert.equal(edit.notice, "请提前到场");
  assert.notEqual(edit.coverPhotoId, null);
  assert.equal(
    (
      await f.call("/api/matches/" + f.match.id, {
        token: f.token,
        method: "PUT",
        body: { revision: edit.revision, notice: "a".repeat(10001) },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("/api/matches/" + f.match.id, {
        token: f.token,
        method: "PUT",
        body: { revision: edit.revision, notice: "" },
      })
    ).body.notice,
    "",
  );
});
test("photos protect draft and other-team content and enforce admin writes", async (t) => {
  const f = await matchFixture(t);
  let upload = (
    await f.call(f.path, {
      token: f.token,
      method: "POST",
      body: {
        revision: f.match.revision,
        requestId: "request-photo-00000001",
        dataUrl: png,
      },
    })
  ).body;
  const p = (
    await f.call("/api/players", {
      token: f.token,
      method: "POST",
      body: { name: "演练球员" },
    })
  ).body;
  const creds = { username: "media-player", password: "media-player-password" };
  await f.call(`/api/players/${p.id}/account`, {
    token: f.token,
    method: "POST",
    body: creds,
  });
  const player = (await f.login(creds)).body.token;
  assert.equal((await f.call(f.path, { token: player })).status, 404);
  assert.equal(
    (await f.call(f.path + "/" + upload.photo.id, { token: player })).status,
    404,
  );
  const m = (
    await f.call("/api/matches/" + f.match.id, {
      token: f.token,
      method: "PUT",
      body: { revision: upload.revision, status: "published" },
    })
  ).body;
  assert.equal((await f.call(f.path, { token: player })).status, 200);
  assert.equal(
    (await f.call(f.path + "/" + upload.photo.id, { token: player })).status,
    200,
  );
  for (const [url, method, body] of [
    [
      f.path,
      "POST",
      {
        revision: m.revision,
        dataUrl: png,
        requestId: "request-photo-00000002",
      },
    ],
    [f.path + "/cover", "PUT", { revision: m.revision, photoId: null }],
    [f.path + "/" + upload.photo.id, "DELETE", { revision: m.revision }],
  ])
    assert.equal(
      (await f.call(url, { token: player, method, body })).status,
      403,
    );
  const another = (
    await f.call("/api/matches", {
      token: f.token,
      method: "POST",
      body: { opponent: "另一比赛", date: "2026-12-21" },
    })
  ).body;
  assert.equal(
    (
      await f.call(`/api/matches/${another.id}/photos/${upload.photo.id}`, {
        token: f.token,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call(`/api/matches/${another.id}/photos/cover`, {
        token: f.token,
        method: "PUT",
        body: { revision: another.revision, photoId: upload.photo.id },
      })
    ).status,
    404,
  );
  const db = new DatabaseSync(f.databasePath);
  db.prepare("INSERT INTO club_teams(id,name) VALUES(2,'Other')").run();
  db.prepare("UPDATE club_matches SET team_id=2 WHERE id=?").run(another.id);
  db.close();
  assert.equal(
    (await f.call(`/api/matches/${another.id}/photos`, { token: f.token }))
      .status,
    404,
  );
});

test("photo body limits and additive migration preserve older matches", async (t) => {
  const f = await matchFixture(t);
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 1);
  Buffer.from(png.split(",")[1], "base64").copy(bytes);
  assert.equal(
    (
      await f.call(f.path, {
        token: f.token,
        method: "POST",
        body: {
          revision: f.match.revision,
          requestId: "request-photo-oversized",
          dataUrl: "data:image/png;base64," + bytes.toString("base64"),
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(f.path, {
        token: f.token,
        method: "POST",
        body: { dataUrl: "x".repeat(3 * 1024 * 1024 + 1) },
      })
    ).status,
    413,
  );
  const db = new DatabaseSync(f.databasePath);
  db.exec(
    "DROP TABLE club_match_photos; ALTER TABLE club_matches DROP COLUMN notice; ALTER TABLE club_matches DROP COLUMN cover_photo_id;",
  );
  db.close();
  const second = createFootballServer({
    databasePath: f.databasePath,
    bootstrapAdmin: null,
  });
  second.listen(0, "127.0.0.1");
  await once(second, "listening");
  t.after(() => new Promise((resolve) => second.close(resolve)));
  const read = await new Promise((resolve, reject) => {
    const r = httpRequest(
      `http://127.0.0.1:${second.address().port}/api/matches/${f.match.id}`,
      { headers: { Authorization: `Bearer ${f.token}` } },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: JSON.parse(body) }),
        );
      },
    );
    r.on("error", reject);
    r.end();
  });
  assert.equal(read.status, 200);
  assert.equal(read.body.notice, "");
  assert.equal(read.body.coverPhotoId, null);
  assert.equal(read.body.opponent, f.match.opponent);
  assert.equal(read.body.revision, f.match.revision);
});
