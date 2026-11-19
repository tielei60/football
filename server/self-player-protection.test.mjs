import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createFootballServer } from "./index.mjs";

const credentials = { username: "test-system", password: "fictional-system-password" };
async function fixture(t, { wechatEnabled = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "football-self-protection-"));
  const path = join(directory, "isolated.sqlite");
  let server, base;
  const start = async () => {
    server = createFootballServer({
      databasePath: path,
      bootstrapAdmin: credentials,
      wechat: {
        enabled: wechatEnabled,
        appId: "wx0123456789abcdef",
        appSecret: "fictional-local-test-secret",
        fetchImpl: async () => {
          throw new Error("No external service is used in this test");
        },
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  await start();
  const db = new DatabaseSync(path);
  db.exec(
    "UPDATE club_users SET is_system_admin=1,must_change_password=0; INSERT INTO club_users(team_id,username,password_hash,role) SELECT team_id,'ordinary',password_hash,'admin' FROM club_users WHERE is_system_admin=1"
  );
  t.after(async () => {
    db.close();
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  const call = (route, { method = "GET", body, token } = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        base + route,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Football-Client": "native-v1",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
        (response) => {
          let data = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            data += chunk;
          });
          response.on("end", () => resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null }));
        }
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const login = async (username = credentials.username) => {
    const result = await call("/api/auth/native-login", { method: "POST", body: { ...credentials, username } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.token;
  };
  const player = async (token, name) => {
    const result = await call("/api/players", { method: "POST", token, body: { name } });
    assert.equal(result.status, 201);
    return result.body;
  };
  return {
    db,
    call,
    login,
    player,
    url: () => base,
    restart: async () => {
      await stop();
      await start();
    },
  };
}
const ownRow = (db) => db.prepare("SELECT * FROM club_users WHERE username=?").get(credentials.username);

// Actual HTTP + file-backed SQLite: this exercises auth, session revocation and
// the transaction shared by the tactical desk and club roster reconciliation.
test("self-bound system administrator cannot be archived through profiles or tactical removal, and failed desk saves roll back completely", async (t) => {
  const f = await fixture(t),
    root = await f.login(),
    ordinary = await f.login("ordinary");
  const p = await f.player(ordinary, "虚构本人"),
    other = await f.player(ordinary, "虚构队友");
  const before = ownRow(f.db),
    epoch = f.db.prepare("SELECT revision FROM club_wechat_epoch").get().revision;
  assert.equal(
    (
      await f.call("/api/system/accounts/self-player", {
        method: "POST",
        token: ordinary,
        body: { playerId: p.id, revision: 1 },
      })
    ).status,
    403
  );
  const bound = await f.call("/api/system/accounts/self-player", {
    method: "POST",
    token: root,
    body: { playerId: p.id, revision: before.account_revision },
  });
  assert.equal(bound.status, 200);
  const after = ownRow(f.db);
  assert.equal(after.password_hash, before.password_hash);
  assert.equal(after.password_enabled, before.password_enabled);
  assert.equal(after.role, before.role);
  assert.equal(after.is_system_admin, 1);
  assert.equal(after.account_revision, before.account_revision + 1);
  assert.equal(f.db.prepare("SELECT revision FROM club_wechat_epoch").get().revision, epoch + 1);
  assert.equal((await f.call("/api/auth/me", { token: root })).status, 401);
  let fresh = await f.login();
  for (const token of [ordinary, fresh]) {
    const rejected = await f.call(`/api/players/${p.id}`, {
      method: "PUT",
      token,
      body: { revision: p.revision, status: "inactive", name: "不应写入" },
    });
    assert.equal(rejected.status, 409);
    assert.match(rejected.body.message, /系统管理员.*不能归档/);
    assert.deepEqual((await f.call(`/api/players/${p.id}`, { token: ordinary })).body, {
      ...p,
      hasAccount: true,
      passwordEnabled: true,
    });
  }
  const initial = (await f.call("/api/coaching-desk", { token: ordinary })).body;
  const saved = await f.call("/api/coaching-desk", {
    method: "PUT",
    token: ordinary,
    body: {
      edition: initial.edition,
      desk: { board: { pieces: [], markings: [] }, players: initial.initialPlayers, selectedTacticId: null },
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const tables = ["club_players", "club_users", "club_sessions", "club_wechat_epoch", "coaching_desks", "team_players"];
  const readTables = () => tables.map((table) => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  const originalRows = readTables();
  const omitted = {
    ...saved.body.desk,
    players: saved.body.desk.players.filter((x) => x.playerId !== p.id).map((x) => ({ ...x, name: "本次全部应回滚" })),
  };
  const failed = await f.call("/api/coaching-desk", {
    method: "PUT",
    token: ordinary,
    body: { edition: saved.body.edition, desk: omitted },
  });
  assert.equal(failed.status, 409, JSON.stringify(failed.body));
  assert.deepEqual(readTables(), originalRows);
  assert.deepEqual((await f.call("/api/coaching-desk", { token: ordinary })).body, saved.body);
  // Non-system players retain ordinary archive semantics, not a blanket ban.
  const currentOther = (await f.call(`/api/players/${other.id}`, { token: ordinary })).body;
  assert.equal(
    (
      await f.call(`/api/players/${other.id}`, {
        method: "PUT",
        token: ordinary,
        body: { revision: currentOther.revision, status: "inactive" },
      })
    ).status,
    200
  );
  // Resetting a board is not membership removal and remains supported.
  const currentDesk = (await f.call("/api/coaching-desk", { token: ordinary })).body;
  assert.equal(
    (
      await f.call("/api/coaching-desk", {
        method: "PUT",
        token: ordinary,
        body: { edition: currentDesk.edition, desk: null },
      })
    ).status,
    200
  );
  assert.equal((await f.call("/api/auth/me", { token: fresh })).status, 200);
  await f.restart();
  fresh = await f.login();
  assert.equal((await f.call("/api/auth/me", { token: fresh })).body.user.playerId, p.id);
  assert.equal((await f.call(`/api/players/${p.id}`, { token: fresh })).body.status, "active");
});

test("system binding cannot be replaced, replayed with revoked auth or taken over by ordinary password/account paths", async (t) => {
  const f = await fixture(t),
    root = await f.login(),
    ordinary = await f.login("ordinary");
  const p = await f.player(ordinary, "本人"),
    alternative = await f.player(ordinary, "另一成员");
  const before = ownRow(f.db);
  for (const body of [
    { playerId: p.id, revision: before.account_revision, userId: 2 },
    { playerId: p.id, revision: 999 },
  ])
    assert.ok(
      [400, 409].includes(
        (await f.call("/api/system/accounts/self-player", { method: "POST", token: root, body })).status
      )
    );
  const payload = { playerId: p.id, revision: before.account_revision };
  const responses = await Promise.all(
    [1, 2].map(() => f.call("/api/system/accounts/self-player", { method: "POST", token: root, body: payload }))
  );
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
  assert.equal(ownRow(f.db).account_revision, before.account_revision + 1);
  assert.equal(
    (await f.call("/api/system/accounts/self-player", { method: "POST", token: root, body: payload })).status,
    401
  );
  const fresh = await f.login(),
    current = ownRow(f.db);
  assert.equal(
    (await f.call("/api/system/accounts/self-player", { method: "POST", token: fresh, body: payload })).status,
    409
  );
  const same = await f.call("/api/system/accounts/self-player", {
    method: "POST",
    token: fresh,
    body: { playerId: p.id, revision: current.account_revision },
  });
  assert.equal(same.status, 200);
  assert.equal(same.body.revision, current.account_revision);
  assert.equal(
    (
      await f.call("/api/system/accounts/self-player", {
        method: "POST",
        token: fresh,
        body: { playerId: alternative.id, revision: current.account_revision },
      })
    ).status,
    409
  );
  assert.equal(
    (
      await f.call(`/api/players/${p.id}/password`, {
        method: "PUT",
        token: ordinary,
        body: { newPassword: "fictional-takeover-password" },
      })
    ).status,
    403
  );
  assert.equal(
    (
      await f.call(`/api/players/${p.id}/account`, {
        method: "POST",
        token: ordinary,
        body: { username: "replacement", password: "fictional-takeover-password" },
      })
    ).status,
    409
  );
  for (const token of [ordinary, fresh])
    assert.equal(
      (
        await f.call(`/api/system/accounts/${current.id}`, {
          method: "PUT",
          token,
          body: { revision: current.account_revision, role: "player", enabled: false },
        })
      ).status,
      403
    );
  assert.deepEqual(ownRow(f.db), current);
  const match = await f.call("/api/matches", {
    method: "POST",
    token: ordinary,
    body: { opponent: "虚构对手", date: "2026-12-01", status: "published" },
  });
  assert.equal(match.status, 201);
  const reply = await f.call(`/api/matches/${match.body.id}/rsvp`, {
    method: "PUT",
    token: fresh,
    body: { response: "yes" },
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.body.rsvps[0].playerId, p.id);
});

test("logout while binding body is still uploading rejects the pending request without linking any player", async (t) => {
  const f = await fixture(t),
    token = await f.login(),
    p = await f.player(token, "迟到本人");
  const body = JSON.stringify({ playerId: p.id, revision: ownRow(f.db).account_revision });
  let req;
  const pending = new Promise((resolve, reject) => {
    req = httpRequest(
      f.url() + "/api/system/accounts/self-player",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Authorization: `Bearer ${token}`,
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      }
    );
    req.on("error", reject);
    req.write(body.slice(0, -1));
  });
  assert.equal((await f.call("/api/auth/logout", { method: "POST", token, body: {} })).status, 204);
  req.end(body.slice(-1));
  assert.equal(await pending, 401);
  assert.equal(ownRow(f.db).player_id, null);
});

test("ordinary administrator cannot revoke system sessions through empty WeChat bindings or manage system-player invites", async (t) => {
  const f = await fixture(t, { wechatEnabled: true });
  const root = await f.login(),
    ordinary = await f.login("ordinary"),
    p = await f.player(ordinary, "虚构系统本人");
  assert.equal(
    (
      await f.call("/api/system/accounts/self-player", {
        method: "POST",
        token: root,
        body: { playerId: p.id, revision: ownRow(f.db).account_revision },
      })
    ).status,
    200
  );
  const current = await f.login();
  const binding = (await f.call(`/api/players/${p.id}/wechat-binding`, { token: ordinary })).body;
  assert.equal(binding.bound, false);
  assert.equal(binding.revision, 0);
  const tables = [
    "club_users",
    "club_sessions",
    "club_wechat_epoch",
    "club_wechat_identities",
    "wechat_invites_foundation",
  ];
  const before = tables.map((table) => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
  for (const [suffix, body] of [
    ["wechat-binding/revoke", { revision: 0 }],
    ["wechat-invites", { requestId: "test-system-target" }],
    ["wechat-invites/" + "a".repeat(32) + "/approve", { revision: 1, confirmationCode: "123456" }],
    ["wechat-invites/" + "a".repeat(32) + "/revoke", { revision: 1 }],
    ["wechat-invites/" + "a".repeat(32) + "/code", { credential: "a".repeat(64) }],
  ]) {
    const response = await f.call(`/api/players/${p.id}/${suffix}`, { method: "POST", token: ordinary, body });
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.match(response.body.message, /普通管理员不能管理系统管理员/);
  }
  assert.deepEqual(
    tables.map((table) => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
    before
  );
  assert.equal((await f.call("/api/auth/me", { token: current })).status, 200);
  // The system administrator's own explicit account operation is not forbidden.
  assert.equal(
    (
      await f.call(`/api/players/${p.id}/wechat-binding/revoke`, {
        method: "POST",
        token: current,
        body: { revision: 0 },
      })
    ).status,
    200
  );
  assert.equal((await f.call("/api/auth/me", { token: current })).status, 401);
  assert.ok(await f.login());
});
