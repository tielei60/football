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
  const directory = await mkdtemp(join(tmpdir(), "football-native-"));
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

async function setupPlayer(f, adminToken) {
  const p = await f.call("/api/players", {
    method: "POST",
    token: adminToken,
    body: { name: "模拟队员", number: 8 },
  });
  assert.equal(p.status, 201);
  const account = {
    username: `player-${p.body.id}`,
    password: "player-password-123",
  };
  assert.equal(
    (
      await f.call(`/api/players/${p.body.id}/account`, {
        method: "POST",
        token: adminToken,
        body: account,
      })
    ).status,
    201,
  );
  const session = await f.login(account);
  assert.equal(session.status, 200);
  return { player: p.body, account, token: session.body.token };
}

test("native login uses isolated hashed sessions and existing account/team/role", async (t) => {
  const f = await fixture(t);
  const login = await f.login();
  assert.equal(login.status, 200);
  assert.match(login.body.token, /^native_[a-f0-9]{64}$/);
  assert.equal(login.body.user.role, "admin");
  assert.equal(login.body.user.teamId, 1);
  assert.ok(login.body.expiresAt > Date.now() + 6 * 86400000);
  assert.equal(login.headers["set-cookie"], undefined);
  assert.equal(login.headers["cache-control"], "no-store");
  assert.equal(login.headers["access-control-allow-origin"], undefined);
  const db = new DatabaseSync(f.databasePath);
  const rows = db.prepare("SELECT * FROM club_sessions").all();
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].token_hash,
    createHash("sha256").update(login.body.token).digest("hex"),
  );
  assert.equal(rows[0].expires_at, login.body.expiresAt);
  db.close();
  assert.equal(
    (await f.call("/api/auth/me", { token: login.body.token })).status,
    200,
  );
  assert.equal(
    (
      await f.call("/api/auth/me", {
        headers: { Cookie: `football_session=${login.body.token}` },
      })
    ).status,
    401,
  );
});

test("native transport cannot weaken browser CSRF or accept mixed credentials", async (t) => {
  const f = await fixture(t);
  const token = (await f.login()).body.token;
  for (const headers of [
    { Origin: f.base },
    { Origin: "https://evil.example" },
    { Cookie: "football_session=anything" },
    { "Sec-Fetch-Site": "same-origin" },
  ]) {
    assert.equal(
      (
        await f.call("/api/auth/native-login", {
          method: "POST",
          body: credentials,
          headers: { "X-Football-Client": "native-v1", ...headers },
        })
      ).status,
      403,
    );
    assert.equal((await f.call("/api/team", { token, headers })).status, 403);
  }
  assert.equal(
    (
      await f.call("/api/auth/native-login", {
        method: "POST",
        body: credentials,
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call("/api/auth/login", { method: "POST", body: credentials }))
      .status,
    403,
  );
  const web = await f.call("/api/auth/login", {
    method: "POST",
    body: credentials,
    headers: { Origin: f.base },
  });
  assert.equal(web.status, 200);
  assert.equal(web.body.token, undefined);
  const webToken = web.headers["set-cookie"][0].split(";")[0].split("=")[1];
  assert.equal((await f.call("/api/team", { token: webToken })).status, 401);
  assert.equal(
    (await f.call("/api/team", { token: "native_bad" })).status,
    401,
  );
  assert.equal(
    (
      await f.call("/api/team", {
        method: "PUT",
        body: { name: "bad", revision: 1 },
        headers: { Cookie: `football_session=${webToken}` },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("/api/auth/native-login", {
        method: "POST",
        token,
        body: credentials,
        headers: { "X-Football-Client": "native-v1" },
      })
    ).status,
    400,
  );
});

test("native RSVP persists once and retains player/admin and team visibility", async (t) => {
  const f = await fixture(t),
    adminToken = (await f.login()).body.token;
  const { player, token } = await setupPlayer(f, adminToken);
  const published = (
    await f.call("/api/matches", {
      method: "POST",
      token: adminToken,
      body: { opponent: "模拟对手", date: "2026-11-15", status: "published" },
    })
  ).body;
  const draft = (
    await f.call("/api/matches", {
      method: "POST",
      token: adminToken,
      body: { opponent: "未公开", date: "2026-11-16" },
    })
  ).body;
  for (const response of ["yes", "maybe", "no", "yes"]) {
    const r = await f.call(`/api/matches/${published.id}/rsvp`, {
      method: "PUT",
      token,
      body: { response, playerId: "forged" },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.rsvps, [{ playerId: player.id, response }]);
  }
  assert.equal(
    (await f.call(`/api/matches/${draft.id}`, { token })).status,
    404,
  );
  assert.equal(
    (
      await f.call(`/api/matches/${draft.id}/rsvp`, {
        method: "PUT",
        token,
        body: { response: "yes" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call("/api/players", {
        method: "POST",
        token,
        body: { name: "forged" },
      })
    ).status,
    403,
  );
  const db = new DatabaseSync(f.databasePath);
  db.prepare("INSERT INTO club_teams(id,name) VALUES (2,'另一队')").run();
  db.prepare(
    "INSERT INTO club_matches(team_id,opponent,match_date,status) VALUES (2,'隔离赛事','2026-11-15','published')",
  ).run();
  const foreign = db
    .prepare("SELECT id FROM club_matches WHERE team_id=2")
    .get().id;
  db.close();
  assert.equal(
    (await f.call(`/api/matches/${foreign}`, { token })).status,
    404,
  );
  assert.equal(
    (
      await f.call(`/api/matches/${foreign}/rsvp`, {
        method: "PUT",
        token,
        body: { response: "yes" },
      })
    ).status,
    404,
  );
  assert.equal(
    (await f.call(`/api/matches/${published.id}`, { token: adminToken })).body
      .rsvps.length,
    1,
  );
});

test("logout, password reset, expiry and archive revoke native sessions", async (t) => {
  const f = await fixture(t),
    adminToken = (await f.login()).body.token;
  const { player, account, token } = await setupPlayer(f, adminToken);
  const logout = await f.call("/api/auth/logout", {
    method: "POST",
    token,
    body: {},
  });
  assert.equal(logout.status, 204);
  assert.equal(logout.headers["set-cookie"], undefined);
  assert.equal((await f.call("/api/auth/me", { token })).status, 401);
  const token2 = (await f.login(account)).body.token;
  assert.equal(
    (
      await f.call(`/api/players/${player.id}/password`, {
        method: "PUT",
        token: adminToken,
        body: { newPassword: "replacement-password-123" },
      })
    ).status,
    204,
  );
  assert.equal((await f.call("/api/auth/me", { token: token2 })).status, 401);
  const updated = { ...account, password: "replacement-password-123" };
  const token3 = (await f.login(updated)).body.token;
  const db = new DatabaseSync(f.databasePath);
  db.prepare("UPDATE club_sessions SET expires_at=? WHERE token_hash=?").run(
    Date.now() - 1,
    createHash("sha256").update(token3).digest("hex"),
  );
  db.close();
  assert.equal((await f.call("/api/auth/me", { token: token3 })).status, 401);
  const token4 = (await f.login(updated)).body.token;
  assert.equal(
    (
      await f.call(`/api/players/${player.id}`, {
        method: "PUT",
        token: adminToken,
        body: { revision: player.revision, status: "inactive" },
      })
    ).status,
    200,
  );
  assert.equal((await f.call("/api/auth/me", { token: token4 })).status, 401);
  assert.equal((await f.login(updated)).status, 403);
});

test("own password change revokes both transports and preserves revision conflicts", async (t) => {
  const f = await fixture(t),
    token = (await f.login()).body.token;
  const browser = await f.call("/api/auth/login", {
    method: "POST",
    body: credentials,
    headers: { Origin: f.base },
  });
  const cookie = browser.headers["set-cookie"][0].split(";")[0];
  const current = (await f.call("/api/team", { token })).body;
  assert.equal(
    (
      await f.call("/api/team", {
        method: "PUT",
        token,
        body: { name: "模拟俱乐部", revision: current.revision },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call("/api/team", {
        method: "PUT",
        token,
        body: { name: "过期写入", revision: current.revision },
      })
    ).status,
    409,
  );
  const changed = await f.call("/api/auth/password", {
    method: "PUT",
    token,
    body: {
      currentPassword: credentials.password,
      newPassword: "new-owner-password-123",
    },
  });
  assert.equal(changed.status, 204);
  assert.equal(changed.headers["set-cookie"], undefined);
  assert.equal((await f.call("/api/auth/me", { token })).status, 401);
  assert.equal(
    (await f.call("/api/auth/me", { headers: { Cookie: cookie } })).status,
    401,
  );
  assert.equal((await f.login()).status, 401);
  const renewed = await f.login({
    ...credentials,
    password: "new-owner-password-123",
  });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.body.team.name, "模拟俱乐部");
});

test("native login retains validation, throttle, and permits WeChat Referer", async (t) => {
  const f = await fixture(t);
  const allowed = await f.call("/api/auth/native-login", {
    method: "POST",
    body: credentials,
    headers: {
      "X-Football-Client": "native-v1",
      Referer: "https://servicewechat.com/wx-example/0/page-frame.html",
    },
  });
  assert.equal(allowed.status, 200);
  assert.equal((await f.login(null)).status, 400);
  for (let index = 0; index < 30; index += 1) {
    assert.equal(
      (await f.login({ username: "nonexistent", password: "wrong-password" }))
        .status,
      401,
    );
  }
  assert.equal(
    (await f.login({ username: "nonexistent", password: "wrong-password" }))
      .status,
    429,
  );
  assert.equal(
    (
      await f.call("/api/auth/login", {
        method: "POST",
        body: { username: "nonexistent", password: "wrong-password" },
        headers: { Origin: f.base },
      })
    ).status,
    429,
  );
});
