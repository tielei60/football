// Real mini-program controllers + API transport -> isolated HTTP -> file SQLite.
// wx rendering, picker, modal and navigation surfaces are simulated. No WeChat
// account, canvas, share recipient, production database or external network is used.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const http = require("node:http");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const { createRequire } = require("node:module");
const mini = path.resolve(__dirname, "..");
const sharp = createRequire(path.join(mini, "../app/package.json"))("sharp");
const credentials = { username: "fictional-v3-owner", password: "fictional-v3-password" };
const clone = (value) => JSON.parse(JSON.stringify(value));
const event = (key, value) => ({ currentTarget: { dataset: { [key]: value } } });
const input = (page, field, value) => page.input({ currentTarget: { dataset: { field } }, detail: { value } });
async function until(check, label) {
  const end = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > end) throw Error("Timed out: " + label);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(t) {
  const { createFootballServer } = await import("../../server/index.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "football-v3-controller-"));
  const databasePath = path.join(directory, "isolated.sqlite");
  let server;
  const config = { apiBaseUrl: "", allowLocalHttp: true };
  async function start() {
    server = createFootballServer({ databasePath, bootstrapAdmin: credentials });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    config.apiBaseUrl = "http://127.0.0.1:" + server.address().port;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await start();
  const db = new DatabaseSync(databasePath);
  // Fixture-only role setup. All business operations below use real HTTP.
  db.exec(
    "UPDATE club_users SET is_system_admin=1,must_change_password=0; INSERT INTO club_users(team_id,username,password_hash,role) SELECT team_id,'fictional-ordinary',password_hash,'admin' FROM club_users WHERE is_system_admin=1"
  );
  t.after(async () => {
    db.close();
    await stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const png = await sharp({ create: { width: 24, height: 18, channels: 4, background: "#8855bb" } })
    .png()
    .toBuffer();
  const jpg = await sharp({ create: { width: 20, height: 16, channels: 3, background: "#ccbbee" } })
    .jpeg()
    .toBuffer();
  const pngPath = path.join(directory, "fictional-icon.png");
  const jpgPath = path.join(directory, "fictional-image.jpg");
  fs.writeFileSync(pngPath, png);
  fs.writeFileSync(jpgPath, jpg);
  const storage = new Map(),
    calls = [],
    patches = [],
    navigation = [],
    modals = [];
  const runtime = { confirm: true, selectedFile: pngPath, loseReply: null, hold: null };
  const ui = {
    abort() {},
    showToast() {},
    showModal(page, options) {
      modals.push(options);
      const answer = { confirm: runtime.confirm, cancel: !runtime.confirm };
      options.success?.(answer);
      return Promise.resolve(answer);
    },
  };
  const fsm = {
    mkdirSync: (p, recursive) => fs.mkdirSync(p, { recursive: !!recursive }),
    writeFileSync: (p, data, encoding) => fs.writeFileSync(p, data, encoding),
    readdirSync: (p) => fs.readdirSync(p),
    unlinkSync: (p) => fs.unlinkSync(p),
    readFile(o) {
      try {
        o.success({ data: fs.readFileSync(o.filePath, o.encoding) });
      } catch (error) {
        o.fail?.(error);
      }
    },
  };
  const navigate = (kind) => (options) => {
    navigation.push({ kind, ...options });
    options?.success?.({});
  };
  const wx = {
    env: { USER_DATA_PATH: directory },
    getFileSystemManager: () => fsm,
    getStorageSync: (k) => storage.get(k),
    setStorageSync: (k, v) => storage.set(k, clone(v)),
    removeStorageSync: (k) => storage.delete(k),
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    stopPullDownRefresh() {},
    setNavigationBarTitle() {},
    enableAlertBeforeUnload() {},
    disableAlertBeforeUnload() {},
    navigateTo: navigate("navigateTo"),
    navigateBack: navigate("navigateBack"),
    redirectTo: navigate("redirectTo"),
    reLaunch: navigate("reLaunch"),
    switchTab: navigate("switchTab"),
    chooseMedia(o) {
      o.success({ tempFiles: [{ tempFilePath: runtime.selectedFile, size: fs.statSync(runtime.selectedFile).size }] });
    },
    request(o) {
      assert.equal(new URL(o.url).origin, config.apiBaseUrl, "test never contacts any external host");
      const call = {
        route: new URL(o.url).pathname + new URL(o.url).search,
        method: o.method || "GET",
        body: o.data === undefined ? undefined : clone(o.data),
      };
      calls.push(call);
      const request = http.request(o.url, { method: call.method, headers: o.header }, (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", async () => {
          if (runtime.hold?.(call)) await runtime.release;
          if (runtime.loseReply?.(call)) {
            runtime.loseReply = null;
            o.fail({ errMsg: "simulated lost receipt after server commit" });
            return;
          }
          o.success({
            statusCode: response.statusCode,
            data: data ? JSON.parse(data) : null,
            header: response.headers,
          });
        });
      });
      request.on("error", (error) => o.fail({ errMsg: error.message }));
      request.end(o.data === undefined ? undefined : JSON.stringify(o.data));
      return { abort: () => request.destroy() };
    },
  };
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (file === path.join(mini, "config.js")) return config;
    if (file === path.join(mini, "utils/ui.js")) return ui;
    assert.ok(file.startsWith(mini + path.sep), "only actual mini-program modules are loaded");
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const context = {
      module,
      exports: module.exports,
      wx,
      console,
      setTimeout,
      clearTimeout,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      require(name) {
        assert.ok(name.startsWith("."), name);
        return load(path.resolve(path.dirname(file), name) + (path.extname(name) ? "" : ".js"));
      },
      Page(definition) {
        module.exports = definition;
      },
    };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), context, { filename: file });
    return module.exports;
  }
  const api = load(path.join(mini, "utils/api.js"));
  function page(name) {
    const definition = load(path.join(mini, "pages", name, "index.js"));
    return {
      ...definition,
      data: clone(definition.data),
      setData(patch) {
        patches.push(clone(patch));
        for (const [key, value] of Object.entries(patch)) {
          const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".");
          let target = this.data;
          for (const part of parts.slice(0, -1)) target = target[part] ??= {};
          target[parts.at(-1)] = value === undefined ? undefined : clone(value);
        }
      },
    };
  }
  async function open(name, query = {}) {
    const p = page(name);
    if (p.onLoad) {
      p.onLoad(query);
      if (name === "match-detail" || name === "match-media") await p.refresh();
    } else await p.onShow();
    await until(() => !p.data.loading, name + " initial load");
    assert.equal(p.data.error, "", name + ": " + p.data.error);
    return p;
  }
  const login = async (username = credentials.username) => api.login(username, credentials.password);
  await login();
  return {
    api,
    db,
    directory,
    config,
    calls,
    patches,
    navigation,
    modals,
    storage,
    runtime,
    open,
    page,
    login,
    pngPath,
    jpgPath,
    restart: async () => {
      await stop();
      await start();
      await login();
    },
    async catalog(kind, form, logo = false) {
      const p = await open("club-catalog", { type: kind });
      p.create();
      for (const [key, value] of Object.entries(form)) input(p, key, value);
      if (logo) p.chooseLogo();
      await p.save();
      assert.equal(p.data.actionError, "", "catalog create");
      return (await api.request(p.config.path)).find(
        (row) => (row.name || row.title) === (form.name || form.title).trim()
      );
    },
  };
}

// This continuously exercises the real catalog/season/match controller methods,
// not source patterns or fixture API responses. All assertions query real data.
test("V3 #1/#2/#3/#6: real controller media, catalog/manual/inline choices and immutable match text survive restart", async (t) => {
  const h = await fixture(t),
    { api } = h;
  const season = await h.open("manage-season");
  input(season, "name", " 虚构跨年赛季 ");
  input(season, "startDate", "2026-09-01");
  input(season, "endDate", "2027-06-30");
  await season.save();
  const seasonId = season.id;
  let persisted = await api.request("/seasons/" + seasonId);
  assert.equal(persisted.name, "虚构跨年赛季");
  assert.equal(persisted.icon, null);
  assert.equal(persisted.image, null);
  season.chooseAsset(event("asset", "icon"));
  h.runtime.selectedFile = h.jpgPath;
  season.chooseAsset(event("asset", "image"));
  await season.save();
  persisted = await api.request("/seasons/" + seasonId);
  assert.match(persisted.icon, /^data:image\/jpeg;base64,/);
  assert.match(persisted.image, /^data:image\/jpeg;base64,/);
  const firstImage = persisted.image;
  await season.refresh();
  input(season, "name", "虚构跨年赛季改名");
  await season.save();
  persisted = await api.request("/seasons/" + seasonId);
  assert.equal(persisted.image, firstImage);
  const stale = await h.open("manage-season", { id: seasonId });
  season.clearAsset(event("asset", "icon"));
  await season.save();
  input(stale, "name", "不可覆盖的新名字");
  await stale.save();
  assert.equal(stale.data.conflict, true);
  persisted = await api.request("/seasons/" + seasonId);
  assert.equal(persisted.icon, null);
  assert.equal(persisted.image, firstImage);
  assert.equal(persisted.name, "虚构跨年赛季改名");
  season.clearAsset(event("asset", "image"));
  await season.save();
  assert.equal((await api.request("/seasons/" + seasonId)).image, null);
  // A real invalid PNG is rejected by the server even though its signature passed the picker.
  const fake = path.join(h.directory, "fake.png");
  fs.writeFileSync(fake, Buffer.from("iVBORw0KGgoAAA==", "base64"));
  h.runtime.selectedFile = fake;
  season.chooseAsset(event("asset", "icon"));
  await season.save();
  assert.ok(season.data.actionError);
  assert.equal((await api.request("/seasons/" + seasonId)).icon, null);
  h.runtime.selectedFile = h.pngPath;

  const competition = await h.catalog("competition", { name: " 虚构邀请赛 ", introduction: "赛事内部说明" }, true);
  const opponent = await h.catalog(
    "opponent",
    { name: " 虚构星河队 ", introduction: "对手内部简介", playerSummary: "虚构9号前锋、1号门将" },
    true
  );
  const notice = await h.catalog("notice", {
    title: " 虚构集合须知 ",
    content: " 提前30分钟集合。本测试不构成法律同意。 ",
  });
  assert.equal(opponent.playerSummary, "虚构9号前锋、1号门将");
  assert.equal(opponent.introduction, "对手内部简介");
  assert.ok(opponent.logo);
  const summary = await api.request("/opponents?summary=1");
  assert.deepEqual(Object.keys(summary[0]).sort(), ["id", "name", "status"]);
  const match = await h.open("match-edit");
  for (const [kind, item] of [
    ["competitions", competition],
    ["opponents", opponent],
    ["notices", notice],
  ])
    match.applyCatalog(
      kind,
      match.data.catalogs[kind].findIndex((x) => x.id === item.id)
    );
  assert.equal(match.data.form.notice, notice.content);
  input(match, "notice", "本场单独须知，可在报名之前维护");
  match.applyCatalog("notices", match.data.catalogIndices.notices);
  assert.equal(match.data.form.notice, "本场单独须知，可在报名之前维护");
  match.date({ detail: { value: "2026-12-31" } });
  match.time({ detail: { value: "20:00" } });
  match.pick({
    currentTarget: { dataset: { field: "seasonIndex" } },
    detail: { value: match.data.seasons.findIndex((x) => x.id === seasonId) },
  });
  await match.save();
  const matchId = match.data.savedId;
  assert.ok(matchId, match.data.actionError);
  let m = await api.request("/matches/" + matchId);
  assert.equal(m.status, "draft");
  assert.equal(m.competitionId, competition.id);
  assert.equal(m.opponentId, opponent.id);
  assert.equal(m.noticeTemplateId, notice.id);
  assert.deepEqual(Object.keys(m.opponentSnapshot).sort(), ["logo", "name"]);
  assert.equal(m.notice, "本场单独须知，可在报名之前维护");
  const originalSnapshot = clone(m.opponentSnapshot);
  const oppPage = await h.open("club-catalog", { type: "opponent" });
  oppPage.search({ detail: { value: "9号" } });
  assert.equal(oppPage.data.visible.length, 1);
  oppPage.edit(event("id", opponent.id));
  input(oppPage, "name", "虚构对手已改名");
  oppPage.clearLogo();
  await oppPage.save();
  let changed = await api.request("/opponents/" + opponent.id);
  assert.equal(changed.logo, null);
  oppPage.edit(event("id", opponent.id));
  h.runtime.confirm = false;
  oppPage.archive();
  assert.equal((await api.request("/opponents/" + opponent.id)).status, "active");
  h.runtime.confirm = true;
  oppPage.archive();
  await until(() => !oppPage.data.busy && !oppPage.data.loading && !oppPage.data.editor, "archive opponent");
  assert.equal((await api.request("/opponents/" + opponent.id)).status, "inactive");
  const newMatch = await h.open("match-edit");
  assert.ok(!newMatch.data.catalogs.opponents.some((x) => x.id === opponent.id));
  const existing = await h.open("match-edit", { id: matchId });
  assert.ok(existing.data.catalogs.opponents.some((x) => x.id === opponent.id));
  assert.match(existing.data.catalogs.opponents[existing.data.catalogIndices.opponents].name, /本场留存/);
  const noticePage = await h.open("club-catalog", { type: "notice" });
  noticePage.edit(event("id", notice.id));
  input(noticePage, "content", "模板后来修改的内容");
  await noticePage.save();
  m = await api.request("/matches/" + matchId);
  assert.equal(m.notice, "本场单独须知，可在报名之前维护");
  assert.deepEqual(m.opponentSnapshot, originalSnapshot);
  input(existing, "notice", "");
  existing.changeStatus({ detail: { value: "published" } });
  await existing.save();
  m = await api.request("/matches/" + matchId);
  assert.equal(m.notice, "");
  assert.equal(m.noticeTemplateId, notice.id);
  assert.deepEqual(m.opponentSnapshot, originalSnapshot);
  const manual = await h.open("match-edit");
  input(manual, "opponent", "手动虚构对手");
  input(manual, "competition", "手动友谊赛");
  input(manual, "notice", "手填本场须知");
  manual.date({ detail: { value: "2027-01-01" } });
  await manual.save();
  const manualId = manual.data.savedId;
  m = await api.request("/matches/" + manualId);
  assert.equal(m.opponentId, null);
  assert.equal(m.competitionId, null);
  assert.equal(m.noticeTemplateId, null);
  assert.equal(m.notice, "手填本场须知");
  const inline = await h.open("match-edit");
  for (const [kind, type, form] of [
    ["competitions", "competition", { name: "比赛页内新建赛事" }],
    ["opponents", "opponent", { name: "比赛页内新建对手", playerSummary: "虚构替补队员", introduction: "内页简介" }],
    ["notices", "notice", { title: "比赛页内新建模板", content: "内页集合须知" }],
  ]) {
    inline.createCatalog(event("kind", kind));
    const nav = h.navigation.at(-1);
    assert.match(nav.url, /mode=create/);
    inline.onHide();
    const child = await h.open("club-catalog", { type, mode: "create" });
    child.getOpenerEventChannel = () => ({ emit: (name, result) => nav.events[name](result) });
    for (const [field, value] of Object.entries(form)) input(child, field, value);
    if (type === "opponent") child.chooseLogo();
    await child.save();
    assert.equal(child.data.actionError, "");
    await inline.onShow();
    assert.ok(inline.data.catalogs[kind][inline.data.catalogIndices[kind]].id);
    assert.equal(inline.data.form[type === "notice" ? "notice" : type], form.content || form.name);
  }
  inline.date({ detail: { value: "2027-02-01" } });
  await inline.save();
  const inlineId = inline.data.savedId;
  m = await api.request("/matches/" + inlineId);
  assert.ok(m.opponentSnapshot.logo);
  assert.equal(m.notice, "内页集合须知");
  // Null reference explicitly detaches without silently erasing customized text.
  const detach = await h.open("match-edit", { id: inlineId });
  for (const kind of ["opponents", "competitions", "notices"]) detach.applyCatalog(kind, 0);
  await detach.save();
  m = await api.request("/matches/" + inlineId);
  assert.equal(m.opponentSnapshot, null);
  assert.equal(m.notice, "内页集合须知");
  assert.equal(m.competitionId, null);
  const album = await h.open("match-media", { id: matchId });
  album.input({ currentTarget: { dataset: { field: "notice" } }, detail: { value: "相册不能代替须知编辑" } });
  assert.equal(album.data.notice, undefined);
  assert.equal((await api.request("/matches/" + matchId)).notice, "");
  assert.ok(!h.patches.some((p) => JSON.stringify(p).includes("data:image/")), "raw photos do not cross setData");
  const before = await Promise.all([
    api.request("/seasons"),
    api.request("/competitions"),
    api.request("/opponents"),
    api.request("/notice-templates"),
    ...[matchId, manualId, inlineId].map((id) => api.request("/matches/" + id)),
  ]);
  await h.restart();
  const after = await Promise.all([
    api.request("/seasons"),
    api.request("/competitions"),
    api.request("/opponents"),
    api.request("/notice-templates"),
    ...[matchId, manualId, inlineId].map((id) => api.request("/matches/" + id)),
  ]);
  assert.deepEqual(after, before, "complete saved records persist across actual server restart");
  t.diagnostic(`${h.calls.length} actual loopback HTTP requests; isolated file SQLite restarted and compared.`);
});

test("V3 #10/#11: explicit own-player bind, real admin RSVP three states, share/not-now and lost-receipt safety", async (t) => {
  const h = await fixture(t),
    { api } = h;
  const own = await api.request("/players", "POST", { name: "虚构本人顾桥", number: 9 });
  const other = await api.request("/players", "POST", { name: "虚构队友", number: 0 });
  const departed = await api.request("/players", "POST", { name: "虚构离队队员", status: "inactive" });
  await api.request("/players/" + other.id + "/account", "POST", {
    username: "fictional-player",
    password: credentials.password,
  });
  const opponent = await h.catalog(
    "opponent",
    { name: "虚构分享赛对手", introduction: "不能向球员暴露的内部介绍", playerSummary: "不能向球员暴露的队员概况" },
    true
  );
  const m = await api.request("/matches", "POST", {
    date: "2027-01-03",
    kickoff: "18:00",
    opponentId: opponent.id,
    status: "published",
    notice: "报名前可见的本场须知",
  });
  let detail = await h.open("match-detail", { id: m.id });
  assert.equal(detail.data.canReply, false);
  assert.match(detail.data.replyUnavailable, /本人/);
  assert.equal(detail.data.notice, "报名前可见的本场须知");
  const accounts = await h.open("system-accounts");
  await accounts.loadSelfCandidates();
  assert.ok(accounts.data.selfCandidates.some((x) => x.id === own.id));
  assert.ok(!accounts.data.selfCandidates.some((x) => [other.id, departed.id].includes(x.id)));
  accounts.selectSelfCandidate({ detail: { value: accounts.data.selfCandidates.findIndex((x) => x.id === own.id) } });
  const beforeBind = h.calls.filter((x) => x.route === "/api/system/accounts/self-player").length;
  h.runtime.confirm = false;
  await accounts.bindSelfPlayer();
  assert.equal(h.calls.filter((x) => x.route === "/api/system/accounts/self-player").length, beforeBind);
  assert.equal(api.getSession().user.playerId, null);
  h.runtime.confirm = true;
  await accounts.bindSelfPlayer();
  assert.equal(api.getSession(), null);
  assert.equal(h.navigation.at(-1).url, "/pages/login/index");
  assert.match(h.modals.at(-1).content, /就是你本人/);
  assert.equal(
    h.db.prepare("SELECT player_id FROM club_users WHERE username=?").get(credentials.username).player_id,
    own.id
  );
  await h.login();
  assert.equal(api.getSession().user.playerId, own.id);
  assert.equal(api.getSession().user.role, "admin");
  assert.equal(api.getSession().user.systemAdmin, true);
  detail = await h.open("match-detail", { id: m.id });
  assert.equal(detail.data.canReply, true);
  assert.equal(detail.data.match.response, "");
  assert.ok(detail.data.match.opponentCrest);
  detail.opponentImageError();
  assert.equal(detail.data.match.opponentCrest, "");
  for (const response of ["maybe", "no", "yes"]) {
    await detail.reply(event("response", response));
    const record = (await api.request("/matches/" + m.id)).rsvps;
    assert.equal(record.length, 1);
    assert.equal(record[0].playerId, own.id);
    assert.equal(record[0].response, response);
    assert.equal(detail.data.match.response, response);
    assert.equal(detail.data.signupShareOpen, response === "yes");
  }
  const sent = h.calls.length;
  detail.dismissSignupShare();
  assert.equal(detail.data.signupShareOpen, false);
  assert.equal(h.calls.length, sent, "not now neither sends nor changes registration");
  await detail.reply(event("response", "no"));
  await detail.reply(event("response", "yes"));
  const beforeShare = h.calls.length,
    payload = detail.onShareAppMessage();
  assert.match(detail.data.match.shareToken, /^[a-f0-9]{64}$/);
  assert.equal(payload.path, "/pages/match-guest/index?shareToken=" + detail.data.match.shareToken);
  assert.match(payload.title, /快来报名/);
  assert.equal(detail.data.signupShareOpen, false);
  assert.equal(h.calls.length, beforeShare, "share callback only returns payload, no recipient or outbound request");
  await detail.reply(event("response", "yes"));
  assert.equal(h.calls.length, beforeShare, "same response is not submitted twice");
  await detail.reply(event("response", "no"));
  h.runtime.loseReply = (c) => c.method === "PUT" && c.route.endsWith("/rsvp");
  await detail.reply(event("response", "yes"));
  assert.equal(detail.data.signupShareOpen, false);
  assert.match(detail.data.actionError, /未确认/);
  assert.equal(
    (await api.request("/matches/" + m.id)).rsvps[0].response,
    "yes",
    "simulated receipt loss happened after real server commit"
  );
  const puts = h.calls.filter((x) => x.method === "PUT" && x.route.endsWith("/rsvp")).length;
  await detail.refresh();
  assert.equal(detail.data.match.response, "yes");
  assert.equal(detail.data.signupShareOpen, false);
  assert.equal(
    h.calls.filter((x) => x.method === "PUT" && x.route.endsWith("/rsvp")).length,
    puts,
    "reconciliation is read-only"
  );
  await detail.reply(event("response", "no"));
  let release;
  h.runtime.release = new Promise((r) => {
    release = r;
  });
  h.runtime.hold = (c) => c.method === "PUT" && c.route.endsWith("/rsvp");
  const pending = detail.reply(event("response", "yes"));
  await until(
    () => h.calls.filter((x) => x.method === "PUT" && x.route.endsWith("/rsvp")).length > puts + 1,
    "in-flight reply"
  );
  detail.onHide();
  release();
  h.runtime.hold = null;
  await pending;
  assert.equal(detail.data.signupShareOpen, false);
  assert.equal(detail.onShareAppMessage().path, "/pages/home/index");
  await h.login("fictional-ordinary");
  const ordinary = await h.open("match-detail", { id: m.id });
  assert.equal(ordinary.data.canReply, false);
  await assert.rejects(
    api.request("/system/accounts/self-player", "POST", { playerId: own.id, revision: 1 }),
    (e) => e.status === 403
  );
  await h.login("fictional-player");
  let playerPassword = credentials.password;
  // Newly provisioned player passwords must be changed using the real flow.
  if (api.getSession().user.mustChangePassword) {
    await api.request("/auth/password", "PUT", {
      currentPassword: credentials.password,
      newPassword: "fictional-player-new-password",
    });
    playerPassword = "fictional-player-new-password";
    await api.login("fictional-player", playerPassword);
  }
  for (const route of ["/competitions", "/opponents", "/notice-templates"])
    await assert.rejects(api.request(route), (e) => e.status === 403);
  const playerDetail = await h.open("match-detail", { id: m.id });
  assert.equal(playerDetail.data.canReply, true);
  assert.equal(playerDetail.data.admin, false);
  assert.doesNotMatch(JSON.stringify(await api.request("/matches/" + m.id)), /不能向球员暴露/);
  await playerDetail.reply(event("response", "maybe"));
  assert.equal(playerDetail.data.signupShareOpen, false);
  await h.login();
  const manager = await h.open("system-accounts");
  const linkedAccount = manager.data.accounts.find((row) => row.playerId === other.id);
  await manager.update({ currentTarget: { dataset: { id: linkedAccount.id, kind: "role" } } });
  assert.equal(manager.data.actionError, "");
  await api.login("fictional-player", playerPassword);
  assert.equal(api.getSession().user.role, "admin");
  assert.equal(api.getSession().user.playerId, other.id);
  assert.equal(api.getSession().user.systemAdmin, false);
  const linkedAdmin = await h.open("match-detail", { id: m.id });
  assert.equal(linkedAdmin.data.canReply, true);
  assert.equal(linkedAdmin.data.admin, true);
  await linkedAdmin.reply(event("response", "yes"));
  assert.equal(linkedAdmin.data.signupShareOpen, true);
  assert.equal((await api.request("/matches/" + m.id)).rsvps.find((row) => row.playerId === other.id).response, "yes");
  linkedAdmin.dismissSignupShare();
  await h.login();
  const current = await api.request("/matches/" + m.id);
  await api.request("/matches/" + m.id, "PUT", { revision: current.revision, status: "completed" });
  await detail.onShow();
  await until(() => !detail.data.loading, "completed refresh");
  assert.equal(detail.data.canReply, false);
  assert.equal(detail.data.signupShareOpen, false);
  const persisted = clone(h.db.prepare("SELECT player_id,response FROM club_rsvps ORDER BY player_id").all());
  await h.restart();
  assert.deepEqual(
    clone(h.db.prepare("SELECT player_id,response FROM club_rsvps ORDER BY player_id").all()),
    persisted
  );
  t.diagnostic(`${h.calls.length} actual loopback HTTP requests; no native share was sent.`);
});

test("V3 catalogs: all kinds validate, archive/restore, reject stale writes and reconcile a committed-but-lost create without duplication", async (t) => {
  const h = await fixture(t),
    { api } = h;
  for (const [kind, route, nameField] of [
    ["competition", "/competitions", "name"],
    ["opponent", "/opponents", "name"],
    ["notice", "/notice-templates", "title"],
  ]) {
    h.runtime.selectedFile = h.pngPath;
    const page = await h.open("club-catalog", { type: kind });
    page.create();
    const postsBefore = h.calls.filter((x) => x.method === "POST" && x.route === "/api" + route).length;
    await page.save();
    assert.ok(page.data.actionError);
    assert.equal(h.calls.filter((x) => x.method === "POST" && x.route === "/api" + route).length, postsBefore);
    input(page, nameField, "虚构" + kind);
    if (kind === "notice") {
      await page.save();
      assert.match(page.data.actionError, /须知内容/);
      input(page, "content", "虚构集合提醒");
    } else page.chooseLogo();
    await page.save();
    let row = (await api.request(route))[0];
    assert.ok(row.id);
    const a = await h.open("club-catalog", { type: kind }),
      b = await h.open("club-catalog", { type: kind });
    a.edit(event("id", row.id));
    b.edit(event("id", row.id));
    input(a, nameField, "先保存的" + kind);
    if (kind !== "notice") {
      h.runtime.selectedFile = h.jpgPath;
      a.chooseLogo();
    }
    await a.save();
    let fresh = await api.request(route + "/" + row.id);
    assert.equal(fresh[nameField], "先保存的" + kind);
    if (kind !== "notice") assert.notEqual(fresh.logo, row.logo);
    input(b, nameField, "过时页面不得覆盖");
    await b.save();
    assert.equal(b.data.conflict, true);
    assert.equal(b.data.form[nameField], "过时页面不得覆盖");
    assert.deepEqual(await api.request(route + "/" + row.id), fresh);
    a.edit(event("id", row.id));
    a.archive();
    await until(() => !a.data.busy && !a.data.loading && !a.data.editor, "disable " + kind);
    assert.equal((await api.request(route + "/" + row.id)).status, "inactive");
    a.edit(event("id", row.id));
    a.archive();
    await until(() => !a.data.busy && !a.data.loading && !a.data.editor, "restore " + kind);
    assert.equal((await api.request(route + "/" + row.id)).status, "active");
    a.create();
    input(a, nameField, "已提交但回执丢失的" + kind);
    if (kind === "notice") input(a, "content", "只创建一次");
    h.runtime.loseReply = (c) => c.method === "POST" && c.route === "/api" + route;
    await a.save();
    assert.equal(a.data.uncertain, true);
    const committed = await api.request(route);
    assert.equal(committed.length, 2);
    assert.equal(committed.filter((x) => x[nameField] === "已提交但回执丢失的" + kind).length, 1);
    const sent = h.calls.filter((x) => x.method === "POST" && x.route === "/api" + route).length;
    await a.save();
    assert.equal(h.calls.filter((x) => x.method === "POST" && x.route === "/api" + route).length, sent);
    a.list();
    await until(() => !a.data.loading && !a.data.editor, "reconcile " + kind);
    assert.equal(a.data.uncertain, true);
    assert.equal(a.data.visible.length, 2);
    h.runtime.confirm = false;
    a.recover();
    assert.equal(a.data.uncertain, true);
    h.runtime.confirm = true;
    a.recover();
    assert.equal(a.data.uncertain, false);
    assert.equal(
      h.calls.filter((x) => x.method === "POST" && x.route === "/api" + route).length,
      sent,
      "explicit receipt clearance is not an automatic retry"
    );
  }
  const player = await api.request("/players", "POST", { name: "虚构只读球员" });
  await api.request("/players/" + player.id + "/account", "POST", {
    username: "fictional-viewer",
    password: credentials.password,
  });
  await h.login("fictional-viewer");
  if (api.getSession().user.mustChangePassword) {
    await api.request("/auth/password", "PUT", {
      currentPassword: credentials.password,
      newPassword: "fictional-viewer-new-password",
    });
    await api.login("fictional-viewer", "fictional-viewer-new-password");
  }
  for (const type of ["competition", "opponent", "notice"]) {
    const p = h.page("club-catalog");
    p.onLoad({ type });
    await until(() => !p.data.loading, "forbidden catalog");
    assert.equal(p.data.authorized, false);
    assert.match(p.data.error, /管理员/);
    assert.equal(p.data.visible.length, 0);
    const before = h.calls.length;
    p.create();
    await p.save();
    assert.equal(h.calls.length, before);
  }
  for (const name of ["manage-season", "match-edit"]) {
    const p = h.page(name);
    p.onLoad({});
    await until(() => !p.data.loading, "forbidden " + name);
    assert.match(p.data.error, /管理员/);
  }
  for (const route of ["/competitions", "/opponents", "/notice-templates", "/seasons"])
    await assert.rejects(api.request(route, "POST", { name: "越权不得创建" }), (e) => e.status === 403);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM club_competitions").get().n, 2);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM club_opponents").get().n, 2);
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM club_notice_templates").get().n, 2);
  t.diagnostic(`${h.calls.length} actual loopback HTTP requests; all three create receipts reconciled without retry.`);
});
