const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
function fixture(name = "system-accounts") {
  let def,
    token = "A",
    sys = true,
    answer = true;
  const calls = [],
    routes = [];
  const api = {
    getSession: () => (token ? { token } : null),
    ensureSession: async () => ({
      user: {
        id: 1,
        systemAdmin: sys,
        mustChangePassword: true,
        passwordEnabled: true,
      },
    }),
    request: async (p, m, d) => {
      calls.push({ p, m, d });
      return [];
    },
    clearSession() {
      token = null;
    },
    logout: async () => {},
    enterAuthenticated: () => routes.push("home"),
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "../pages", name, "index.js"), "utf8"),
    {
      Page: (d) => (def = d),
      require: (r) =>
        r.endsWith("/api")
          ? api
          : { abort() {}, showModal: async () => ({ confirm: answer }) },
      wx: { reLaunch: (o) => routes.push(o.url) },
      console,
    },
  );
  const page = {
    ...def,
    options: {},
    route: "pages/" + name + "/index",
    data: structuredClone(def.data),
    setData(v) {
      Object.assign(this.data, v);
    },
  };
  return {
    page,
    api,
    calls,
    routes,
    token: (v) => (token = v),
    sys: (v) => (sys = v),
    answer: (v) => (answer = v),
  };
}
const row = {
  id: 2,
  username: "anonymous-player",
  role: "player",
  playerId: "p1",
  enabled: true,
  revision: 4,
  systemAdmin: false,
};
test("普通管理员不能读取系统名单；系统账号字段不接受本地提升", async () => {
  const h = fixture();
  h.sys(false);
  await h.page.onShow();
  assert.match(h.page.data.error, /仅系统管理员/);
  assert.equal(h.calls.length, 0);
});
test("授予普通管理权限使用原revision，取消不写、sys行只读", async () => {
  const h = fixture();
  h.api.request = async (p, m, d) => {
    h.calls.push({ p, m, d });
    return [row, { ...row, id: 1, systemAdmin: true }];
  };
  await h.page.onShow();
  h.answer(false);
  await h.page.update({ currentTarget: { dataset: { id: 2, kind: "role" } } });
  assert.equal(h.calls.filter((x) => x.m).length, 0);
  h.answer(true);
  await h.page.update({
    currentTarget: { dataset: { id: 1, kind: "enabled" } },
  });
  assert.equal(h.calls.filter((x) => x.m).length, 0);
  await h.page.update({ currentTarget: { dataset: { id: 2, kind: "role" } } });
  assert.equal(
    JSON.stringify(h.calls.find((x) => x.m).d),
    JSON.stringify({ revision: 4, role: "admin" }),
  );
});
test("409停止继续修改并保留错误，独立管理员无撤为球员动作", async () => {
  const h = fixture();
  h.api.request = async (p, m) => {
    if (m) throw Object.assign(Error("冲突"), { status: 409 });
    return [{ ...row, playerId: null, role: "admin" }];
  };
  await h.page.onShow();
  await h.page.update({ currentTarget: { dataset: { id: 2, kind: "role" } } });
  assert.equal(h.page.data.authorized, true);
  await h.page.update({
    currentTarget: { dataset: { id: 2, kind: "enabled" } },
  });
  assert.equal(h.page.data.authorized, false);
  assert.match(h.page.data.actionError, /重新载入/);
});
test("创建网络未知锁定，显式查询同名仅提示核对且不保存密码", async () => {
  const h = fixture();
  let posted = 0;
  h.api.request = async (p, m) => {
    if (m) {
      posted++;
      throw Error("断网");
    }
    return posted ? [{ ...row, username: "new-admin" }] : [];
  };
  await h.page.onShow();
  h.page.setData({ username: "new-admin", password: "anonymous-password" });
  await h.page.create();
  assert.equal(h.page.data.uncertain, true);
  assert.equal(h.page.data.password, "");
  await h.page.create();
  assert.equal(posted, 1);
  await h.page.refresh();
  assert.equal(h.page.data.uncertain, false);
  assert.match(h.page.data.actionError, /不确认初始密码/);
});
test("隐藏创建迟到成功不导航，返回等待原请求后可恢复", async () => {
  const h = fixture();
  let resolve;
  h.api.request = async (p, m) => (m ? new Promise((r) => (resolve = r)) : []);
  await h.page.onShow();
  h.page.setData({ username: "new-admin", password: "anonymous-password" });
  const task = h.page.create();
  await new Promise((r) => setImmediate(r));
  h.page.onHide();
  const showing = h.page.onShow();
  resolve({ id: 2 });
  await task;
  await showing;
  assert.equal(h.page.data.busy, false);
  assert.equal(h.page.data.password, "");
  assert.equal(h.routes.length, 0);
});
test("改密页面不读取业务数据，成功只清原会话并重新登录", async () => {
  const h = fixture("force-password");
  await h.page.onShow();
  assert.equal(h.calls.length, 0);
  h.page.setData({
    currentPassword: "anonymous-old",
    newPassword: "anonymous-new",
    confirmation: "anonymous-new",
  });
  await h.page.submit();
  assert.equal(h.calls[0].p, "/auth/password");
  assert.equal(h.api.getSession(), null);
  assert.ok(h.routes.includes("/pages/login/index"));
});
test("改密迟到成功不能清新账号，隐藏清空密码", async () => {
  const h = fixture("force-password");
  let resolve;
  h.api.request = () => new Promise((r) => (resolve = r));
  await h.page.onShow();
  h.page.setData({
    currentPassword: "anonymous-old",
    newPassword: "anonymous-new",
    confirmation: "anonymous-new",
  });
  const task = h.page.submit();
  h.page.onHide();
  h.token("B");
  resolve();
  await task;
  assert.equal(h.api.getSession().token, "B");
  assert.equal(h.routes.length, 0);
  assert.equal(h.page.data.currentPassword, "");
});
