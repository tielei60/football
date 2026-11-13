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
    request: async () => [],
    clearSession() {
      events.push(["clear"]);
    },
    ...overrides,
  };
  const wx = new Proxy(
    {
      ...wxOverrides,
      stopPullDownRefresh() {},
      showModal(options) {
        options.success({ confirm: true });
      },
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
        if (reference.endsWith("/utils/api")) return api;
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
      ],
    }),
    "p1",
  );
  assert.equal(view.scoreLabel, "— : 0");
  assert.equal(view.dateLabel, "11月15日 周日");
  assert.equal(view.responseLabel, "待定");
  assert.equal(view.yesCount, 1);
  assert.equal(view.maybeCount, 1);
});
test("assets reject external and traversal paths, allow local raster data", () => {
  const { shared } = setup("home");
  assert.equal(shared.assetUrl("//evil.test/a.png"), "");
  assert.equal(shared.assetUrl("https://evil.test/a.png"), "");
  assert.equal(shared.assetUrl("/a/../secret"), "");
  assert.equal(
    shared.assetUrl("/avatars/a.png"),
    "https://club.example/avatars/a.png",
  );
  assert.equal(shared.assetUrl("data:image/svg+xml;base64,AAAA"), "");
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
  assert.equal(future[0].id, 4);
  assert.equal(future[0].monthHeading, "2026年11月");
  assert.equal(future[1].monthHeading, "2026年12月");
});
test("player search, number and position filter combine", () => {
  const { page } = setup("players");
  page.data.positions = ["全部位置", "前锋"];
  page.data.positionIndex = 1;
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

test('match reload atomically keeps form and revision from newest response', async () => {
  let release; let reads = 0;
  const old = new Promise(resolve => { release = resolve; });
  const { page } = setup('match-edit', {
    ensureSession: async () => ({ ...session, user: { role: 'admin' } }),
    request: async url => {
      if (url === '/seasons') return [];
      reads += 1;
      if (reads === 1) return old;
      return match({ revision: 8, opponent: '最新对手' });
    }
  });
  page.id = '1';
  const first = page.refresh();
  await new Promise(resolve => setImmediate(resolve));
  await page.refresh();
  assert.equal(page.data.revision, 8);
  release(match({ revision: 3, opponent: '旧对手' }));
  await first;
  assert.equal(page.data.revision, 8);
  assert.equal(page.data.form.opponent, '最新对手');
});

test('successful login retains session when switchTab synchronously unloads page', async () => {
  let pageRef;
  const { page, events } = setup('login', { login: async () => ({}) }, {
    switchTab() { pageRef.onUnload(); }
  });
  pageRef = page;
  page.data.username = 'member';
  page.data.password = 'test-password';
  await page.submit();
  assert.equal(page._disposed, true);
  assert.equal(page._authenticated, true);
  assert.equal(events.filter(event => event[0] === 'clear').length, 0);
  assert.equal(page.data.password, '');
});

test('pending login cancellation clears session before late success', async () => {
  let release;
  const { page, events } = setup('login', { login: () => new Promise(resolve => { release = resolve; }) });
  page.data.username = 'member'; page.data.password = 'test-password';
  const pending = page.submit();
  page.onUnload(); release({}); await pending;
  assert.equal(events.filter(event => event[0] === 'clear').length, 1);
  assert.equal(events.some(event => event[0] === 'switchTab'), false);
});

test('password hide/reentry clears fields and suppresses stale failure without locking controls', async () => {
  let rejectPassword;
  const { page } = setup('me', {
    request: async url => {
      if (url === '/auth/password') return new Promise((resolve, reject) => { rejectPassword = reject; });
      if (url === '/players') return [];
      return {players: []};
    }
  });
  page.data.currentPassword = 'old-password'; page.data.newPassword = 'new-password';
  const pending = page.changePassword();
  page.onHide();
  assert.equal(page.data.currentPassword, ''); assert.equal(page.data.newPassword, '');
  await page.refresh();
  page.input({currentTarget:{dataset:{field:'newPassword'}},detail:{value:'not-allowed-while-busy'}});
  assert.equal(page.data.newPassword, '');
  rejectPassword(new Error('旧请求错误')); await pending;
  assert.equal(page.data.actionError, ''); assert.equal(page.data.busy, false);
  page.input({currentTarget:{dataset:{field:'newPassword'}},detail:{value:'new-attempt'}});
  assert.equal(page.data.newPassword, 'new-attempt');
});

test('successful hidden password update still clears revoked credentials and returns to login', async () => {
  let release;
  const { page, events } = setup('me', {request: () => new Promise(resolve => { release = resolve; })});
  page.data.currentPassword = 'old-password'; page.data.newPassword = 'new-password';
  const pending = page.changePassword(); page.onHide(); release(); await pending;
  assert.equal(page.data.currentPassword, ''); assert.equal(page.data.newPassword, '');
  assert.equal(events.some(event => event[0] === 'clear'), true);
  assert.equal(events.find(event => event[0] === 'reLaunch')[1].url, '/pages/login/index');
  assert.equal(page.data.busy, false);
});
