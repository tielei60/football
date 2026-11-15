import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { request } from "node:http";
import { openFootballStore } from "../../server/football-store.mjs";
import { createClubStore } from "../../server/club-store.mjs";
import { createFootballServer } from "../../server/index.mjs";
import { initializeLocalSystemAdmin } from "../../scripts/setup-local-system-admin.mjs";
import { createWechatProvider } from "../../server/wechat-provider.mjs";
const strong = "anonymous-test-password-2026";
function fixture() {
  const dir = fs.mkdtempSync(join(tmpdir(), "football-sys-test-"));
  fs.chmodSync(dir, 0o700);
  const path = join(dir, "db.sqlite");
  fs.writeFileSync(path, "", { mode: 0o600 });
  const store = openFootballStore(path),
    club = createClubStore(store.database, store, {
      bootstrapAdmin: { username: "ordinary-example", password: strong },
    });
  return {
    dir,
    path,
    store,
    club,
    close() {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
function sys(f) {
  initializeLocalSystemAdmin(f.store.database, { username: "system-example", initialPassword: "tmp-84" });
  let login = f.club.login({ username: "system-example", password: "tmp-84" }, "test", "native");
  f.club.changePassword(f.club.authenticate(login.token, "native"), { currentPassword: "tmp-84", newPassword: strong });
  login = f.club.login({ username: "system-example", password: strong }, "test", "native");
  return f.club.authenticate(login.token, "native");
}
const status = (n) => (e) => e.status === n;
test("旧管理员不自动升级；系统账号管理同队权限、CAS、撤权和会话", () => {
  const f = fixture();
  try {
    const ordinary = f.club.login({ username: "ordinary-example", password: strong }, "test", "native");
    assert.equal(ordinary.user.systemAdmin, false);
    assert.equal(ordinary.user.mustChangePassword, false);
    const a = sys(f);
    assert.throws(() => f.club.listSystemAccounts(f.club.authenticate(ordinary.token, "native")), status(403));
    assert.throws(() => f.club.createSystemAccount(a, { username: "wrong", password: "short!" }), status(400));
    assert.throws(
      () => f.club.createSystemAccount(a, { username: "wrong", password: strong, systemAdmin: true }),
      status(400)
    );
    let admin = f.club.createSystemAccount(a, { username: "managed-example", password: strong });
    assert.equal(admin.mustChangePassword, true);
    assert.equal(admin.systemAdmin, false);
    assert.equal(admin.playerId, null);
    assert.throws(() => f.club.createSystemAccount(a, { username: "MANAGED-EXAMPLE", password: strong }), status(409));
    assert.throws(
      () => f.club.updateSystemAccount(a, admin.id, { revision: admin.revision, role: "player" }),
      status(400)
    );
    const session = f.club.login({ username: "managed-example", password: strong }, "test", "native");
    admin = f.club.updateSystemAccount(a, admin.id, { revision: admin.revision, enabled: false });
    assert.throws(() => f.club.authenticate(session.token, "native"), status(401));
    assert.throws(() => f.club.login({ username: "managed-example", password: strong }, "test", "native"), status(401));
    assert.throws(() => f.club.updateSystemAccount(a, admin.id, { revision: 1, enabled: true }), status(409));
    admin = f.club.updateSystemAccount(a, admin.id, { revision: admin.revision, enabled: true });
    assert.equal(admin.enabled, true);
    const player = f.club.savePlayer(1, null, { name: "匿名球员" });
    f.club.createAccount(1, player.id, { username: "player-example", password: strong });
    const pl = f.club.login({ username: "player-example", password: strong }, "test", "native");
    let target = f.club.listSystemAccounts(a).find((v) => v.playerId === player.id);
    target = f.club.updateSystemAccount(a, target.id, { revision: target.revision, role: "admin" });
    assert.equal(target.playerId, player.id);
    assert.throws(() => f.club.authenticate(pl.token, "native"), status(401));
    target = f.club.updateSystemAccount(a, target.id, { revision: target.revision, role: "player" });
    assert.equal(target.role, "player");
    f.store.database.prepare("INSERT INTO club_teams(id,name) VALUES(2,'匿名第二队')").run();
    f.store.database
      .prepare("INSERT INTO club_users(team_id,username,password_hash,role) VALUES(2,'other-team','unused','admin')")
      .run();
    const other = f.store.database.prepare("SELECT id FROM club_users WHERE username='other-team'").get();
    assert.throws(() => f.club.updateSystemAccount(a, other.id, { revision: 1, enabled: false }), status(404));
    assert.throws(
      () => f.club.updateSystemAccount(a, a.id, { revision: a.account_revision, enabled: false }),
      status(403)
    );
    assert.throws(
      () => f.store.database.prepare("DELETE FROM club_users WHERE id=?").run(a.id),
      /last system administrator/
    );
    assert.throws(
      () => f.store.database.prepare("UPDATE club_users SET account_enabled=0 WHERE id=?").run(a.id),
      /last system administrator/
    );
    assert.throws(() => f.store.database.prepare("UPDATE club_users SET role='player' WHERE id=?").run(a.id));
    f.store.database.prepare("UPDATE club_users SET account_revision=account_revision+1 WHERE id=?").run(a.id);
    assert.throws(() => f.club.createSystemAccount(a, { username: "stale-actor", password: strong }), status(403));
    assert.equal(f.store.database.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally {
    f.close();
  }
});
function call(port, path, method = "GET", body, token) {
  return new Promise((resolve, reject) => {
    const req = request(
      `http://127.0.0.1:${port}/api${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Football-Client": "native-v1",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
      }
    );
    req.on("error", reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
test("真实HTTP首次改密门禁与正常强度、sysAPI、全会话失效", async () => {
  const f = fixture();
  let server;
  try {
    initializeLocalSystemAdmin(f.store.database, { username: "system-example", initialPassword: "tmp-84" });
    server = createFootballServer({
      databasePath: f.path,
      bootstrapAdmin: null,
      staticDirectory: join(f.dir, "none"),
      publicOrigin: "",
      secureCookies: false,
      trustedProxyAddresses: [],
      wechat: { enabled: false },
      aiPhotos: { enabled: false },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port;
    let login = await call(port, "/auth/native-login", "POST", { username: "system-example", password: "tmp-84" });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.mustChangePassword, true);
    let token = login.body.token;
    assert.equal((await call(port, "/auth/me", "GET", undefined, token)).status, 200);
    for (const path of ["/players", "/team", "/matches", "/system/accounts", "/venues", "/seasons", "/tactics"]) {
      const r = await call(port, path, "GET", undefined, token);
      assert.equal(r.status, 403, path);
      assert.equal(r.body.code, "PASSWORD_CHANGE_REQUIRED");
    }
    assert.equal(
      (await call(port, "/auth/password", "PUT", { currentPassword: "tmp-84", newPassword: "short!" }, token)).status,
      400
    );
    assert.equal(
      (await call(port, "/auth/password", "PUT", { currentPassword: "wrong", newPassword: strong }, token)).status,
      403
    );
    assert.equal(
      (await call(port, "/auth/password", "PUT", { currentPassword: "tmp-84", newPassword: strong }, token)).status,
      204
    );
    assert.equal((await call(port, "/auth/me", "GET", undefined, token)).status, 401);
    login = await call(port, "/auth/native-login", "POST", { username: "system-example", password: strong });
    token = login.body.token;
    assert.equal(login.body.user.mustChangePassword, false);
    assert.equal(login.body.user.systemAdmin, true);
    const accounts = await call(port, "/system/accounts", "GET", undefined, token);
    assert.equal(accounts.status, 200);
    assert.ok(Array.isArray(accounts.body));
    assert.ok(accounts.body.every((a) => !("password_hash" in a)));
    const create = await call(port, "/system/accounts", "POST", { username: "http-admin", password: strong }, token);
    assert.equal(create.status, 201);
    assert.equal(create.body.mustChangePassword, true);
    const initial = await call(port, "/auth/native-login", "POST", { username: "http-admin", password: strong });
    assert.equal(
      (await call(port, "/auth/password", "PUT", { currentPassword: strong, newPassword: strong }, initial.body.token))
        .status,
      400
    );
    const unchanged = await call(port, "/auth/me", "GET", undefined, initial.body.token);
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.user.mustChangePassword, true);

    const ordinary = await call(port, "/auth/native-login", "POST", { username: "ordinary-example", password: strong });
    assert.equal((await call(port, "/system/accounts", "GET", undefined, ordinary.body.token)).status, 403);
  } finally {
    if (server) {
      await new Promise((r) => server.close(r));
      await server.drained;
    }
    f.close();
  }
});

test("已有微信绑定球员授撤管理权限不锁出，禁用/归档/系统身份和旧交换代次仍拒绝", async () => {
  const f = fixture();
  try {
    const appId = "wx1234567890abcdef";
    const provider = createWechatProvider({
      enabled: true,
      appId,
      appSecret: "anonymous-private-mock-only",
      fetchImpl: async () =>
        new Response(JSON.stringify({ openid: "anonymous-bound-id", session_key: "mock-session-only" })),
    });
    const club = createClubStore(f.store.database, f.store, { wechatProvider: provider, wechatAppId: appId });
    f.club = club;
    const a = sys(f);
    const player = club.savePlayer(1, null, { name: "匿名微信球员" });
    const user = f.store.database
      .prepare(
        "INSERT INTO club_users(team_id,username,password_hash,password_enabled,role,player_id) VALUES(1,'wechat-only-example','unused',0,'player',?)"
      )
      .run(player.id);
    f.store.database
      .prepare("INSERT INTO club_wechat_identities(app_id,openid,user_id,created_at) VALUES(?,?,?,?)")
      .run(appId, "anonymous-bound-id", user.lastInsertRowid, Date.now());
    const identity = await provider.exchange("anonymous-code");
    let session = club.wechat.login(identity, club.wechat.epoch());
    assert.equal(session.user.role, "player");
    assert.equal(session.user.passwordEnabled, false);
    let target = club.listSystemAccounts(a).find((v) => v.playerId === player.id);
    const oldEpoch = club.wechat.epoch();
    target = club.updateSystemAccount(a, target.id, { revision: target.revision, role: "admin" });
    assert.throws(() => club.authenticate(session.token, "native"), status(401));
    assert.throws(() => club.wechat.login(identity, oldEpoch), status(409));
    session = club.wechat.login(identity, club.wechat.epoch());
    assert.equal(session.user.role, "admin");
    assert.equal(session.user.passwordEnabled, false);
    assert.equal(session.user.systemAdmin, false);
    target = club.updateSystemAccount(a, target.id, { revision: target.revision, role: "player" });
    assert.throws(() => club.authenticate(session.token, "native"), status(401));
    assert.equal(club.wechat.login(identity, club.wechat.epoch()).user.role, "player");
    target = club.updateSystemAccount(a, target.id, { revision: target.revision, enabled: false });
    assert.throws(() => club.wechat.login(identity, club.wechat.epoch()), status(403));
    target = club.updateSystemAccount(a, target.id, { revision: target.revision, enabled: true });
    assert.equal(club.wechat.login(identity, club.wechat.epoch()).user.role, "player");
    // 构造损坏绑定到独立系统账号，也不能借绑定获得微信登录。
    f.store.database.prepare("UPDATE club_wechat_identities SET user_id=?").run(a.id);
    assert.throws(() => club.wechat.login(identity, club.wechat.epoch()), status(403));
    f.store.database.prepare("UPDATE club_wechat_identities SET user_id=?").run(target.id);
    club.savePlayer(1, player.id, { revision: club.getPlayer(1, player.id).revision, status: "inactive" });
    assert.throws(() => club.wechat.login(identity, club.wechat.epoch()), status(403));
  } finally {
    f.close();
  }
});

test("故障关联球员的系统账号不可被球员重置路径接管", () => {
  const f = fixture();
  try {
    const a = sys(f),
      p = f.club.savePlayer(1, null, { name: "匿名故障关联" });
    f.store.database.prepare("UPDATE club_users SET player_id=? WHERE id=?").run(p.id, a.id);
    const before = f.store.database
        .prepare("SELECT password_hash,account_revision FROM club_users WHERE id=?")
        .get(a.id),
      sessions = f.store.database.prepare("SELECT * FROM club_sessions WHERE user_id=?").all(a.id);
    assert.throws(() => f.club.resetPassword(1, p.id, { newPassword: "anonymous-replacement-password" }), status(403));
    assert.deepEqual(
      f.store.database.prepare("SELECT password_hash,account_revision FROM club_users WHERE id=?").get(a.id),
      before
    );
    assert.deepEqual(f.store.database.prepare("SELECT * FROM club_sessions WHERE user_id=?").all(a.id), sessions);
  } finally {
    f.close();
  }
});
