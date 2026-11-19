const {uiBridge}=require('./ui-fixture.cjs');
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const session = {
  user: { role: "player", playerId: "p1" },
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
  if (!api.beginLogin) api.beginLogin = (...args) => { let settled=false; const promise=api.login(...args).finally(()=>{settled=true;}); return {promise,cancel(){if(!settled)api.clearSession();}}; };
  const storage=new Map();
  if(name==='match-edit'){const get=api.getSession;api.getSession=()=>{const v=get();return v?{...v,serverOrigin:v.serverOrigin||'https://club.example',user:{id:1,teamId:1,...v.user},team:{id:1,...v.team}}:v;};}
  const wx = new Proxy(
    {
      getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),
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
  api.enterAuthenticated ||= () => wx.switchTab({url:"/pages/home/index"});
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
  const page = {
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
  return {
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
test("formatting preserves unknown score, weekday and all RSVP counts", () => {
  const { shared } = setup("home");
  const view = shared.matchView(
    match({
      rsvps: [
        { playerId: "p1", response: "maybe" },
        { playerId: "p2", response: "yes" },
        { playerId: "p3", response: "no" },
      ],
    }),
    "p1",
  );
  assert.equal(view.scoreLabel, "— : 0");
  assert.equal(view.dateLabel, "11月15日 周日");
  assert.equal(view.responseLabel, "待定");
  assert.equal(view.yesCount, 1);
  assert.equal(view.maybeCount, 1);
  assert.equal(view.noCount, 1);
});
test("assetUrl delegates to the tested native media resolver", () => {
  const { shared, events } = setup("home");
  const source = "data:image/png;base64,AAAA";
  assert.equal(shared.assetUrl(source), "wxfile://test/avatar.png");
  assert.equal(events.find((event) => event[0] === "imageSource")[1], source);
});

test("schedule separates drafts and cancelled, groups months in order", () => {
  const { page } = setup("schedule");
  const rows = [
    match({ id: 1, status: "draft" }),
    match({ id: 2, status: "cancelled" }),
    match({ id: 3, status: "published", date: "2026-12-01" }),
    match({ id: 4, status: "published" }),
  ];
  assert.equal(page.filter(rows, "draft").length, 1);
  assert.equal(page.filter(rows, "past")[0].id, 2);
  const future = page.filter(rows, "upcoming");
  assert.equal(future[0].id, 3);
  assert.equal(future[0].monthHeading, "2026年12月");
  assert.equal(future[1].monthHeading, "2026年11月");
});
test("player search, number and position filter combine", () => {
  const { page } = setup("players");
  page.data.positions = ["全部位置", "前锋"];
  page.data.positionIndex = 1;
  page.data.selectedPosition = "前锋";
  const rows = [
    { id: "p1", name: "甲", number: 0, positions: ["前锋"], status: "active" },
    { id: "p2", name: "乙", number: 8, positions: ["门将"], status: "active" },
    {
      id: "p3",
      name: "丙",
      number: 8,
      positions: ["前锋"],
      status: "inactive",
    },
  ];
  assert.equal(page.filter(rows, "0", "active")[0].id, "p1");
  assert.equal(page.filter(rows, "8", "active").length, 0);
  assert.equal(page.filter(rows, "", "inactive")[0].id, "p3");
});
test("clearing player search preserves the selected status and position", () => {
  const {page}=setup("players");
  Object.assign(page.data,{loading:false,status:'active',selectedPosition:'前锋',search:'甲',players:[
    {id:'a',name:'甲',number:1,positions:['前锋'],status:'active'},
    {id:'b',name:'乙',number:2,positions:['前锋'],status:'active'},
    {id:'c',name:'丙',number:3,positions:['门将'],status:'active'},
    {id:'d',name:'丁',number:4,positions:['前锋'],status:'inactive'},
  ]});
  page.clearSearch();
  assert.equal(page.data.search,'');
  assert.deepEqual(Array.from(page.data.visible,p=>p.id),['a','b']);
  assert.equal(page.data.selectedPosition,'前锋');
  page.data.loading=true;page.data.search='保留';page.clearSearch();assert.equal(page.data.search,'保留');
});
test("match details use historical player identity and explicit appearances", async () => {
  const { page } = setup("match-detail", {
    request: async (url) =>
      url === "/players"
        ? [{ id: "p1", name: "新名字" }]
        : match({
            roster: [
              {
                playerId: "p1",
                playerSnapshot: { name: "历史姓名", number: 0 },
                appeared: null,
                goals: null,
                assists: 0,
                selection: "bench",
              },
            ],
          }),
  });
  page.id = "1";
  await page.refresh();
  assert.equal(page.data.roster[0].name, "历史姓名");
  assert.equal(page.data.roster[0].number, 0);
  assert.equal(page.data.roster[0].appearedLabel, "出场待确认");
  assert.equal(page.data.roster[0].goalsLabel, "—");
  assert.equal(page.data.roster[0].assistsLabel, 0);
});
test("repeated RSVP click does not submit twice and server response refreshes", async () => {
  let release,
    calls = 0;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const { page } = setup("match-detail", {
    request: async (url, method) => {
      if (method === "PUT") {
        calls++;
        await pending;
        return match();
      }
      return url === "/players"
        ? []
        : match({ rsvps: [{ playerId: "p1", response: "yes" }] });
    },
  });
  page.id = "1";
  page.data.canReply = true;
  page.data.match = { response: "" };
  const first = page.reply({ currentTarget: { dataset: { response: "yes" } } });
  await page.reply({ currentTarget: { dataset: { response: "yes" } } });
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(page.data.match.response, "yes");
  assert.equal(page.data.busy, false);
});
test("409 preserves edit fields and blocks blind retry", async () => {
  let calls = 0;
  const { page } = setup("match-edit", {
    request: async () => {
      calls++;
      throw Object.assign(new Error("stale"), { status: 409 });
    },
  });
  page.id = "1";
  page.data.revision = 2;
  page.data.seasons = [{ id: null, name: "未分配" }];
  page.data.form.opponent = "保留输入";
  page.data.form.date = "2026-11-15";
  await page.save();
  assert.equal(page.data.conflict, true);
  assert.equal(page.data.form.opponent, "保留输入");
  assert.equal(page.data.revision, 2);
  await page.save();
  assert.equal(calls, 1);
});
test("score validation rejects partial numeric values without transmission", async () => {
  let calls = 0;
  const { page } = setup("match-edit", {
    request: async () => {
      calls++;
    },
  });
  page.data.form = {
    opponent: "对手",
    date: "2026-11-15",
    homeScore: "1x",
    awayScore: "",
  };
  await page.save();
  assert.equal(calls, 0);
  assert.match(page.data.actionError, /非负整数/);
});
test("network error surfaces retry state and expired session navigates to login", async () => {
  const { page, events } = setup("home", {
    ensureSession: async () => {
      throw Object.assign(new Error("登录已过期"), { status: 401 });
    },
  });
  await page.refresh();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.error, "登录已过期");
  assert.equal(
    events.find((e) => e[0] === "redirectTo")[1].url,
    "/pages/login/index",
  );
  const other = setup("home", {
    request: async () => {
      throw new Error("网络连接失败");
    },
  });
  await other.page.refresh();
  assert.equal(other.page.data.error, "网络连接失败");
  assert.equal(other.page.data.loading, false);
});
test("late load does not overwrite newer load, hidden tabs purge member data", async () => {
  const { page, shared } = setup("home");
  let release;
  const wait = new Promise((r) => {
    release = r;
  });
  const first = shared.load(page, async () => {
    await wait;
    return { team: { name: "旧队伍" } };
  });
  await shared.load(page, async () => ({ team: { name: "新队伍" } }));
  release();
  await first;
  assert.equal(page.data.team.name, "新队伍");
  page.onHide();
  assert.equal(Object.keys(page.data.team).length, 0);
  assert.equal(page.data.stats, null);
});
test("login rejects empty fields and only navigates after success", async () => {
  let calls = 0;
  const { page, events } = setup("login", {
    login: async () => {
      calls++;
    },
  });
  await page.submit();
  assert.equal(calls, 0);
  page.data.username = "member";
  page.data.password = "test-password";
  await page.submit();
  assert.equal(calls, 1);
  assert.equal(page.data.password, "");
  assert.equal(
    events.find((e) => e[0] === "switchTab")[1].url,
    "/pages/home/index",
  );
});
test("statistics ranking keeps null below explicit zero", () => {
  const { page } = setup("statistics");
  const ranked = page.rank(
    [
      { name: "甲", goals: null },
      { name: "乙", goals: 0 },
    ],
    "goals",
  );
  assert.equal(ranked[0].name, "乙");
  assert.equal(ranked[0].value, 0);
  assert.equal(ranked[1].value, "—");
});

test("statistics defaults to all matches with combined totals, avatars and scope-aware rankings", async () => {
  const requests=[];
  const {page}=setup("statistics",{request:async url=>{
    requests.push(url);
    if(url==='/seasons')return [{id:9,name:'跨年赛季'}];
    if(url==='/players')return [{id:'p1',name:'甲',avatar:'data:image/png;base64,AAAA',positions:[]},{id:'p2',name:'乙',positions:[]}];
    return {filter:{label:'全部比赛'},team:{goalsFor:null,goalsAgainst:null},players:[{playerId:'p1',name:'甲',goals:2,assists:null,appearances:3},{playerId:'p2',name:'乙',goals:1,assists:4,appearances:2}]};
  }});
  await page.refresh();
  assert.ok(requests.includes('/statistics?all=1'));
  assert.equal(page.data.metric,'overall');
  assert.equal(page.data.leaders[0].name,'甲');
  assert.equal(page.data.leaders[0].avatar,'wxfile://test/avatar.png');
  assert.equal(page.data.leaders[0].assistsLabel,'—');
  assert.equal(page.data.leaders[1].initial,'乙');
  page.imageError({currentTarget:{dataset:{id:'p1',index:0}}});
  page.metric({currentTarget:{dataset:{metric:'assists'}}});
  assert.equal(page.data.leaders[0].name,'乙');
  assert.equal(page.data.leaders[1].avatar,'');
  page.season({detail:{value:2}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(requests.includes('/statistics?seasonId=9'));
});

test("match reload atomically keeps form and revision from newest response", async () => {
  let release;
  let reads = 0;
  const old = new Promise((resolve) => {
    release = resolve;
  });
  const { page } = setup("match-edit", {
    ensureSession: async () => ({ ...session, user: { role: "admin" } }),
    request: async (url) => {
      if (url === "/seasons" || url === "/venues") return [];
      reads += 1;
      if (reads === 1) return old;
      return match({ revision: 8, opponent: "最新对手" });
    },
  });
  page.id = "1";
  const first = page.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  await page.refresh();
  assert.equal(page.data.revision, 8);
  release(match({ revision: 3, opponent: "旧对手" }));
  await first;
  assert.equal(page.data.revision, 8);
  assert.equal(page.data.form.opponent, "最新对手");
});

test("successful login retains session when switchTab synchronously unloads page", async () => {
  let pageRef;
  const { page, events } = setup(
    "login",
    { login: async () => ({}) },
    {
      switchTab() {
        pageRef.onUnload();
      },
    },
  );
  pageRef = page;
  page.data.username = "member";
  page.data.password = "test-password";
  await page.submit();
  assert.equal(page._disposed, true);
  assert.equal(page._authenticated, true);
  assert.equal(events.filter((event) => event[0] === "clear").length, 0);
  assert.equal(page.data.password, "");
});

test("pending login cancellation clears session before late success", async () => {
  let release;
  const { page, events } = setup("login", {
    login: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  page.data.username = "member";
  page.data.password = "test-password";
  const pending = page.submit();
  page.onUnload();
  release({});
  await pending;
  assert.equal(events.filter((event) => event[0] === "clear").length, 1);
  assert.equal(
    events.some((event) => event[0] === "switchTab"),
    false,
  );
});

test("password hide/reentry clears fields and suppresses stale failure without locking controls", async () => {
  let rejectPassword;
  const { page } = setup("me", {
    request: async (url) => {
      if (url === "/auth/password")
        return new Promise((resolve, reject) => {
          rejectPassword = reject;
        });
      if (url === "/players") return [];
      return { players: [] };
    },
  });
  page.data.currentPassword = "old-password";
  page.data.newPassword = "new-password";
  const pending = page.changePassword();
  page.onHide();
  assert.equal(page.data.currentPassword, "");
  assert.equal(page.data.newPassword, "");
  await page.refresh();
  page.input({
    currentTarget: { dataset: { field: "newPassword" } },
    detail: { value: "not-allowed-while-busy" },
  });
  assert.equal(page.data.newPassword, "");
  rejectPassword(new Error("旧请求错误"));
  await pending;
  assert.equal(page.data.actionError, "");
  assert.equal(page.data.busy, false);
  page.input({
    currentTarget: { dataset: { field: "newPassword" } },
    detail: { value: "new-attempt" },
  });
  assert.equal(page.data.newPassword, "new-attempt");
});

test("successful hidden password update clears revoked credentials without late navigation", async () => {
  let release;
  const { page, events } = setup("me", {
    request: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  page.data.currentPassword = "old-password";
  page.data.newPassword = "new-password";
  const pending = page.changePassword();
  page.onHide();
  release();
  await pending;
  assert.equal(page.data.currentPassword, "");
  assert.equal(page.data.newPassword, "");
  assert.equal(
    events.some((event) => event[0] === "clear"),
    true,
  );
  assert.equal(events.some(event => event[0] === "reLaunch"), false);
  assert.equal(page.data.busy, false);
});

test("large snapshots/base64 never cross setData and session credentials are not projected", async () => {
  const huge = "x".repeat(32 * 1024 * 1024);
  const crest = "data:image/png;base64," + "A".repeat(2800000);
  const account = {
    ...session,
    token: "must-not-enter-page",
    team: { name: "测试球队", crest },
  };
  const raw = match({
    tacticSnapshots: [
      { sourceTacticId: 1, tactic: { name: "留档", data: huge } },
    ],
  });
  const detail = setup("match-detail", {
    ensureSession: async () => account,
    request: async (url) => (url === "/players" ? [] : raw),
  });
  detail.page.id = "1";
  await detail.page.refresh();
  const serialized = JSON.stringify(detail.page.data);
  assert.ok(serialized.length < 5000);
  assert.equal(serialized.includes(crest), false);
  assert.equal(serialized.includes(huge), false);
  assert.equal(detail.page.data.snapshots[0].name, "留档");
  const home = setup("home", {
    ensureSession: async () => account,
    request: async (url) =>
      url === "/players"
        ? []
        : url === "/matches"
          ? [raw]
          : { team: { matches: 0, wins: 0 } },
  });
  await home.page.refresh();
  assert.equal(home.page.data.team.crest, "wxfile://test/avatar.png");
  assert.ok(JSON.stringify(home.page.data).length < 5000);
  const me = setup("me", {
    ensureSession: async () => account,
    request: async (url) =>
      url === "/players"
        ? [{ id: "p1", name: "成员", avatar: crest, positions: [] }]
        : { players: [] },
  });
  await me.page.refresh();
  assert.equal(me.page.data.player.avatar, "wxfile://test/avatar.png");
  assert.ok(JSON.stringify(me.page.data).length < 5000);
  assert.equal(me.page.data.session.token, undefined);
  assert.equal(me.page.data.session.team.crest, undefined);
});

test("render bridge refuses oversize data explicitly rather than exceeding 1MB", async () => {
  const { page, shared } = setup("home");
  await shared.load(page, async () => ({ unknownBulk: "A".repeat(1000001) }));
  assert.match(page.data.error, /记录过多/);
  assert.equal(page.data.unknownBulk, undefined);
  assert.equal(page.data.loading, false);
});

test("uncertain match creation is locked and offers schedule verification; 400 remains retryable", async () => {
  let calls = 0;
  const { page, events } = setup("match-edit", {
    request: async () => {
      calls++;
      throw Object.assign(new Error("network"), { status: 0 });
    },
  });
  page.data.seasons = [{ id: null }];
  page.data.form.opponent = "对手";
  page.data.form.date = "2026-11-15";
  await page.save();
  await page.save();
  assert.equal(calls, 1);
  assert.equal(page.data.uncertain, true);
  assert.match(page.data.actionError, /可能已创建/);
  page.checkSchedule();
  assert.equal(
    events.find((e) => e[0] === "switchTab")[1].url,
    "/pages/schedule/index",
  );
  let validationCalls = 0;
  const retry = setup("match-edit", {
    request: async () => {
      validationCalls++;
      throw Object.assign(new Error("validation"), { status: 400 });
    },
  }).page;
  retry.data.seasons = [{ id: null }];
  retry.data.form.opponent = "对手";
  retry.data.form.date = "2026-11-15";
  await retry.save();
  await retry.save();
  assert.equal(validationCalls, 2);
  assert.equal(retry.data.uncertain, false);
});

test("position choice survives reordered options and removed choice resets consistently", async () => {
  let rows = [
    { id: "fw", name: "前锋", number: 1, status: "active", positions: ["FW"] },
    { id: "gk", name: "门将", number: 2, status: "active", positions: ["GK"] },
  ];
  const { page } = setup("players", { request: async () => rows });
  await page.refresh();
  page.position({ detail: { value: 1 } });
  assert.equal(page.data.selectedPosition, "FW");
  rows = [rows[1], rows[0]];
  await page.refresh();
  assert.equal(page.data.positions[page.data.positionIndex], "FW");
  assert.equal(page.data.visible[0].id, "fw");
  rows = [rows[0]];
  await page.refresh();
  assert.equal(page.data.selectedPosition, "");
  assert.equal(page.data.positionIndex, 0);
  assert.equal(page.data.visible[0].id, "gk");
});

test("season selection survives option order changes and local year is explicit", async () => {
  let seasons = [
    { id: 7, name: "甲赛季" },
    { id: 9, name: "乙赛季" },
  ];
  const requests = [];
  const stats = { team: { goalsFor: null, goalsAgainst: null }, players: [] };
  const { page } = setup("statistics", {
    request: async (url) => {
      requests.push(url);
      return url === "/seasons" ? seasons : url === "/players" ? [] : stats;
    },
  });
  await page.refresh();
  page.data.selectedSeasonId = 9;
  page.data.seasonIndex = 3;
  seasons = [seasons[1], seasons[0]];
  await page.refresh();
  assert.equal(page.data.seasons[page.data.seasonIndex].id, 9);
  assert.equal(requests.at(-1), "/statistics?seasonId=9");
  for (const name of ["home", "me"]) {
    const seen = [];
    const current = setup(name, {
      request: async (url) => {
        seen.push(url);
        return url === "/players" || url === "/matches"
          ? []
          : { team: { matches: 0, wins: 0 }, players: [] };
      },
    });
    await current.page.refresh();
    assert.ok(seen.includes("/statistics?year=" + new Date().getFullYear()));
  }
});

test("5xx unknown creation retains draft only for same login and requires explicit reconciliation", async () => {
  let account = {
    user: { id: 8, teamId: 2, role: "admin" },
    team: { name: "队伍" },
    token: "first",
    expiresAt: 123,
  };
  let creates = 0;
  const { page } = setup("match-edit", {
    ensureSession: async () => ({user: account.user, team: account.team}),
    getSession: () => account,
    request: async (url, method) => {
      if (method === "POST") {
        creates++;
        throw Object.assign(new Error("gateway"), { status: 502 });
      }
      return [];
    },
  });
  await page.refresh();
  page.data.form.opponent = "保留这个对手";
  page.data.form.date = "2026-11-15";
  await page.save();
  assert.equal(page.data.uncertain, true);
  page.onUnload();
  page.data.form.opponent = "";
  page._hidden=false; // 新页面实例可见；onUnload后的旧实例不能直接模拟可见页面。
  await page.refresh();
  assert.equal(page.data.form.opponent, "保留这个对手");
  assert.equal(page.data.uncertain, true);
  assert.equal(JSON.stringify(page.data).includes("first"), false);
  await page.save();
  assert.equal(creates, 1);
  page.confirmAbsent();
  assert.equal(page.data.uncertain, false);
  assert.equal(page.data.form.opponent, "保留这个对手");
  await page.save();
  assert.equal(creates, 2);
  page.onUnload();
  account = { ...account, token: "new-login" };
  page.data.form.opponent = "";
  page._hidden=false; // 新页面实例可见；onUnload后的旧实例不能直接模拟可见页面。
  await page.refresh();
  assert.equal(page.data.uncertain, true); // 同账号新token仍须核对，草稿本身不持久化。
  assert.equal(page.data.form.opponent, "");
});


test("player refresh cannot inherit the hidden admin draft filter", async () => {
  const { page } = setup("schedule", {
    // ensureSession 返回身份；持久会话的 token 单独由 getSession 提供。
    getSession: () => ({ ...session, token: "fixture-schedule-owner" }),
    ensureSession: async () => session,
    request: async () => [match()],
  });
  page.data.tab = "draft";
  await page.refresh();
  assert.equal(page.data.admin, false);
  assert.equal(page.data.tab, "upcoming");
  assert.equal(page.data.visible.length, 1);
});

test("shared status component retry is wired on every data page", () => {
  let component;
  vm.runInNewContext(fs.readFileSync(path.join(root, "components/page-state/index.js"), "utf8"), {
    Component(value) { component = value; },
  });
  const emitted = [];
  component.methods.retry.call({ triggerEvent(name) { emitted.push(name); } });
  assert.deepEqual(emitted, ["retry"]);
  for (const name of ["home", "schedule", "players", "statistics", "me", "player-detail", "match-detail", "match-edit"]) {
    const template = fs.readFileSync(path.join(root, "pages", name, "index.wxml"), "utf8");
    assert.match(template, /<page-state id="page-state"[\s\S]*?bind:retry="refresh"/);
  }
});

test("switching away and back to the original venue restores historical location", async () => {
  const {page}=setup('match-edit',{ensureSession:async()=>({...session,user:{role:'admin'}}),request:async(url)=>url==='/seasons'?[]:url==='/venues'?[{id:1,name:'A当前',fieldNumber:'B',address:'新地址',status:'active'},{id:2,name:'B',fieldNumber:'1号场',address:'B地址',status:'active'}]:match({venueId:1,venueSnapshot:{name:'A历史',fieldNumber:'A'},location:'原比赛地址',revision:2})});
  page.id='1';await page.refresh();assert.equal(page.data.venues[1].displayName,'A历史 · A（本场留存）');assert.equal(page.data.venues[2].displayName,'B · 1号场');page.pick({currentTarget:{dataset:{field:'venueIndex'}},detail:{value:2}});assert.equal(page.data.form.location,'B · 1号场 · B地址');
  page.pick({currentTarget:{dataset:{field:'venueIndex'}},detail:{value:1}});assert.equal(page.data.form.location,'原比赛地址');
});

test('in-flight create is locked across page instances and cannot be manually unlocked', async () => {
  let finish, count = 0;
  const account = { user: { id: 1, teamId: 1, role: 'admin' }, team: {}, token: 'private-login', expiresAt: 999 };
  const { page } = setup('match-edit', {
    ensureSession: async () => ({ user: account.user, team: account.team }), getSession: () => account,
    request: async (url, method) => method === 'POST' ? (count++, new Promise(resolve => { finish = resolve; })) : [],
  });
  await page.refresh();
  page.data.form.opponent = '请求中的比赛'; page.data.form.date = '2026-11-15';
  const clean = structuredClone(page.data);
  const pending = page.save(); page.onUnload();
  const next = { ...page, data: clean, _disposed: false, _hidden: false };
  await next.refresh();
  assert.equal(next.data.uncertain, true);
  assert.equal(next.data.form.opponent, '请求中的比赛');
  assert.equal(JSON.stringify(next.data).includes(account.token), false);
  next.confirmAbsent(); assert.equal(next.data.uncertain, true);
  await next.save(); assert.equal(count, 1);
  finish({ id: 9 }); await pending;
  await next.refresh(); assert.equal(next.data.uncertain, false);
});

test('unloaded creation clears known 4xx but retains network and 5xx outcomes', async () => {
  for (const status of [400, 403, 0, 502]) {
    let reject;
    const account = { user: { id: 1, teamId: 1, role: 'admin' }, team: {}, token: 'account', expiresAt: 999 };
    const { page } = setup('match-edit', {
      ensureSession: async () => ({ user: account.user, team: account.team }), getSession: () => account,
      request: async (url, method) => method === 'POST' ? new Promise((resolve, fail) => { reject = fail; }) : [],
    });
    await page.refresh(); page.data.form.opponent = '结果待定'; page.data.form.date = '2026-11-15';
    const clean = structuredClone(page.data), pending = page.save(); page.onUnload();
    reject(Object.assign(new Error('response'), { status })); await pending;
    const next = { ...page, data: clean, _disposed: false, _hidden: false };
    await next.refresh(); assert.equal(next.data.uncertain, status === 0 || status >= 500);
  }
});

test('old create success cannot clear the newer login attempt', async () => {
  const finish = []; let account = { user: { id: 1, teamId: 1, role: 'admin' }, team: {}, token: 'old', expiresAt: 999 };
  const { page } = setup('match-edit', {
    ensureSession: async () => ({ user: account.user, team: account.team }), getSession: () => account,
    request: async (url, method) => method === 'POST' ? new Promise(resolve => finish.push(resolve)) : [],
  });
  await page.refresh(); page.data.form.opponent = '原请求'; page.data.form.date = '2026-11-15';
  const clean = structuredClone(page.data), first = page.save(); page.onUnload();
  account = { ...account, user:{...account.user,id:2}, token: 'new' };
  const next = { ...page, data: clean, _disposed: false, _hidden: false }; await next.refresh();
  next.data.form.opponent = '新请求'; const second = next.save(); next.onUnload();
  finish[0]({ id: 8 }); await first;
  const again = { ...next, data: { ...structuredClone(next.data), busy: false }, _disposed: false, _hidden: false };
  await again.refresh(); assert.equal(again.data.uncertain, true); assert.equal(again.data.form.opponent, '新请求');
  again.confirmAbsent(); assert.equal(again.data.uncertain, true);
  finish[1]({ id: 9 }); await second;
  await again.refresh(); assert.equal(again.data.uncertain, false);
});

for(const success of [true,false]) test('hidden login '+(success?'success':'failure')+' cannot navigate or report stale error',async()=>{
 let settle,cancelled=0;
 const {page,events}=setup('login',{beginLogin(){return {promise:new Promise((resolve,reject)=>{settle=()=>success?resolve({}):reject(new Error('late'));}),cancel(){cancelled++;}};}});
 page.data.username='fictional';page.data.password='test-only';const pending=page.submit();page.onHide();page.onShow();settle();await pending;
 assert.equal(cancelled,1);assert.equal(page.data.password,'');assert.equal(page.data.busy,false);assert.equal(page.data.error,'');assert.equal(events.some(e=>e[0]==='switchTab'),false);
});
test('old login unload uses only its handle and cannot clear newer identity',async()=>{
 let settle,cancels=0;
 const {page,events}=setup('login',{beginLogin(){return {promise:new Promise(r=>settle=r),cancel(){cancels++;}};}});
 page.data.username='fictional';page.data.password='test-only';const pending=page.submit();page.onUnload();settle({});await pending;
 assert.equal(cancels,1);assert.equal(events.some(e=>e[0]==='clear'),false);assert.equal(events.some(e=>e[0]==='switchTab'),false);
});

function saveFixture(){
 let resolve,reject,account={token:'save-owner',expiresAt:999,user:{id:1,teamId:1,role:'admin'},team:{id:1}};
 const h=setup('match-edit',{getSession:()=>account,ensureSession:async()=>({user:account.user,team:account.team}),request:async(url,method)=>method==='POST'||method==='PUT'?new Promise((a,b)=>{resolve=a;reject=b;}):url==='/seasons'||url==='/venues'?[]:match({revision:3})});
 h.finish=value=>resolve(value);h.fail=status=>reject(Object.assign(Error('failed'),{status}));h.changeOwner=()=>account={...account,token:'other-owner'};
 h.prepare=async()=>{await h.page.refresh();h.page.data.form.opponent='匿名演练';h.page.data.form.date='2026-11-15';};return h;
}
test('保存隐藏后成功不导航，返回展示已保存入口且不能重复POST',async()=>{const h=saveFixture();await h.prepare();const p=h.page.save();h.page.onHide();h.finish({id:7});await p;assert.equal(h.events.some(e=>e[0]==='redirectTo'),false);await h.page.onShow();assert.equal(h.page.data.savedId,7);assert.equal(h.page.data.uncertain,false);h.page.openSaved();const nav=h.events.find(e=>e[0]==='redirectTo')[1];nav.fail();assert.match(h.page.data.actionError,/已保存/);assert.equal(h.page.data.savedId,7);await h.page.save();assert.equal(h.page.data.busy,false);nav.success();});
test('隐藏后先返回等待旧保存结束，只更新结果不自动导航',async()=>{const h=saveFixture();await h.prepare();const p=h.page.save();h.page.onHide();const shown=h.page.onShow();h.finish({id:8});await Promise.all([p,shown]);assert.equal(h.page.data.savedId,8);assert.equal(h.events.some(e=>e[0]==='redirectTo'),false);});
test('卸载重入的新实例等待原创建结果并显示savedId，不困于uncertain',async()=>{const h=saveFixture();await h.prepare();const p=h.page.save();h.page.onUnload();const next={...h.page,data:structuredClone(h.page.data),_disposed:false,_hidden:false,_wasShown:false,_saveAttempt:null};await next.refresh();const shown=next.onShow();h.finish({id:9});await Promise.all([p,shown]);assert.equal(next.data.savedId,9);assert.equal(next.data.uncertain,false);assert.equal(h.events.some(e=>e[0]==='redirectTo'),false);});
test('旧账号保存响应不能导航或在新账号显示savedId',async()=>{const h=saveFixture();await h.prepare();const p=h.page.save();h.page.onHide();h.changeOwner();h.finish({id:10});await p;await h.page.onShow();assert.equal(h.page.data.savedId,null);assert.equal(h.page.data.form.opponent,'');assert.equal(h.events.some(e=>e[0]==='redirectTo'),false);});
for(const id of [undefined,0,-1,1.5,'12'])test('非法保存结果ID '+id+'进入未知核对而非错误导航',async()=>{const h=saveFixture();await h.prepare();const p=h.page.save();h.finish({id});await p;assert.equal(h.page.data.uncertain,true);assert.equal(h.page.data.savedId,null);assert.equal(h.events.some(e=>e[0]==='redirectTo'),false);});
for(const status of [409,500])test('编辑隐藏期间'+status+'返回保留冲突不重放保存',async()=>{const h=saveFixture();h.page.id='1';await h.prepare();const p=h.page.save();h.page.onHide();h.fail(status);await p;await h.page.onShow();assert.equal(h.page.data.conflict,true);assert.equal(h.page.data.savedId,null);assert.equal(h.events.some(e=>e[0]==='redirectTo'),false);});
test('换账号手工确认不泄露旧保存ID',async()=>{const h=saveFixture();await h.prepare();const p=h.page.save();h.page.onHide();h.finish({id:17});await p;h.changeOwner();h.page._hidden=false;h.page.confirmAbsent();assert.equal(h.page.data.savedId,null);});
test('已保存结果返回时清除被隐藏中断的loading',async()=>{const h=saveFixture();await h.prepare();const p=h.page.save();h.page.onHide();h.page.data.loading=true;h.finish({id:18});await p;await h.page.onShow();assert.equal(h.page.data.loading,false);assert.equal(h.page.data.savedId,18);});
test('初次加载中隐藏再返回重新加载，不遗留loading',async()=>{let release,calls=0;const account={token:'A',user:{id:1,teamId:1,role:'admin'},team:{id:1}};const h=setup('match-edit',{getSession:()=>account,ensureSession:()=>{calls++;return calls===1?new Promise(r=>release=r):Promise.resolve(account);},request:async()=>[]});h.page.onLoad({});await h.page.onShow();h.page.onHide();const show=h.page.onShow();release(account);await show;assert.equal(h.page.data.loading,false);assert.equal(h.page.data.error,'');});
test('报名人数显示上限，编辑时支持留空及有效人数', async () => {
  const { page, shared } = setup('match-edit', { request: async () => ({ id: 1 }) });
  const limited = shared.matchView(match({ maxParticipants: 10, rsvps: [{playerId:'p1', response:'yes'}] }), 'p1');
  assert.equal(limited.signupCountLabel, '1/10');
  assert.equal(shared.matchView(match(), 'p1').signupCountLabel, '0');
  assert.equal(shared.matchView(match({rsvps:[{playerId:'p1',response:'yes'}]}), 'p1').signupCountLabel, '1');
  page.data.seasons = [{ id: null }]; page.data.form.opponent = '对手'; page.data.form.date = '2026-11-15';
  page.data.form.maxParticipants = '0'; await page.save(); assert.match(page.data.actionError, /报名人数/);
  let sent; const f = setup('match-edit', { request: async (url, method, body) => { sent = body; return { id: 2 }; } });
  f.page.data.seasons = [{ id: null }]; f.page.data.form.opponent = '对手'; f.page.data.form.date = '2026-11-15'; f.page.data.form.maxParticipants = '10';
  await f.page.save(); assert.equal(sent.maxParticipants, 10);
});

test('V3 首页四个快捷入口仅导航到既有页面，拒绝未知入口和失效页面', () => {
  const {page,events}=setup('home');
  page.data.loading=false;
  for(const name of ['schedule','players','statistics','tactics']) page.shortcut({currentTarget:{dataset:{page:name}}});
  assert.deepEqual(events.map(e=>[e[0],e[1].url]),[['switchTab','/pages/schedule/index'],['switchTab','/pages/players/index'],['switchTab','/pages/statistics/index'],['navigateTo','/pages/tactics/index']]);
  page.shortcut({currentTarget:{dataset:{page:'system-accounts'}}});
  page._hidden=true;page.shortcut({currentTarget:{dataset:{page:'players'}}});
  assert.equal(events.length,4);
});
test('V3 我的快捷入口仅绑定本人可进入照片，未绑定和失效页面不导航',()=>{
  const {page,events}=setup('me');
  Object.assign(page.data,{loading:false,session,player:null});
  page.photos();assert.equal(events.length,0);
  page.data.player={id:'other'};page.photos();assert.equal(events.length,0);
  page.data.player={id:'p1'};page.photos();page.matches();
  assert.deepEqual(events.map(e=>[e[0],e[1].url]),[['navigateTo','/pages/player-photos/index?id=p1'],['switchTab','/pages/schedule/index']]);
  page._hidden=true;page.photos();page.matches();assert.equal(events.length,2);
});
