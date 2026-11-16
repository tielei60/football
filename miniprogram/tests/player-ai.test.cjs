const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { resolve, reject, promise };
};
function fixture(options = {}) {
  let token = "ownerA",
    role = "admin",
    definition,
    selected;
  const store = options.store || new Map(),
    calls = [],
    modals = [],
    cacheCalls = [];
  const cap = {
    enabled: true,
    mode: "local-simulation",
    uploadMode: "sample",
    player: { id: "p1", name: "演练球员", revision: 5 },
    albumRevision: 9,
    styles: [{ id: "purple", label: "紫色卡片" }],
    samples: [{ id: "shape1", label: "几何样本" }],
    currency: "XXX",
    maxAmountMinor: 0,
    policyVersion: "policy1",
    ...options.cap,
  };
  const candidate = {
    id: "candidate1",
    revision: 2,
    simulation: true,
    originKind: "local-simulation",
  };
  const api = {
    getSession: () => ({
      token,
      user: { id: 1 },
      team: { id: 1 },
      serverOrigin: "http://localhost:1234",
    }),
    ensureSession: async () => ({ user: { id: 1, role }, team: { id: 1 } }),
    request: async (url, method = "GET", body) => {
      calls.push({ url, method, body });
      if (options.request) {
        const custom = await options.request(url, method, body);
        if (custom !== undefined) return custom;
      }
      if (url.endsWith("/capabilities")) return cap;
      if (method === "POST" && url.endsWith("/consents"))
        return {
          id:
            body.purpose === "private-ai-source"
              ? "sourceConsent"
              : "jobConsent",
          revision: 1,
        };
      if (method === "POST" && url.endsWith("/sources"))
        return { id: "source1", revision: 1, status: "ready" };
      if (method === "POST" && url.endsWith("/jobs"))
        return { id: "job1", revision: 1, status: "queued" };
      if (method === "GET" && url.endsWith("/jobs/job1"))
        return {
          id: "job1",
          revision: 3,
          status: "succeeded",
          candidates: [candidate],
        };
      if (url.endsWith("/candidates/candidate1"))
        return { ...candidate, dataUrl: "data:image/png;base64,iVBORw0KGgo=" };
      if (url.endsWith("/adoptions"))
        return { requestId: body.requestId, target: body.target, revision: 6 };
      if (method === "DELETE")
        return { id: "source1", revision: 2, status: "deleted" };
      throw Error("未设模拟接口 " + url);
    },
  };
  const wx = {
    getStorageSync: (k) => store.get(k),
    setStorageSync: (k, v) => store.set(k, structuredClone(v)),
    chooseMedia: (o) => {
      selected = o;
    },
    getFileSystemManager: () => ({
      readFile: (o) => o.success({ data: "iVBORw0KGgo=" }),
    }),
    navigateTo() {},
    previewImage() {},
  };
  const ui = { abort() {}, showModal: (_, o) => modals.push(o) };
  const cache = {
    createScope: () => ({}),
    dispose: (o) => cacheCalls.push(["dispose", o]),
    remove: (s, k) => cacheCalls.push(["remove", s, k]),
    put: (s, k, d) => {
      cacheCalls.push(["put", k]);
      options.onPut?.(s, k);
      return "/app-cache/" + k;
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "pages/player-ai/index.js"), "utf8"),
    {
      Page: (d) => (definition = d),
      require: (id) =>
        id.endsWith("/ui")
          ? ui
          : id.endsWith("/shared")
            ? { api, fail() {} }
            : id.endsWith("/player-photo-cache")
              ? cache
              : {},
      wx,
      Date,
      Math,
      encodeURIComponent,
    },
  );
  const p = {
    ...definition,
    route: "pages/player-ai/index", options: {},
    data: structuredClone(definition.data),
    setData(v) {
      Object.assign(this.data, structuredClone(v));
    },
  };
  p.onLoad({ id: "p1" });
  return {
    p,
    api,
    cap,
    calls,
    store,
    modals,
    cacheCalls,
    setToken: (t) => (token = t),
    setRole: (r) => (role = r),
    getSelected: () => selected,
    confirm: async () => {
      const m = modals.shift();
      assert.ok(m);
      return m.success({ confirm: true });
    },
  };
}
async function prepare(h) {
  await h.p.onShow();
  h.p.prepare();
  await h.confirm();
}
async function generate(h) {
  await prepare(h);
  h.p.generate();
  await h.confirm();
}
test("默认关闭不开放任何选图/上传/生成", async () => {
  const h = fixture({
    cap: { enabled: false, mode: "disabled", uploadMode: "disabled" },
  });
  await h.p.onShow();
  h.p.choose();
  h.p.prepare();
  h.p.generate();
  assert.equal(h.getSelected(), undefined);
  assert.equal(h.modals.length, 0);
  assert.equal(h.calls.filter((x) => x.method === "POST").length, 0);
});
test("非管理员无能力/素材请求", async () => {
  const h = fixture();
  h.setRole("player");
  await h.p.onShow();
  assert.match(h.p.data.error, /管理员/);
  assert.equal(h.calls.length, 0);
});
test("模拟完整准备生成预览并明确采用头像，不自动采用", async () => {
  const h = fixture();
  await generate(h);
  assert.equal(h.p.data.job.status, "succeeded");
  assert.match(h.p.data.candidates[0].label, /非真实/);
  assert.ok(h.p.data.candidates[0].src.startsWith("/app-cache"));
  assert.equal(JSON.stringify(h.p.data).includes("base64"), false);
  assert.equal(
    h.calls.some((c) => c.url.endsWith("/adoptions")),
    false,
  );
  const consent = h.calls.find((c) => c.body?.purpose === "private-ai-source");
  assert.equal(consent.body.styleId, "source");
  assert.equal(consent.body.maxAmountMinor, 0);
  h.p.adopt({ currentTarget: { dataset: { id: "candidate1" } } });
  await h.confirm();
  const adoption = h.calls.find((c) => c.url.endsWith("/adoptions"));
  assert.equal(adoption.body.target, "avatar");
  assert.equal(adoption.body.targetRevision, 5);
  assert.equal(adoption.body.candidateRevision, 2);
  assert.match(h.p.data.adopted, /已采用/);
});
test("出场用途只采用cover且确认说明保留旧照片和头像", async () => {
  const h = fixture();
  await h.p.onShow();
  h.p.setData({ purposeIndex: 1 });
  h.p.prepare();
  await h.confirm();
  h.p.generate();
  await h.confirm();
  h.p.adopt({ currentTarget: { dataset: { id: "candidate1" } } });
  assert.match(h.modals[0].content, /旧照片保留，头像不变/);
  await h.confirm();
  const adopted = h.calls.find((c) => c.url.endsWith("/adoptions"));
  assert.equal(adopted.body.target, "cover");
  assert.equal(adopted.body.targetRevision, 9);
});
test("采用保留展示时CAS，不在确认后静默读取最新版本", async () => {
  const h = fixture();
  await generate(h);
  h.p.adopt({ currentTarget: { dataset: { id: "candidate1" } } });
  h.cap.player.revision = 99;
  await h.confirm();
  assert.equal(
    h.calls.find((c) => c.url.endsWith("/adoptions")).body.targetRevision,
    5,
  );
});
test("模态取消无素材/任务写入", async () => {
  const h = fixture();
  await h.p.onShow();
  h.p.prepare();
  h.modals.shift().success({ confirm: false });
  assert.equal(h.calls.filter((x) => x.method === "POST").length, 0);
});
test("生成失败不替换头像或封面", async () => {
  const h = fixture({
    request: (u, m) => {
      if (m === "POST" && u.endsWith("/jobs"))
        throw Object.assign(Error("拒绝生成"), { status: 400 });
    },
  });
  await prepare(h);
  h.p.generate();
  await h.confirm();
  assert.equal(h.p.data.adopted, "");
  assert.equal(
    h.calls.some((x) => x.url.endsWith("/adoptions")),
    false,
  );
});
test("来源未知响应保留非秘密收据，重新实例只核对不自动POST", async () => {
  const h = fixture({
    request: (u, m) => {
      if (m === "POST" && u.endsWith("/sources")) throw Error("响应丢失");
    },
  });
  await prepare(h);
  assert.equal(h.p.data.pending, true);
  const bytes = JSON.stringify([...h.store]);
  assert.doesNotMatch(bytes, /base64|ownerA/);
  h.p.onUnload();
  const resumed = fixture({
    store: h.store,
    request: (u, m) => {
      if (m === "GET" && u.includes("/sources?"))
        return { id: "source1", status: "ready", revision: 1 };
    },
  });
  await resumed.p.onShow();
  assert.equal(
    resumed.calls.some((x) => x.method === "POST"),
    false,
  );
  await resumed.p.recover();
  assert.equal(resumed.p.data.sourceReady, true);
  assert.equal(resumed.p.data.pending, false);
});
test("隐藏时晚准备响应可保留收据但不继续发上传", async () => {
  const wait = deferred();
  const h = fixture({
    request: (u, m) =>
      m === "POST" && u.endsWith("/consents") ? wait.promise : undefined,
  });
  await h.p.onShow();
  h.p.prepare();
  const promise = h.confirm();
  await Promise.resolve();
  await Promise.resolve();
  h.p.onHide();
  wait.resolve({ id: "consent1" });
  await promise;
  assert.equal(
    h.calls.some((x) => x.url.endsWith("/sources")),
    false,
  );
});
test("换账号后迟到候选不写缓存或页面", async () => {
  const wait = deferred();
  let delayed = false;
  const h = fixture({
    request: (u) =>
      delayed && u.endsWith("/candidates/candidate1")
        ? wait.promise
        : undefined,
  });
  await generate(h);
  const before = h.cacheCalls.length;
  delayed = true;
  const work = h.p.loadJob();
  await Promise.resolve();
  await Promise.resolve();
  h.setToken("ownerB");
  wait.resolve({
    id: "candidate1",
    revision: 2,
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  });
  await work;
  assert.equal(h.cacheCalls.length, before);
});
test("file策略缺任何披露不可选择上传", async () => {
  const h = fixture({
    cap: {
      mode: "configured-provider",
      uploadMode: "file",
      disclosures: { processor: "处理方" },
    },
  });
  await h.p.onShow();
  assert.equal(h.p.data.enabled, false);
  h.p.choose();
  assert.equal(h.getSelected(), undefined);
});
test("完整file策略仅自动测试选取合成字节并显示具体政策，hide/show不中断合法选图", async () => {
  const h = fixture({
    cap: {
      mode: "configured-provider",
      uploadMode: "file",
      currency: "CNY",
      maxAmountMinor: 10,
      disclosures: {
        processor: "测试处理方",
        destination: "测试目的地",
        retention: "测试保留",
        training: "不训练",
        cancellation: "测试取消",
      },
    },
  });
  await h.p.onShow();
  assert.equal(h.p.data.enabled, true);
  assert.match(h.p.data.disclosureText, /测试目的地/);
  h.p.choose();
  h.p.onHide();
  await h.p.onShow();
  h.getSelected().success({
    tempFiles: [{ size: 8, tempFilePath: "/system-temporary/sample.png" }],
  });
  assert.equal(h.p.data.preview, "/system-temporary/sample.png");
  h.p.prepare();
  assert.match(h.modals[0].content, /测试保留/);
  await h.confirm();
  assert.ok(h.calls.find((c) => c.url.endsWith("/sources")).body.dataUrl);
  assert.equal(JSON.stringify([...h.store]).includes("base64"), false);
});
test("来源删除丢响应后重进核对deleted可清理，不加载失效任务遮住入口", async () => {
  const h = fixture({
    request: (u, m) => {
      if (m === "DELETE") throw Error("删除响应丢失");
    },
  });
  await generate(h);
  h.p.removeSource();
  await h.confirm();
  assert.equal(h.p.data.pending, true);
  h.p.onUnload();
  const next = fixture({
    store: h.store,
    request: (u, m) => {
      if (m === "GET" && u.includes("/sources?"))
        return { id: "source1", status: "deleted", revision: 2 };
    },
  });
  await next.p.onShow();
  assert.equal(
    next.calls.some((x) => x.url.endsWith("/jobs/job1")),
    false,
  );
  await next.p.recover();
  assert.equal(next.p.data.pending, false);
  assert.equal(next.p.data.sourceReady, false);
  assert.equal(next.p.data.job, null);
});
test("采用409核对404后必须再次确认才可更新目标版本，不自动采用", async () => {
  let conflict = true;
  const h = fixture({
    request: (u, m) => {
      if (u.endsWith("/adoptions") && m === "POST" && conflict)
        throw Object.assign(Error("目标已变化"), { status: 409 });
      if (u.includes("/adoptions?"))
        throw Object.assign(Error("无收据"), { status: 404 });
    },
  });
  await generate(h);
  h.p.adopt({ currentTarget: { dataset: { id: "candidate1" } } });
  await h.confirm();
  assert.equal(h.p.data.pending, true);
  await h.p.recover();
  assert.equal(h.p.data.canResetAdoption, true);
  const writes = h.calls.filter((x) => x.url.endsWith("/adoptions")).length;
  h.cap.player.revision = 12;
  h.p.resetAdoption();
  await h.confirm();
  assert.equal(h.p.data.pending, false);
  assert.equal(
    h.calls.filter((x) => x.url.endsWith("/adoptions")).length,
    writes,
  );
  conflict = false;
  h.p.adopt({ currentTarget: { dataset: { id: "candidate1" } } });
  await h.confirm();
  assert.equal(
    h.calls.filter((x) => x.url.endsWith("/adoptions")).at(-1).body
      .targetRevision,
    12,
  );
});
for (const status of ["failed", "deleted", "processing"])
  test("未知来源恢复状态 " + status + " 不冒充就绪或永久终态锁", async () => {
    const h = fixture({
      request: (u, m) => {
        if (m === "POST" && u.endsWith("/sources")) throw Error("响应丢失");
        if (m === "GET" && u.includes("/sources?"))
          return { id: "source1", revision: 2, status };
      },
    });
    await prepare(h);
    await h.p.recover();
    assert.equal(h.p.data.pending, status === "processing");
    assert.equal(h.p.data.sourceReady, false);
    assert.equal(h.p.data.hasSource, status === "failed");
    h.p.generate();
    assert.equal(h.modals.length, 0);
  });
test("核对已删除来源清专用候选缓存而非系统原图", async () => {
  const h = fixture({
    request: (u, m) => {
      if (m === "DELETE") throw Error("删除响应丢失");
      if (m === "GET" && u.includes("/sources?"))
        return { id: "source1", revision: 2, status: "deleted" };
    },
  });
  await generate(h);
  h.p.removeSource();
  await h.confirm();
  const before = h.cacheCalls.filter((x) => x[0] === "dispose").length;
  await h.p.recover();
  assert.equal(
    h.cacheCalls.filter((x) => x[0] === "dispose").length,
    before + 1,
  );
  assert.deepEqual(h.p.data.candidates, []);
  assert.equal(h.p.data.preview, "");
});
test("旧perform迟到finally不能清掉hide/show之后新操作busy", async () => {
  const h = fixture();
  await h.p.onShow();
  const old = deferred();
  const work = h.p.perform(() => old.promise);
  await Promise.resolve();
  await Promise.resolve();
  h.p.onHide();
  await h.p.onShow();
  h.p.setData({ busy: true });
  old.resolve();
  await work;
  assert.equal(h.p.data.busy, true);
});
test("共享弹层阻挡不重复排队，旧确认不得重复准备素材", async () => {
  const h = fixture();
  await h.p.onShow();
  h.p.setData({ businessUiBlocking: true });
  h.p.prepare();
  assert.equal(h.modals.length, 0);
  h.p.setData({ businessUiBlocking: false });
  h.p.prepare();
  const modal = h.modals.shift();
  await modal.success({ confirm: true });
  const count = h.calls.filter((x) => x.url.endsWith("/sources")).length;
  await modal.success({ confirm: true });
  assert.equal(h.calls.filter((x) => x.url.endsWith("/sources")).length, count);
});
test("头像来源投影只用服务器生成标记，模拟不误标真实AI", () => {
  const m = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "pages/shared.js"), "utf8"),
    { module: m, require: id => id.includes("player-initial") ? require("../utils/player-initial") : ({ imageSource: () => "" }) },
  );
  const normal = m.exports.playerView({ id: "p", name: "匿名" });
  assert.equal(normal.avatarGenerated, false);
  const simulated = m.exports.playerView({
    id: "p",
    name: "匿名",
    avatarGenerated: true,
    avatarSimulation: true,
    avatarOriginKind: "local-simulation",
  });
  assert.equal(simulated.avatarOriginLabel, "模拟图");
  const ai = m.exports.playerView({
    id: "p",
    name: "匿名",
    avatarGenerated: true,
    avatarAiGenerated: true,
  });
  assert.equal(ai.avatarOriginLabel, "AI 生成");
  for (const page of ["players", "player-detail", "me"])
    assert.match(
      fs.readFileSync(path.join(root, "pages", page, "index.wxml"), "utf8"),
      /avatarGenerated/,
    );
  assert.match(
    fs.readFileSync(path.join(root, "pages/player-photos/index.wxml"), "utf8"),
    /item.generated/,
  );
});
test("候选GET迟到不能在删除素材后重写新缓存和页面", async () => {
  const wait = deferred();
  let delayed = false;
  const h = fixture({
    request: (u) =>
      delayed && u.endsWith("/candidates/candidate1")
        ? wait.promise
        : undefined,
  });
  await generate(h);
  delayed = true;
  const reading = h.p.loadJob();
  await Promise.resolve();
  await Promise.resolve();
  h.p.removeSource();
  await h.confirm();
  const writes = h.cacheCalls.filter((x) => x[0] === "put").length;
  wait.resolve({
    id: "candidate1",
    revision: 2,
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  });
  await reading;
  assert.equal(h.cacheCalls.filter((x) => x[0] === "put").length, writes);
  assert.deepEqual(h.p.data.candidates, []);
  assert.equal(h.p.data.job, null);
});
test("候选迟到在取消后不再写缓存", async () => {
  const wait = deferred();
  let delayed = false,
    cancelled = false;
  const h = fixture({
    request: (u, m) => {
      if (u.endsWith("/cancel")) {
        cancelled = true;
        return { id: "job1", status: "cancelled", revision: 4 };
      }
      if (cancelled && u.endsWith("/jobs/job1"))
        return { id: "job1", status: "cancelled", revision: 4, candidates: [] };
      if (delayed && u.endsWith("/candidates/candidate1")) return wait.promise;
    },
  });
  await generate(h);
  delayed = true;
  const reading = h.p.loadJob();
  await Promise.resolve();
  await Promise.resolve();
  h.p.data.job.canCancel = true;
  h.p.cancel();
  await h.confirm();
  const count = h.cacheCalls.filter((x) => x[0] === "put").length;
  wait.resolve({
    id: "candidate1",
    revision: 2,
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  });
  await reading;
  assert.equal(h.cacheCalls.filter((x) => x[0] === "put").length, count);
  assert.equal(h.p.data.job.status, "cancelled");
  assert.deepEqual(h.p.data.candidates, []);
});
test("旧job候选不得写入新job或新scope", async () => {
  const wait = deferred();
  let delayed = false;
  const h = fixture({
    request: (u) =>
      u.endsWith("/jobs/job2")
        ? { id: "job2", status: "queued", revision: 1, candidates: [] }
        : delayed && u.endsWith("/candidates/candidate1")
          ? wait.promise
          : undefined,
  });
  await generate(h);
  delayed = true;
  const reading = h.p.loadJob();
  await Promise.resolve();
  await Promise.resolve();
  h.p._record.jobId = "job2";
  h.p.clearPrivate();
  await h.p.loadJob();
  const count = h.cacheCalls.filter((x) => x[0] === "put").length;
  wait.resolve({
    id: "candidate1",
    revision: 2,
    dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  });
  await reading;
  assert.equal(h.cacheCalls.filter((x) => x[0] === "put").length, count);
  assert.equal(h.p.data.job.id, "job2");
});
test("同步缓存写入后归属变化只移除捕获的旧scope条目", async () => {
  let h,
    mutate = false,
    oldScope;
  h = fixture({
    onPut: (scope) => {
      if (mutate) {
        oldScope = scope;
        h.p._scope = { newScope: true };
      }
    },
  });
  await generate(h);
  mutate = true;
  await h.p.loadJob();
  const removed = h.cacheCalls.filter((x) => x[0] === "remove").at(-1);
  assert.ok(removed);
  assert.equal(removed[1], oldScope);
  assert.notEqual(removed[1], h.p._scope);
  assert.deepEqual(h.p.data.candidates, []);
});

test("删除素材成功用独立成功提示，不显示错误红字", async()=>{const h=fixture();await generate(h);h.p.removeSource();await h.confirm();assert.equal(h.p.data.actionError,'');assert.match(h.p.data.successMessage,/私有素材已删除/);await h.p.refresh();assert.equal(h.p.data.successMessage,'');});
test("候选实际图片失败只禁该图采用，刷新可恢复且旧事件不污染",async()=>{const h=fixture();await generate(h);const c=h.p.data.candidates[0];const e={currentTarget:{dataset:{id:c.id,revision:c.revision,src:c.src,epoch:c.imageEpoch}}};h.p.candidateError(e);assert.equal(h.p.data.candidates[0].imageError,true);const before=h.modals.length;h.p.adopt(e);assert.equal(h.modals.length,before);await h.p.poll();assert.equal(!!h.p.data.candidates[0].imageError,false);h.p.candidateError({currentTarget:{dataset:{id:c.id,revision:c.revision+1,src:c.src,epoch:c.imageEpoch}}});assert.equal(!!h.p.data.candidates[0].imageError,false);h.setToken('new-owner');h.p.candidateError(e);assert.equal(!!h.p.data.candidates[0].imageError,false);});
test("隐藏卸载后的候选图片错误不回写",async()=>{for(const mode of ['hide','unload']){const h=fixture();await generate(h);const c=h.p.data.candidates[0];if(mode==='hide')h.p.onHide();else h.p.onUnload();h.p.candidateError({currentTarget:{dataset:{id:c.id,revision:c.revision,src:c.src,epoch:c.imageEpoch}}});assert.equal(!!h.p.data.candidates[0]?.imageError,false);}});

test("同候选重新加载后旧src/epoch错误不禁用新预览",async()=>{const h=fixture();await generate(h);const old=h.p.data.candidates[0];await h.p.poll();h.p.candidateError({currentTarget:{dataset:{id:old.id,revision:old.revision,src:old.src,epoch:old.imageEpoch}}});assert.equal(!!h.p.data.candidates[0].imageError,false);const current=h.p.data.candidates[0];h.p.candidateError({currentTarget:{dataset:{id:current.id,revision:current.revision,src:'old-path',epoch:current.imageEpoch}}});assert.equal(!!h.p.data.candidates[0].imageError,false);});

test("锁定素材旧风格已移除不伪称新首项风格",async()=>{const h=fixture();await prepare(h);assert.equal(h.p.data.preparedStyleLabel,'紫色卡片');h.cap.styles=[{id:'new-style',label:'另一风格'}];await h.p.refresh();assert.equal(h.p.data.preparedStyleLabel,'原风格已不可用');assert.equal(h.p._record.styleId,'purple');});
test("采用确认框打开后图片报错，确认不得提交",async()=>{const h=fixture();await generate(h);const c=h.p.data.candidates[0];const e={currentTarget:{dataset:{id:c.id,revision:c.revision,src:c.src,epoch:c.imageEpoch}}};h.p.adopt(e);h.p.candidateError(e);const before=h.calls.length;await h.confirm();assert.equal(h.calls.length,before);assert.equal(h.p._record.adoption,undefined);});
