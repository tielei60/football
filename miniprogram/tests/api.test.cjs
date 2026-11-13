const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../utils/api.js"), "utf8");
const key = "football.native.session.v1";
const origin = "https://club.example";
const token = (digit = "a") => `native_${digit.repeat(64)}`;
const session = (digit = "a") => ({
  token: token(digit),
  expiresAt: Date.now() + 60000,
  serverOrigin: origin,
  user: { id: 1, teamId: 1, role: "player", playerId: "p1" },
  team: { id: 1, name: "模拟球队" },
});
function fixture(options = {}) {
  const requests = [],
    storage = new Map();
  if (options.stored) storage.set(key, options.stored);
  const config = {
    apiBaseUrl: origin,
    allowLocalHttp: false,
    ...options.config,
  };
  const wx = {
    request: (request) => requests.push(request),
    getStorageSync: (k) => storage.get(k),
    setStorageSync: (k, v) => {
      if (options.writeFailure) throw Error("unavailable");
      storage.set(k, v);
    },
    removeStorageSync: (k) => {
      if (options.removeFailure) throw Error("unavailable");
      storage.delete(k);
    },
  };
  const context = {
    module: { exports: {} },
    require: (id) => id === "./media" ? { clearImageCache() {} } : config,
    wx,
    Date,
    Number,
    Promise,
    Error,
  };
  vm.runInNewContext(source, context, { filename: "api.js" });
  const complete = (index, statusCode = 200, data = {}) =>
    requests[index].success({ statusCode, data });
  return { api: context.module.exports, requests, config, storage, complete };
}

test("configuration accepts HTTPS and opt-in loopback only; never transmits to invalid address", async () => {
  for (const url of [
    "",
    "http://club.example",
    "https://club.example/api",
    "https://user:pass@club.example",
    "https://club.example?key=1",
    "http://127.0.0.1.evil",
    "//evil.example",
  ]) {
    const f = fixture({ config: { apiBaseUrl: url, allowLocalHttp: true } });
    await assert.rejects(f.api.login("user", "secret"), /HTTPS/);
    assert.equal(f.requests.length, 0);
  }
  const f = fixture({
    config: { apiBaseUrl: "http://127.0.0.1:13001", allowLocalHttp: true },
  });
  const pending = f.api.login("user", "secret");
  assert.equal(
    f.requests[0].url,
    "http://127.0.0.1:13001/api/auth/native-login",
  );
  assert.equal(f.requests[0].header["X-Football-Client"], "native-v1");
  assert.equal(f.requests[0].header.Authorization, undefined);
  assert.equal(f.requests[0].header.Cookie, undefined);
  assert.equal(f.requests[0].header.Origin, undefined);
  f.complete(0, 200, session());
  await pending;
});

test("storage is issuer-bound and clearing cannot resurrect a failed removal", async () => {
  const f = fixture({ stored: session(), removeFailure: true });
  assert.equal(f.api.getSession().token, token());
  f.api.clearSession();
  assert.equal(f.api.getSession(), null);
  assert.equal(f.storage.get(key).token, token()); // stale storage is never reread this launch
  const other = fixture({
    stored: { ...session(), serverOrigin: "https://other.example" },
  });
  assert.equal(other.api.getSession(), null);
  const changed = fixture({ stored: session() });
  changed.api.getSession();
  changed.config.apiBaseUrl = "https://new.example";
  await assert.rejects(changed.api.request("/team"), { status: 401 });
  assert.equal(changed.requests.length, 0);
  const expired = fixture({
    stored: { ...session(), expiresAt: Date.now() - 1 },
  });
  assert.equal(expired.api.getSession(), null);
});

test("401 clears current session but late 401 cannot clear a newer login", async () => {
  const f = fixture({ stored: session() });
  const old = f.api.request("/team");
  const failed = assert.rejects(old, { status: 401 });
  const fresh = f.api.login("new", "password");
  f.complete(1, 200, session("b"));
  await fresh;
  f.complete(0, 401, { message: "expired" });
  await failed;
  assert.equal(f.api.getSession().token, token("b"));
  const current = f.api.request("/team");
  const rejected = assert.rejects(current, { status: 401 });
  f.complete(2, 401, {});
  await rejected;
  assert.equal(f.api.getSession(), null);
});

test("late successful requests are discarded on logout and server change", async () => {
  const f = fixture({ stored: session() });
  const pending = f.api.request("/matches");
  const rejected = assert.rejects(pending, { status: 401 });
  const logout = f.api.logout();
  f.complete(1, 204);
  await logout;
  f.complete(0, 200, [{ private: true }]);
  await rejected;
  const changed = fixture({ stored: session() });
  const response = changed.api.request("/team");
  const denied = assert.rejects(response, { status: 401 });
  changed.config.apiBaseUrl = "https://another.example";
  changed.complete(0, 200, {});
  await denied;
  assert.equal(changed.api.getSession(), null);
});

test("ensureSession deduplicates and only updates validated identity, never token fields", async () => {
  const f = fixture({ stored: session() });
  const a = f.api.ensureSession(),
    b = f.api.ensureSession();
  assert.equal(a, b);
  assert.equal(f.requests.length, 1);
  f.complete(0, 200, { ...session("b"), team: { id: 1, name: "已更新" } });
  const result = await a;
  assert.equal(result.token, undefined);
  assert.equal(f.api.getSession().token, token());
  assert.equal(result.team.name, "已更新");
  assert.equal(f.storage.get(key).team.name, "已更新");
  const next = f.api.ensureSession();
  assert.equal(f.requests.length, 2);
  const rejected = assert.rejects(next, /账号响应无效/);
  f.complete(1, 200, { user: { id: 2 }, team: { id: 7 } });
  await rejected;
  assert.equal(f.api.getSession().user.id, 1);
});

test("logout network failure stays locally logged out; newer login survives late logout", async () => {
  const f = fixture({ stored: session(), removeFailure: true });
  const logout = f.api.logout();
  const rejected = assert.rejects(logout, /网络/);
  f.requests[0].fail();
  await rejected;
  assert.equal(f.api.getSession(), null);
  const fresh = f.api.login("user", "password");
  f.complete(1, 200, session("b"));
  await fresh;
  const secondLogout = f.api.logout();
  const newer = f.api.login("user", "password");
  f.complete(3, 200, session("c"));
  await newer;
  f.complete(2, 204);
  await secondLogout;
  assert.equal(f.api.getSession().token, token("c"));
});

test("cancelled or overlapping login cannot win; stale issued session is revoked at original origin", async () => {
  const f = fixture();
  const first = f.api.login("first", "password");
  const rejected = assert.rejects(first, /取消/);
  const second = f.api.login("second", "password");
  f.complete(1, 200, session("b"));
  await second;
  f.complete(0, 200, session());
  await rejected;
  assert.equal(f.api.getSession().token, token("b"));
  assert.equal(f.requests[2].url, `${origin}/api/auth/logout`);
  assert.equal(f.requests[2].header.Authorization, `Bearer ${token()}`);
  f.complete(2, 204);
  const g = fixture();
  const login = g.api.login("user", "password");
  const cancelled = assert.rejects(login, /取消/);
  await g.api.logout();
  g.config.apiBaseUrl = "https://new.example";
  g.complete(0, 200, session());
  await cancelled;
  assert.equal(g.requests[1].url, `${origin}/api/auth/logout`);
  g.requests[1].fail(); // best-effort cleanup must not become an unhandled rejection
  assert.equal(g.api.getSession(), null);
});

test("storage failure remains usable in memory, malformed login and unsafe path fail", async () => {
  const f = fixture({ writeFailure: true });
  const login = f.api.login("user", "password");
  f.complete(0, 200, session());
  await login;
  assert.equal(f.api.getSession().token, token());
  await assert.rejects(f.api.request("/../secrets"), /路径/);
  assert.equal(f.requests.length, 1);
  const bad = f.api.login("user", "password");
  const rejected = assert.rejects(bad, /响应无效/);
  f.complete(1, 200, {
    ...session(),
    user: { id: 1, teamId: 2, role: "admin" },
  });
  await rejected;
  assert.equal(f.api.getSession(), null);
});

test("stale ensureSession cannot replace new login or release its newer check", async () => {
  const f = fixture({ stored: session() });
  const old = f.api.ensureSession();
  const rejected = assert.rejects(old, { status: 401 });
  const login = f.api.login("user", "password");
  f.complete(1, 200, session("b"));
  await login;
  const current = f.api.ensureSession();
  f.complete(0, 200, session());
  await rejected;
  assert.equal(f.api.ensureSession(), current);
  f.complete(2, 200, session("b"));
  await current;
  assert.equal(f.api.getSession().token, token("b"));
});

 test("credential persistence omits large team images", async () => {
 const f=fixture();const pending=f.api.login("user","password");const data=session();data.team.crest="data:image/png;base64,"+"A".repeat(1500000);f.complete(0,200,data);await pending;assert.equal(f.storage.get(key).team.crest,null);assert.ok(JSON.stringify(f.storage.get(key)).length<1000);
 });
