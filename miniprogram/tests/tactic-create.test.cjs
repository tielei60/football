const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const model = require("../utils/tactic-create");
const def = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function fixture(request, storage = new Map()) {
  let page,
    token = "A",
    role = "admin";
  const calls = [],
    nav = [],
    modals = [];
  const api = {
    getSession: () => ({
      token,
      user: { id: 1, role },
      team: { id: 1 },
      serverOrigin: "https://test.invalid",
    }),
    ensureSession: async () => ({ user: { id: 1, role }, team: { id: 1 } }),
    request: async (...args) => {
      calls.push(args);
      return request ? request(...args) : { formations: [] };
    },
  };
  const wx = {
    getStorageSync: (k) => storage.get(k),
    setStorageSync: (k, v) => storage.set(k, JSON.parse(JSON.stringify(v))),
    removeStorageSync: (k) => storage.delete(k),
    redirectTo: (x) => nav.push(x),
  };
  const context = {
    Page: (d) => (page = d),
    require: (n) =>
      n === "../shared"
        ? { api }
        : n === "../../utils/ui"
          ? { abort() {}, showModal: (_, o) => modals.push(o) }
          : n === "../../utils/tactic-create"
            ? model
            : { apiBaseUrl: "https://test.invalid" },
    wx,
    Map,
    Math,
    Date,
    Number,
    Error,
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../pages/tactic-create/index.js"),
      "utf8",
    ),
    context,
  );
  page.options = {}; // 微信真实 Page.options 为路由参数，不是业务方法。
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = (x) => Object.assign(page.data, x);
  return {
    page,
    calls,
    nav,
    modals,
    storage,
    owner: (v) => (token = v),
    role: (v) => (role = v),
  };
}
test("空白人数模型不含真实成员，匿名阵型只取目录合法槽位", () => {
  for (const n of model.COUNTS) {
    const blank = model.build(" 测试 ", n, null, "k");
    assert.equal(blank.board.pieces.length, 0);
    const f = {
      id: "f",
      name: "阵型",
      playerCount: n,
      spots: Array.from({ length: n }, (_, i) => ({
        x: 100 + i,
        y: 200,
        role: "MF",
      })),
    };
    const result = model.build("测试", n, f, "k");
    assert.equal(result.board.pieces.length, n);
    assert.ok(result.board.pieces.every((p) => !("playerId" in p)));
  }
  assert.throws(() => model.build("", 7, null, "k"));
  assert.throws(() => model.build("x", 4, null, "k"));
  assert.throws(() => model.build("x", 7, { playerCount: 5, spots: [] }, "k"));
});
test("管理员空库可创建并以tacticId进入，导航失败保留收据", async () => {
  const f = fixture(async (p) =>
    p === "/tactic-formations" ? { formations: [] } : { tacticId: 7 },
  );
  await f.page.onShow();
  f.page.input({ detail: { value: "演练" } });
  await f.page.create();
  assert.equal(f.calls.filter((x) => x[1] === "POST").length, 1);
  assert.match(f.nav[0].url, /id=7$/);
  f.nav[0].fail();
  assert.equal(f.storage.size, 1);
  assert.match(f.page.data.actionError, /已创建成功/);
  f.page.enterCreated();
  f.nav[1].success();
  assert.equal(f.storage.size, 0);
});
test("球员拒绝且不读取目录", async () => {
  const f = fixture();
  f.role("player");
  await f.page.onShow();
  assert.match(f.page.data.error, /管理员/);
  assert.equal(f.calls.length, 0);
});
test("目录迟到隐藏不展示，换账号不接收旧结果", async () => {
  for (const change of ["hide", "owner"]) {
    const d = def(),
      f = fixture(() => d.promise);
    const p = f.page.onShow();
    await Promise.resolve();
    if (change === "hide") f.page.onHide();
    else f.owner("B");
    d.resolve({ formations: [] });
    await p;
    assert.equal(f.page.data.admin, false);
  }
});
test("双击在途仅一POST，隐藏后成功不导航且保留可核对收据", async () => {
  const d = def(),
    f = fixture((p) =>
      p === "/tactic-formations" ? { formations: [] } : d.promise,
    );
  await f.page.onShow();
  f.page.data.title = "演练";
  const p = f.page.create();
  await f.page.create();
  f.page.onHide();
  d.resolve({ tacticId: 9 });
  await p;
  assert.equal(f.calls.filter((x) => x[1] === "POST").length, 1);
  assert.equal(f.nav.length, 0);
  assert.equal(f.storage.size, 1);
});
test("未知失败404不自动新建，明确重试复用完全相同payload", async () => {
  let posts = 0;
  const f = fixture(async (p, m) => {
    if (p === "/tactic-formations") return { formations: [] };
    if (m === "POST") {
      posts++;
      if (posts === 1) throw Error("断网");
      return { tacticId: 8 };
    }
    throw Object.assign(Error("未找到"), { status: 404 });
  });
  await f.page.onShow();
  f.page.data.title = "原内容";
  await f.page.create();
  await f.page.recover();
  assert.equal(posts, 1);
  assert.equal(f.page.data.pending, true);
  f.page.data.title = "之后变化";
  f.page.retry();
  f.modals[0].success({ confirm: true });
  await new Promise((r) => setImmediate(r));
  const writes = f.calls.filter((x) => x[1] === "POST");
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0][2], writes[1][2]);
});
test("重入收据核对available=false不可导航或重放", async () => {
  const storage = new Map([
    [
      "football.tactic-create.v1:https%3A%2F%2Ftest.invalid:1:1",
      { requestId: "11111111-1111-4111-8111-111111111111" },
    ],
  ]);
  const f = fixture(
    async (p) =>
      p === "/tactic-formations"
        ? { formations: [] }
        : {
            requestId: "11111111-1111-4111-8111-111111111111",
            tacticId: 5,
            available: false,
          },
    storage,
  );
  await f.page.onShow();
  await f.page.recover();
  assert.equal(f.page.data.unavailable, true);
  assert.equal(f.nav.length, 0);
  f.page.finishDeleted();
  assert.equal(f.page.data.pending, false);
  assert.equal(storage.size, 0);
});
test("明确400保留输入且解锁，取消重试不发送", async () => {
  const f = fixture(async (p) => {
    if (p === "/tactic-formations") return { formations: [] };
    throw Object.assign(Error("输入无效"), { status: 400 });
  });
  await f.page.onShow();
  f.page.data.title = "演练";
  await f.page.create();
  assert.equal(f.page.data.pending, false);
  assert.equal(f.page.data.title, "演练");
  assert.equal(f.storage.size, 0);
});
test("持久匿名草稿跨实例恢复，确认取消不重发，篡改成员字段拒绝", async () => {
  const store = new Map();
  const f = fixture(async (p) => {
    if (p === "/tactic-formations") return { formations: [] };
    throw Error("断网");
  }, store);
  await f.page.onShow();
  f.page.data.title = "演练";
  await f.page.create();
  f.page.onUnload();
  const next = fixture(async (p) => {
    if (p === "/tactic-formations") return { formations: [] };
    if (p.startsWith("/tactic-create-receipts"))
      throw Object.assign(Error("未找到"), { status: 404 });
    return { tacticId: 11 };
  }, store);
  await next.page.onShow();
  assert.equal(next.page.data.canRetry, false);
  await next.page.recover();
  assert.equal(next.page.data.canRetry, true);
  next.page.retry();
  next.modals[0].success({ confirm: false });
  assert.equal(next.calls.filter((x) => x[1] === "POST").length, 0);
  next.page.retry();
  next.modals[1].success({ confirm: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(next.calls.filter((x) => x[1] === "POST").length, 1);
  const entry = [...store.values()][0];
  entry.payload.tactic.board.pieces = [{ playerId: 99 }];
  const bad = fixture(null, store);
  await bad.page.onShow();
  assert.ok(bad.page.data.error);
  assert.equal(bad.page.data.admin, false);
});
test("过期草稿移除内容保留核对收据，不自动重试", async () => {
  const id = "11111111-1111-4111-8111-111111111111",
    payload = {
      requestId: id,
      tactic: model.build("x", 7, null, "native-" + id),
      note: "",
    };
  const store = new Map([
    [
      "football.tactic-create.v1:https%3A%2F%2Ftest.invalid:1:1",
      { requestId: id, payload, createdAt: 1 },
    ],
  ]);
  const f = fixture(null, store);
  await f.page.onShow();
  assert.equal(f.page.data.pending, true);
  assert.equal(f.page.data.canRetry, false);
  assert.equal([...store.values()][0].payload, undefined);
});

test("持久写失败不得POST且保留输入",async()=>{const bad=new Map();bad.set=()=>{throw Error("存储失败")};const f=fixture(null,bad);await f.page.onShow();f.page.data.title="演练";await f.page.create();assert.equal(f.calls.filter(x=>x[1]==="POST").length,0);assert.equal(f.page.data.title,"演练");assert.match(f.page.data.actionError,/存储失败/);});

test("各页面不声明覆盖微信Page保留options或route属性的方法",()=>{const root=path.join(__dirname,"../pages");for(const dir of fs.readdirSync(root)){const file=path.join(root,dir,"index.js");if(fs.existsSync(file))assert.doesNotMatch(fs.readFileSync(file,"utf8"),/\b(?:options|route)\s*\([^)]*\)\s*\{/ ,dir);}});

for(const status of [400,403,429])test('未知创建后重试返回'+status+'仍保留原收据防重复',async()=>{
 let posts=0;const f=fixture(async(p,m)=>{
  if(p==='/tactic-formations')return {formations:[]};
  if(p.startsWith('/tactic-create-receipts'))throw Object.assign(Error('暂未收到'),{status:404});
  if(m==='POST'){posts++;if(posts===1)throw Error('响应丢失');throw Object.assign(Error('本次重试被拒绝'),{status});}
 });
 await f.page.onShow();f.page.data.title='等待核对';await f.page.create();const original=[...f.storage.values()][0];
 await f.page.recover();f.page.retry();f.modals.at(-1).success({confirm:true});await new Promise(r=>setImmediate(r));
 assert.equal(f.storage.size,1);assert.equal([...f.storage.values()][0].requestId,original.requestId);assert.equal(f.page.data.pending,true);assert.equal(f.page.data.canRetry,false);
 await f.page.create();assert.equal(posts,2);
});
for(const status of [400,403])test('跨实例恢复的未知创建重试'+status+'不丢原请求',async()=>{
 const store=new Map();const first=fixture(async(p)=>{if(p==='/tactic-formations')return {formations:[]};throw Error('响应未知')},store);
 await first.page.onShow();first.page.data.title='跨页核对';await first.page.create();const original=[...store.values()][0];first.page.onUnload();
 const next=fixture(async(p)=>{if(p==='/tactic-formations')return {formations:[]};throw Object.assign(Error('拒绝'),{status:p.startsWith('/tactic-create-receipts')?404:status})},store);
 await next.page.onShow();await next.page.recover();next.page.retry();next.modals.at(-1).success({confirm:true});await new Promise(r=>setImmediate(r));
 assert.equal(store.size,1);assert.equal([...store.values()][0].requestId,original.requestId);assert.equal(next.page.data.pending,true);assert.equal(next.page.data.canRetry,false);
});
