const {uiBridge}=require('./ui-fixture.cjs');
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const session = {
  user: { role: "admin", playerId: "p1" },
  team: { name: "测试球队" },
};
function setup(name, overrides = {}, wxOverrides = {}) {
  const events = [];
  let definition;
  const api = {
    ensureSession: async () => session,
    getSession: () => session,
    request: async () => [],
    clearSession() {
      events.push(["clear"]);
    },
    ...overrides,
  };
  const wx = new Proxy(
    {
      stopPullDownRefresh() {},
      showModal(options) {
        options.success({ confirm: true });
      },
      ...wxOverrides,
    },
    {
      get(target, key) {
        return target[key] || ((options) => events.push([key, options]));
      },
    },
  );
  const context = vm.createContext({
    console,
    Map,
    Set,
    Date,
    Promise,
    encodeURIComponent,
    wx,
    Page(value) {
      definition = value;
    },
  });
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const source = fs.readFileSync(file, "utf8");
    const wrapped = vm.runInContext(
      "(function(require,module,exports){" + source + "\n})",
      context,
      { filename: file },
    );
    wrapped(
      (reference) => {
        if (reference.endsWith("/utils/ui")) return uiBridge(wx);
        if (reference.endsWith("/utils/api")) return api;
        if (reference.endsWith("/utils/media"))
          return {
            imageSource(value) {
              events.push(["imageSource", value]);
              if (
                typeof value === "string" &&
                value.startsWith("data:image/png;base64,")
              )
                return "wxfile://test/avatar.png";
              return "";
            },
          };
        if (reference.endsWith("/config"))
          return { apiBaseUrl: "https://club.example" };
        return load(path.resolve(path.dirname(file), reference + ".js"));
      },
      mod,
      mod.exports,
    );
    return mod.exports;
  }
  load(path.join(root, "pages", name, "index.js"));
  function instantiate() { return {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".");
        let target = this.data;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)] = value;
      }
    },
  };
  }
  const page = instantiate();
  return {
    newPage: instantiate,
    page,
    api,
    events,
    shared: load(path.join(root, "pages/shared.js")),
  };
}
const match = (extra = {}) => ({
  id: 1,
  date: "2026-11-15",
  kickoff: "10:00",
  opponent: "虚构对手",
  status: "published",
  homeScore: null,
  awayScore: 0,
  rsvps: [],
  roster: [],
  tacticSnapshots: [],
  ...extra,
});

test("management blocks non-admin load and write", async () => {
  let calls = 0;
  const { page } = setup("manage-team", {
    ensureSession: async () => ({ user: { role: "player" } }),
    request: async () => {
      calls++;
    },
  });
  await page.refresh();
  assert.match(page.data.error, /管理员/);
  page.data.form.name = "不可写";
  await page.save();
  assert.equal(calls, 0);
});
test("team patch carries original revision, preserves input on 409 and omits unchanged crest", async () => {
  let body;
  const { page } = setup("manage-team", {
    request: async (url, method, data) => {
      if (method === "PUT") {
        body = data;
        throw Object.assign(new Error("stale"), { status: 409 });
      }
      return { name: "球队", revision: 3, crest: "data:image/png;base64,AAAA" };
    },
  });
  await page.refresh();
  page.data.form.name = "新名字";
  await page.save();
  assert.equal(body.revision, 3);
  assert.equal(body.crest, undefined);
  assert.equal(page.data.form.name, "新名字");
  assert.equal(page.data.conflict, true);
  assert.equal(page.data.crest, "wxfile://test/avatar.png");
});
test("new player preserves zero/unknown and switches to revisioned update after creation", async () => {
  const calls = [];
  const { page } = setup("manage-player", {
    request: async (url, method, body) => {
      calls.push({ url, method, body });
      return { id: "new", revision: calls.length, hasAccount: false };
    },
  });
  await page.refresh();
  page.data.form.name = "队员";
  page.data.form.number = "0";
  await page.save();
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body.number, 0);
  assert.equal(page.data.id, "new");
  page.data.form.number = "";
  await page.save();
  assert.equal(calls[1].method, "PUT");
  assert.equal(calls[1].body.number, null);
  assert.equal(calls[1].body.revision, 1);
});
test("player validates exact positions and numeric input without transmitting", async () => {
  let calls = 0;
  const { page } = setup("manage-player", {
    request: async () => {
      calls++;
    },
  });
  await page.refresh();
  page.data.form.name = "队员";
  page.data.form.number = "1.2";
  await page.save();
  assert.equal(calls, 0);
  page.data.form.number = "";
  page.data.form.positions = [];
  await page.save();
  assert.equal(calls, 0);
  assert.match(page.data.actionError, /位置/);
  assert.equal(
    page.data.positionOptions.some((x) => x.name === "左后卫"),
    false,
  );
});
test("uncertain creation locks retries", async () => {
  let calls = 0;
  const { page } = setup("manage-season", {
    request: async () => {
      calls++;
      throw Object.assign(new Error("network"), { status: 0 });
    },
  });
  await page.refresh();
  page.data.form = {
    name: "赛季",
    startDate: "2026-09-01",
    endDate: "2027-05-31",
  };
  await page.save();
  await page.save();
  assert.equal(calls, 1);
  assert.equal(page.data.uncertain, true);
});
test("cross-year season supports dates; reverse range is blocked; conflict retains inputs", async () => {
  let calls = 0;
  const { page } = setup("manage-season", {
    request: async (url, method, body) => {
      if (method === "PUT") {
        calls++;
        assert.equal(body.revision, 8);
        throw Object.assign(new Error("range conflict"), { status: 409 });
      }
      return [
        {
          id: 7,
          revision: 8,
          name: "原赛季",
          startDate: "2026-09-01",
          endDate: "2027-05-31",
        },
      ];
    },
  });
  page.id = "7";
  await page.refresh();
  page.data.form.endDate = "2025-01-01";
  await page.save();
  assert.equal(calls, 0);
  page.data.form.endDate = "2027-02-01";
  await page.save();
  assert.equal(calls, 1);
  assert.equal(page.data.form.endDate, "2027-02-01");
  assert.equal(page.data.conflict, true);
});
test("cancelled archive and account confirmation do not send changes", async () => {
  let calls = 0;
  const { page } = setup(
    "manage-player",
    {
      request: async () => {
        calls++;
      },
    },
    {
      showModal(options) {
        options.success({ confirm: false });
      },
    },
  );
  page.id = "p1";
  page.data.authorized = true;
  page.data.password = "long-password";
  page.data.username = "player";
  page.archive();
  page.account();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 0);
  assert.equal(page.data.status, "active");
});
test("archive sends only status and revision, not unsaved profile", async () => {
  let sent;
  const { page } = setup("manage-player", {
    request: async (url, method, body) => {
      sent = body;
      return { revision: 6, status: "inactive" };
    },
  });
  page.id = "p1";
  page.data.authorized = true;
  page.data.revision = 5;
  page.data.form.name = "未保存";
  page.archive();
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.status, "inactive");
  assert.equal(sent.revision, 5);
  assert.equal(sent.name, undefined);
  assert.equal(page.data.status, "inactive");
});
test("account creation clears secret after completion and hide", async () => {
  let sent;
  const { page } = setup("manage-player", {
    request: async (url, method, body) => {
      sent = { url, method, body };
      return {};
    },
  });
  page.id = "p1";
  page.data.authorized = true;
  page.data.username = "member";
  page.data.password = "long-password";
  page.account();
  await new Promise((r) => setImmediate(r));
  assert.equal(sent.url, "/players/p1/account");
  assert.equal(sent.method, "POST");
  assert.equal(page.data.password, "");
  assert.equal(page.data.hasAccount, true);
  page.data.password = "never-cache";
  page.onHide();
  assert.equal(page.data.password, "");
});
test("late mutation response after unload does not update or navigate", async () => {
  let release;
  const { page, events } = setup("manage-team", {
    request: async () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  page.data.authorized = true;
  page.data.form.name = "队伍";
  page.data.revision = 1;
  const save = page.save();
  await new Promise((r) => setImmediate(r));
  page.onUnload();
  release({ name: "改变", revision: 2, crest: null });
  await save;
  assert.equal(page.data.revision, 1);
  assert.equal(
    events.some((e) => e[0] === "showToast"),
    false,
  );
});
test("image selection keeps base64 outside render data and unload clears it", () => {
  const { page } = setup(
    "manage-team",
    {},
    {
      chooseMedia(options) {
        options.success({
          tempFiles: [{ size: 12, tempFilePath: "wxfile://chosen.jpg" }],
        });
      },
      getFileSystemManager() {
        return {
          readFile(options) {
            options.success({ data: "/9j/AAAA" });
          },
        };
      },
    },
  );
  page.choose();
  assert.equal(page.data.crest, "wxfile://chosen.jpg");
  assert.equal(page._imageData, "data:image/jpeg;base64,/9j/AAAA");
  assert.equal(JSON.stringify(page.data).includes("base64"), false);
  page.onUnload();
  assert.equal(page._imageData, undefined);
});
test("reload cancellation retains unsaved form and revision", () => {
  const { page } = setup(
    "manage-season",
    {},
    {
      showModal(options) {
        options.success({ confirm: false });
      },
    },
  );
  page.data.form.name = "保留";
  page.data.revision = 4;
  page.reload();
  assert.equal(page.data.form.name, "保留");
  assert.equal(page.data.revision, 4);
});

test("account switch blocks stale team draft without transmitting", async () => {
  let token = "first",
    writes = 0;
  const { page } = setup("manage-team", {
    getSession: () => ({ token }),
    request: async (url, method) => {
      if (method === "PUT") writes++;
      return { name: "球队", revision: 1, crest: null };
    },
  });
  await page.refresh();
  page.data.form.name = "旧登录修改";
  token = "second";
  await page.save();
  assert.equal(writes, 0);
  assert.match(page.data.actionError, /登录已变化/);
});
test("late team load cannot replace newer form or revision", async () => {
  let release,
    reads = 0;
  const { page } = setup("manage-team", {
    request: async () => {
      reads++;
      return reads === 1
        ? new Promise((r) => {
            release = r;
          })
        : { name: "新", revision: 9, crest: null };
    },
  });
  const first = page.refresh();
  await new Promise((r) => setImmediate(r));
  await page.refresh();
  release({ name: "旧", revision: 2, crest: null });
  await first;
  assert.equal(page.data.revision, 9);
  assert.equal(page.data.form.name, "新");
});

for (const kind of ["player", "season"]) {
  test(kind + " uncertain creation survives new page but not new login", async () => {
    let token = "login-A";
    let calls = 0;
    const h = setup("manage-" + kind, {
      getSession: () => ({ ...session, token }),
      request: async () => { calls++; throw Object.assign(new Error("gateway"), {status: 502}); }
    });
    const p = h.page;
    await p.refresh();
    p.setData({ form: kind === "player"
      ? {name: "Demo", number:"", positions:["待定"], preferredFoot:"", note:""}
      : {name:"Demo", startDate:"2026-01-01", endDate:"2026-12-31"} });
    await p.save();
    assert.equal(p.data.uncertain, true);
    p.onUnload();
    const returned = h.newPage();
    await returned.refresh();
    assert.equal(returned.data.uncertain, true);
    assert.equal(returned.data.form.name, "Demo");
    assert.equal(JSON.stringify(returned.data).includes("login-A"), false);
    await returned.save();
    assert.equal(calls, 1);
    returned.confirmNotCreated();
    assert.equal(returned.data.uncertain, false);
    await returned.save();
    assert.equal(calls, 2);
    returned.onUnload();
    token = "login-B";
    const other = h.newPage();
    await other.refresh();
    assert.equal(other.data.uncertain, false);
    assert.equal(other.data.form.name, "");
  });
}
test("preflight failure does not mark creation uncertain", async () => {
 const h = setup("manage-season");
 await h.page.refresh();
 h.page.setData({form:{name:"X",startDate:"2026-01-01",endDate:"2026-12-31"}});
 h.api.ensureSession = async () => {throw new Error("offline");};
 await h.page.save();
 assert.equal(h.page.data.uncertain, false);
});
test("unloaded creation failure restores lock on next instance", async () => {
 let reject;
 const h = setup("manage-season", {getSession:()=>({...session,token:"A"}),
 request:()=>new Promise((_,r)=>{reject=r;})});
 await h.page.refresh();
 h.page.setData({form:{name:"X",startDate:"2026-01-01",endDate:"2026-12-31"}});
 const save = h.page.save();
 await new Promise(r=>setImmediate(r));
 h.page.onUnload();
 reject(new Error("offline"));
 await save;
 const next=h.newPage();
 await next.refresh();
 assert.equal(next.data.uncertain,true);
 assert.equal(next.data.form.name,"X");
});
test("late image read cannot undo removal or newer selection", () => {
 const reads=[];
 const h=setup("manage-player",{},{
 chooseMedia(o){o.success({tempFiles:[{size:12,tempFilePath:"wxfile://"+reads.length+".jpg"}]});},
 getFileSystemManager(){return {readFile(o){reads.push(o);}};}
 });
 h.page.choose();
 h.page.remove();
 reads[0].success({data:"/9j/AAAA"});
 assert.equal(h.page.data.avatar,"");
 assert.equal(h.page._imageData,null);
 h.page.choose();
 h.page.choose();
 reads[2].success({data:"/9j/BBBB"});
 reads[1].success({data:"/9j/AAAA"});
 assert.equal(h.page._imageData,"data:image/jpeg;base64,/9j/BBBB");
});
test("late image read cannot alter submitted profile", async () => {
 let read;
 const h=setup("manage-player",{request:async()=>({id:"p",revision:1})},{
 chooseMedia(o){o.success({tempFiles:[{size:12,tempFilePath:"wxfile://image.jpg"}]});},
 getFileSystemManager(){return {readFile(o){read=o;}};}
 });
 await h.page.refresh();
 h.page.setData({"form.name":"Demo"});
 h.page.choose();
 await h.page.save();
 read.success({data:"/9j/AAAA"});
 assert.equal(h.page._imageData,undefined);
 assert.equal(h.page.data.avatar,"");
});
for(const status of [200,400]) test("unloaded definite "+status+" clears pending creation",async()=>{
 let finish;
 const h=setup("manage-season",{getSession:()=>({...session,token:"A"}),
 request:()=>new Promise((resolve,reject)=>{finish=()=>status===200?resolve({id:7,revision:1}):reject(Object.assign(new Error("bad"),{status}));})});
 await h.page.refresh();
 h.page.setData({form:{name:"Demo",startDate:"2026-01-01",endDate:"2026-12-31"}});
 const saving=h.page.save();
 await new Promise(r=>setImmediate(r));
 h.page.onUnload();
 finish();
 await saving;
 const next=h.newPage();
 await next.refresh();
 assert.equal(next.data.uncertain,false);
});
