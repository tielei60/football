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
  const directory = await mkdtemp(join(tmpdir(), "football-venues-"));
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

const venue = {
  name: "演练足球场",
  address: "虚构地址",
  latitude: 31.2,
  longitude: 121.4,
  coordinateSystem: "gcj02",
};
test("venue lifecycle validates coordinates, revisions and native role authorization", async (t) => {
  const f = await fixture(t);
  const token = (await f.login()).body.token;
  assert.equal((await f.call("/api/venues")).status, 401);
  let v = await f.call("/api/venues", { method: "POST", token, body: venue });
  assert.equal(v.status, 201);
  v = v.body;
  assert.equal(v.coordinateSystem, "gcj02");
  assert.equal(v.revision, 1);
  for (const bad of [
    { latitude: 91 },
    { longitude: 181 },
    { latitude: "31" },
    { latitude: null },
    { coordinateSystem: "wgs84" },
    { name: "" },
    { status: "deleted" },
  ])
    assert.equal(
      (
        await f.call("/api/venues", {
          method: "POST",
          token,
          body: { ...venue, ...bad },
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await f.call("/api/venues/" + v.id, {
        method: "PUT",
        token,
        body: { name: "changed" },
      })
    ).status,
    428,
  );
  assert.equal(
    (
      await f.call("/api/venues/" + v.id, {
        method: "PUT",
        token,
        body: { revision: 10, name: "changed" },
      })
    ).status,
    409,
  );
  const p = (
    await f.call("/api/players", {
      method: "POST",
      token,
      body: { name: "虚构球员", number: 17 },
    })
  ).body;
  const creds = { username: "venue-player", password: "venue-player-pass" };
  assert.equal(
    (
      await f.call(`/api/players/${p.id}/account`, {
        method: "POST",
        token,
        body: creds,
      })
    ).status,
    201,
  );
  const player = (await f.login(creds)).body.token;
  assert.equal((await f.call("/api/venues", { token: player })).body.length, 1);
  assert.equal(
    (
      await f.call("/api/venues", {
        token: player,
        method: "POST",
        body: venue,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("/api/venues/" + v.id, {
        token: player,
        method: "PUT",
        body: { revision: 1, name: "bad" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call("/api/venues/" + v.id, { token, method: "DELETE" })).status,
    404,
  );
});
test("match venue snapshots remain historical, ignore forged input, and keep legacy text", async (t) => {
  const f = await fixture(t);
  const token = (await f.login()).body.token;
  const v = (
    await f.call("/api/venues", { token, method: "POST", body: venue })
  ).body;
  let m = (
    await f.call("/api/matches", {
      token,
      method: "POST",
      body: {
        opponent: "模拟队",
        date: "2026-12-20",
        venueId: v.id,
        venueSnapshot: { name: "forged" },
      },
    })
  ).body;
  assert.equal(m.venueSnapshot.name, venue.name);
  assert.equal(m.venueSnapshot.coordinateSystem, "gcj02");
  assert.match(m.location, /演练足球场/);
  const updated = (
    await f.call("/api/venues/" + v.id, {
      token,
      method: "PUT",
      body: {
        revision: 1,
        name: "新名称",
        latitude: 30,
        longitude: 120,
        status: "inactive",
      },
    })
  ).body;
  assert.equal(updated.revision, 2);
  m = (
    await f.call("/api/matches/" + m.id, {
      token,
      method: "PUT",
      body: {
        revision: m.revision,
        analysis: "保留场地",
        venueSnapshot: { name: "forged" },
      },
    })
  ).body;
  assert.equal(m.venueSnapshot.name, venue.name);
  assert.equal(m.venueSnapshot.latitude, 31.2);
  assert.equal(
    (
      await f.call("/api/matches", {
        token,
        method: "POST",
        body: { opponent: "new", date: "2026-12-20", venueId: v.id },
      })
    ).status,
    400,
  );
  let current = (await f.call("/api/matches/" + m.id, { token })).body;
  assert.equal(current.revision, m.revision);
  m = (
    await f.call("/api/matches/" + m.id, {
      token,
      method: "PUT",
      body: { revision: m.revision, venueId: null, location: "手工场地" },
    })
  ).body;
  assert.equal(m.venueId, null);
  assert.equal(m.venueSnapshot, null);
  assert.equal(m.location, "手工场地");
  assert.equal(
    (
      await f.call("/api/matches", {
        token,
        method: "POST",
        body: { opponent: "new", date: "2026-12-20", venueId: "1" },
      })
    ).status,
    400,
  );
  const legacy = (
    await f.call("/api/matches", {
      token,
      method: "POST",
      body: { opponent: "legacy", date: "2026-12-20", location: "旧字段" },
    })
  ).body;
  assert.equal(legacy.venueId, null);
  assert.equal(legacy.venueSnapshot, null);
  assert.equal(legacy.location, "旧字段");
});
test("venue team isolation and restart persistence use additive migration", async (t) => {
  const f = await fixture(t);
  const token = (await f.login()).body.token;
  const v = (
    await f.call("/api/venues", { token, method: "POST", body: venue })
  ).body;
  const db = new DatabaseSync(f.databasePath);
  db.prepare("INSERT INTO club_teams(id,name) VALUES(2,'Other')").run();
  const id = Number(
    db
      .prepare("INSERT INTO club_venues(team_id,name) VALUES(2,'Private')")
      .run().lastInsertRowid,
  );
  db.close();
  assert.equal((await f.call("/api/venues/" + id, { token })).status, 404);
  assert.equal(
    (
      await f.call("/api/venues/" + id, {
        token,
        method: "PUT",
        body: { revision: 1, name: "bad" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call("/api/matches", {
        token,
        method: "POST",
        body: { opponent: "new", date: "2026-12-20", venueId: id },
      })
    ).status,
    404,
  );
  const second = createFootballServer({
    databasePath: f.databasePath,
    bootstrapAdmin: null,
  });
  second.listen(0, "127.0.0.1");
  await once(second, "listening");
  t.after(() => new Promise((resolve) => second.close(resolve)));
  await new Promise((resolve, reject) => {
    httpRequest(
      `http://127.0.0.1:${second.address().port}/api/venues`,
      { headers: { Authorization: `Bearer ${token}` } },
      (r) => {
        let data = "";
        r.on("data", (d) => (data += d));
        r.on("end", () => {
          try {
            assert.equal(r.statusCode, 200);
            assert.equal(JSON.parse(data)[0].id, v.id);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      },
    ).end();
  });
});
test("pre-venue database migrates without changing old match text or revision", async (t) => {
  const f = await fixture(t);
  const token = (await f.login()).body.token;
  const legacy = (
    await f.call("/api/matches", {
      token,
      method: "POST",
      body: {
        opponent: "迁移保留",
        date: "2026-12-21",
        location: "原有文本地址",
      },
    })
  ).body;
  const db = new DatabaseSync(f.databasePath);
  db.exec(
    "ALTER TABLE club_matches DROP COLUMN venue_snapshot; ALTER TABLE club_matches DROP COLUMN venue_id; DROP TABLE club_venues;",
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
      `http://127.0.0.1:${second.address().port}/api/matches/${legacy.id}`,
      { headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let s = "";
        res.on("data", (d) => (s += d));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: JSON.parse(s) }),
        );
      },
    );
    r.on("error", reject);
    r.end();
  });
  assert.equal(read.status, 200);
  assert.equal(read.body.location, "原有文本地址");
  assert.equal(read.body.revision, legacy.revision);
  assert.equal(read.body.venueId, null);
  assert.equal(read.body.venueSnapshot, null);
});
