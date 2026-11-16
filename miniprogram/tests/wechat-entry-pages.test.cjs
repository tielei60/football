const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
function page(name, overrides = {}) {
  let definition;
  const calls = [],
    api = {
      capabilities: async () => ({ wechat: true }),
      enterAuthenticated: () => calls.push({url:"/pages/home/index"}),
      getSession: () => null,
      beginWechat: () => {
        throw Error("未设测试结果");
      },
      ...overrides,
    },
    ui = { abort() {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "pages", name, "index.js"), "utf8"),
    {
      Page: (d) => (definition = d),
      require: (id) =>
        id.includes("/ui")
          ? ui
          : {
              api,
              unload() {
                this._disposed = true;
              },
            },
      wx: {
        switchTab: (o) => calls.push(o),
        reLaunch: (o) => calls.push(o),
        navigateTo: (o) => calls.push(o),
      },
      Date,
      Math,
    },
  );
  const p = {
    ...definition,
    data: structuredClone(definition.data),
    setData(v) {
      Object.assign(this.data, v);
    },
  };
  return { p, api, calls };
}
const code = "a".repeat(64),
  result = {
    id: "b".repeat(32),
    status: "claimed",
    confirmationCode: "A1B2C3D4",
  };
test("claim credential remains private and explicit submission clears native input", async () => {
  let input;
  const h = page("wechat-claim", {
    beginWechat: (a, i) => {
      input = i;
      return { promise: Promise.resolve(result), cancel() {} };
    },
  });
  h.p.onLoad({});
  await h.p.onShow();
  h.p.credential({ detail: { value: code } });
  assert.equal(JSON.stringify(h.p.data).includes(code), false);
  const promise = h.p.submit();
  assert.equal(h.p.data.showInput, false);
  await promise;
  assert.equal(input.credential, code);
  assert.equal(h.p.data.status, "claimed");
  assert.equal(h.calls.length, 0);
  assert.equal(h.p.data.showInput, true);
});
test("changing credential clears previous status and hide clears all private claim state", async () => {
  const h = page("wechat-claim");
  h.p.onLoad({ credential: code });
  await h.p.onShow();
  h.p._inviteId = result.id;
  h.p.setData({
    status: "approved",
    confirmationCode: result.confirmationCode,
  });
  h.p.credential({ detail: { value: "c".repeat(64) } });
  assert.equal(h.p.data.status, "");
  assert.equal(h.p._inviteId, null);
  h.p.onHide();
  assert.equal(h.p._credential, "");
  assert.equal(h.p._inviteId, null);
  assert.equal(h.p.data.showInput, false);
});
test("late claim response after hide cannot reveal confirmation or navigate", async () => {
  let resolve,
    cancelled = 0;
  const h = page("wechat-claim", {
    beginWechat: () => ({
      promise: new Promise((r) => (resolve = r)),
      cancel() {
        cancelled++;
      },
    }),
  });
  h.p.onLoad({ credential: code });
  await h.p.onShow();
  const task = h.p.submit();
  h.p.onHide();
  resolve(result);
  await task;
  assert.equal(cancelled, 1);
  assert.equal(h.p.data.confirmationCode, "");
  assert.equal(h.calls.length, 0);
});
test("historical approved claim does not log in until separate explicit current login", async () => {
  const actions = [];
  const h = page("wechat-claim", {
    beginWechat: (a) => {
      actions.push(a);
      return {
        promise: Promise.resolve({ ...result, status: "approved" }),
        cancel() {},
      };
    },
  });
  h.p.onLoad({ credential: code });
  await h.p.onShow();
  await h.p.submit();
  assert.deepEqual(actions, ["claim"]);
  assert.equal(h.calls.length, 0);
  await h.p.login();
  assert.deepEqual(actions, ["claim", "login"]);
  assert.equal(h.calls.length, 1);
});
test("claim blocked for current logged in account and disabled capability", async () => {
  let n = 0;
  const h = page("wechat-claim", {
    getSession: () => ({ token: "A" }),
    beginWechat: () => n++,
  });
  h.p.onLoad({ credential: code });
  await h.p.onShow();
  await h.p.submit();
  assert.equal(n, 0);
  h.api.getSession = () => null;
  h.p.setData({ enabled: false });
  await h.p.submit();
  assert.equal(n, 0);
});
test("unknown claim allows explicit retry with fresh request ID but never auto retry", async () => {
  let n = 0;
  const h = page("wechat-claim", {
    beginWechat: () => {
      n++;
      return { promise: Promise.reject(Error("network")), cancel() {} };
    },
  });
  h.p.onLoad({ credential: code });
  await h.p.onShow();
  await h.p.submit();
  assert.equal(n, 1);
  assert.match(h.p.data.actionError, /原邀请码/);
  assert.equal(h.p.data.busy, false);
  assert.equal(h.p._credential, code);
});
test("synchronous start failure recovers busy on claim and login", async () => {
  const h = page("wechat-claim");
  h.p.onLoad({ credential: code });
  await h.p.onShow();
  await h.p.submit();
  assert.equal(h.p.data.busy, false);
  assert.ok(h.p.data.actionError);
  const l = page("login");
  await l.p.loadCapabilities();
  await l.p.wechatLogin();
  assert.equal(l.p.data.busy, false);
  assert.ok(l.p.data.error);
});
test("login onShow fetches capability only, never auto wx login after logout", async () => {
  let n = 0;
  const h = page("login", { beginWechat: () => n++ });
  h.p.onShow();
  await new Promise((r) => setImmediate(r));
  assert.equal(n, 0);
  assert.equal(h.p.data.wechatEnabled, true);
});
test("wechat-only member cannot open or submit password change", async () => {
  const h = page("me");
  h.p.data.session = { user: { role: "player", passwordEnabled: false } };
  h.p.togglePassword();
  await h.p.changePassword();
  assert.equal(h.p.data.passwordOpen, false);
  assert.equal(h.p.data.busy, false);
});

test("new entry markup is narrowly capability-gated and password ability is checked without changing input geometry", () => {
  const login = fs.readFileSync(
      path.join(root, "pages/login/index.wxml"),
      "utf8",
    ),
    me = fs.readFileSync(path.join(root, "pages/me/index.wxml"), "utf8"),
    manage = fs.readFileSync(
      path.join(root, "pages/manage-player/index.wxml"),
      "utf8",
    );
  assert.equal((login.match(/bindtap="wechatLogin"/g) || []).length, 1);
  assert.match(login, /wx:if="{{wechatEnabled}}" class="page wechat-entry"/);
  assert.match(
    me,
    /wx:if="{{session.user.passwordEnabled!==false}}" class="card section"/,
  );
  assert.equal((manage.match(/bindtap="openWechat"/g) || []).length, 1);
  assert.match(manage, /<button wx:if="{{id}}" bindtap="openWechat" disabled="{{busy}}"[^>]*>微信邀请与绑定<\/button>/);
  assert.match(manage, /<invite-sheet id="invite-sheet" player="{{id}}"\/>/);
  const sheet=fs.readFileSync(path.join(root,"components/invite-sheet/index.js"),"utf8");
  assert.match(sheet, /!this.ready\(\) \|\| this.data.archived \|\| this.data.unconfirmed \|\| this.data.binding\?\.bound \|\| this.data.activeInvite\?\.status === 'claimed'/);
  const css = fs.readFileSync(
    path.join(root, "pages/login/index.wxss"),
    "utf8",
  );
  assert.match(css, /\.wechat-entry\s*\{\s*padding-top:\s*0;?\s*\}/);
});
