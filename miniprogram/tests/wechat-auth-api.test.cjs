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
  let photoClears = 0;
  const logins = [];
  const requests = [],
    storage = new Map();
  if (options.stored) storage.set(key, options.stored);
  const config = {
    apiBaseUrl: origin,
    allowLocalHttp: false,
    ...options.config,
  };
  const wx = {
    login: (options) => logins.push(options),
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
    require: (id) =>
      id === "./media"
        ? { clearImageCache() {} }
        : id === "./player-photo-cache"
          ? {
              clearAll() {
                photoClears++;
              },
            }
          : config,
    wx,
    Date,
    Number,
    Promise,
    Error,
  };
  vm.runInNewContext(source, context, { filename: "api.js" });
  const complete = (index, statusCode = 200, data = {}) =>
    requests[index].success({ statusCode, data });
  return {
    api: context.module.exports,
    requests,
    config,
    storage,
    complete,
    logins,
    photoClears: () => photoClears,
  };
}

const tick = () => new Promise((r) => setImmediate(r));
test("capabilities exposes only bool and never attaches a member token", async () => {
  const h = fixture({ stored: session() });
  const p = h.api.capabilities();
  assert.equal(h.requests[0].header.Authorization, undefined);
  h.complete(0, 200, { wechat: true, secret: "ignored" });
  assert.deepEqual(JSON.parse(JSON.stringify(await p)), { wechat: true });
});
test("claim captures immutable input before wx.login and sends no old Authorization", async () => {
  const h = fixture({ stored: session() }),
    input = { credential: "a".repeat(64), requestId: "one" };
  const a = h.api.beginWechat("claim", input);
  input.credential = "b".repeat(64);
  input.requestId = "two";
  h.logins[0].success({ code: "fresh" });
  await tick();
  assert.equal(h.requests[0].data.credential, "a".repeat(64));
  assert.equal(h.requests[0].data.requestId, "one");
  assert.equal(h.requests[0].header.Authorization, undefined);
  h.complete(0, 202, { id: "a".repeat(32), status: "claimed" });
  assert.equal((await a.promise).status, "claimed");
  assert.equal(h.api.getSession().token, token());
});
test("cancelled wx.login late code causes no request or automatic retry", async () => {
  const h = fixture(),
    a = h.api.beginWechat("login");
  const failed = assert.rejects(a.promise, /取消/);
  a.cancel();
  h.logins[0].success({ code: "late" });
  await failed;
  assert.equal(h.requests.length, 0);
  assert.equal(h.api.getSession(), null);
});
test("late successful WeChat session is revoked at original issuer and cannot replace password login", async () => {
  const h = fixture(),
    a = h.api.beginWechat("login");
  const rejected = assert.rejects(a.promise, /取消/);
  h.logins[0].success({ code: "old" });
  await tick();
  const b = h.api.beginLogin("user", "password");
  h.complete(1, 200, session("b"));
  await b.promise;
  h.complete(0, 200, session("a"));
  await rejected;
  assert.equal(h.api.getSession().token, token("b"));
  assert.ok(h.requests[2].url.endsWith("/auth/logout"));
  assert.equal(h.requests[2].header.Authorization, "Bearer " + token("a"));
});
test("issuer change after dispatch revokes late issued token only at original server", async () => {
  const h = fixture(),
    a = h.api.beginWechat("login");
  const rejected = assert.rejects(a.promise, /取消/);
  h.logins[0].success({ code: "code" });
  await tick();
  h.config.apiBaseUrl = "https://other.example";
  h.complete(0, 200, session());
  await rejected;
  assert.equal(h.requests[1].url, origin + "/api/auth/logout");
  assert.equal(h.api.getSession(), null);
});
test("explicit logout invalidates waiting claim and returned approval never establishes session", async () => {
  const h = fixture(),
    a = h.api.beginWechat("claim", {
      credential: "a".repeat(64),
      requestId: "r",
    });
  h.logins[0].success({ code: "code" });
  await tick();
  const rejected = assert.rejects(a.promise, /取消/);
  await h.api.logout();
  h.complete(0, 202, { status: "approved" });
  await rejected;
  assert.equal(h.api.getSession(), null);
  const b = h.api.beginWechat("claim", {
    credential: "a".repeat(64),
    requestId: "new",
  });
  h.logins[1].success({ code: "fresh" });
  await tick();
  h.complete(1, 202, { status: "approved" });
  assert.equal((await b.promise).status, "approved");
  assert.equal(h.api.getSession(), null);
});
test("malformed claim avoids consuming a WeChat code; wx login failure stays unauthenticated", async () => {
  const h = fixture();
  await assert.rejects(
    h.api.beginWechat("claim", { credential: "bad", requestId: "r" }).promise,
  );
  assert.equal(h.logins.length, 0);
  const a = h.api.beginWechat("login");
  h.logins[0].fail({ errMsg: "cancel" });
  await assert.rejects(a.promise);
  assert.equal(h.requests.length, 0);
});
test("new wx session retains passwordEnabled false without forcing account password capability", async () => {
  const h = fixture(),
    a = h.api.beginWechat("login");
  h.logins[0].success({ code: "fresh" });
  await tick();
  const result = session();
  result.user.passwordEnabled = false;
  h.complete(0, 200, result);
  await a.promise;
  assert.equal(h.api.getSession().user.passwordEnabled, false);
});
test("invalid issuer becomes a rejected attempt, not a synchronous start exception", async () => {
  const h = fixture({ config: { apiBaseUrl: "http://remote.example" } });
  let a;
  assert.doesNotThrow(() => (a = h.api.beginWechat("login")));
  await assert.rejects(a.promise);
  assert.equal(h.logins.length, 0);
  assert.equal(h.requests.length, 0);
});
