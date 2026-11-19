import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createFootballServer } from "./index.mjs";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";

const sharp = createRequire(new URL("../app/package.json", import.meta.url))("sharp");
const credentials = { username: "catalog-owner", password: "fictional-catalog-password" };
const competition = { name: "演练跨年邀请赛", introduction: "仅用于隔离测试" };
const opponent = { name: "演练星河队", playerSummary: "9号前锋，1号门将（虚构）", introduction: "虚构业余球队" };
const notice = { title: "演练集合须知", content: "提前30分钟集合。仅作测试，不构成法律同意。" };
const season = { name: "2026/27演练赛季", startDate: "2026-09-01", endDate: "2027-06-30" };
const image = async (withMetadata = false) => {
  let pipeline = sharp({ create: { width: 24, height: 18, channels: 4, background: "#8844aa80" } });
  if (withMetadata) pipeline = pipeline.withMetadata({ exif: { IFD0: { Artist: "fictional-test-metadata" } } });
  return "data:image/png;base64," + (await pipeline.png().toBuffer()).toString("base64");
};
async function fixture(t, before) {
  const directory = await mkdtemp(join(tmpdir(), "football-catalog-"));
  const path = join(directory, "isolated.sqlite");
  if (before) before(path);
  let server, base;
  const start = async (databasePath = path) => {
    server = createFootballServer({ databasePath, bootstrapAdmin: credentials });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  await start();
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  const call = async (route, { method = "GET", body, cookie } = {}) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        Origin: base,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const login = async (body = credentials) => {
    const result = await call("/api/auth/login", { method: "POST", body });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.cookie;
  };
  const nativeCall = (route, { method = "GET", body, token } = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        base + route,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Football-Client": "native-v1",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
        (response) => {
          let data = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            data += chunk;
          });
          response.on("end", () => resolve({ status: response.statusCode, body: data ? JSON.parse(data) : null }));
        }
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  return {
    path,
    directory,
    call,
    login,
    nativeCall,
    restart: async (newPath) => {
      await stop();
      await start(newPath);
    },
  };
}
const create = async (f, cookie, kind, body) => {
  const response = await f.call(`/api/${kind}`, { method: "POST", body, cookie });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
};
const update = async (f, cookie, kind, item, changes) => {
  const response = await f.call(`/api/${kind}/${item.id}`, {
    method: "PUT",
    body: { revision: item.revision, ...changes },
    cookie,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
};

test("catalogs are empty by default and support revision-safe edit, archive and restore", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  for (const [kind, payload] of [
    ["competitions", competition],
    ["opponents", opponent],
    ["notice-templates", notice],
  ]) {
    assert.equal((await f.call(`/api/${kind}`)).status, 401);
    assert.deepEqual((await f.call(`/api/${kind}`, { cookie })).body, []);
    const item = await create(f, cookie, kind, { ...payload, id: 999, teamId: 2, revision: 999 });
    assert.equal(item.id, 1);
    assert.equal(item.revision, 1);
    assert.equal(item.status, "active");
    assert.deepEqual((await f.call(`/api/${kind}/1`, { cookie })).body, item);
    for (const [body, expected] of [
      [{}, 428],
      [{ revision: 0 }, 428],
      [{ revision: 99 }, 409],
    ])
      assert.equal(
        (await f.call(`/api/${kind}/1`, { method: "PUT", cookie, body: { ...body, status: "inactive" } })).status,
        expected
      );
    assert.deepEqual((await f.call(`/api/${kind}/1`, { cookie })).body, item);
    const archived = await update(f, cookie, kind, item, { status: "inactive" });
    assert.equal(archived.revision, 2);
    const restored = await update(f, cookie, kind, archived, { status: "active" });
    assert.equal(restored.revision, 3);
    assert.equal((await f.call(`/api/${kind}/1`, { method: "DELETE", cookie })).status, 405);
    assert.equal((await f.call(`/api/${kind}/2`, { cookie })).status, 404);
    assert.equal(
      (await f.call(`/api/${kind}`, { method: "POST", cookie, body: { ...payload, status: "deleted" } })).status,
      400
    );
    const label = kind === "notice-templates" ? "title" : "name";
    for (const value of ["", " ", null, 3, "x".repeat(201)])
      assert.equal(
        (await f.call(`/api/${kind}`, { method: "POST", cookie, body: { ...payload, [label]: value } })).status,
        400
      );
    assert.equal((await f.call(`/api/${kind}`, { cookie })).body.length, 1);
  }
  for (const content of ["", " ", null, "x".repeat(10001)])
    assert.equal(
      (await f.call("/api/notice-templates", { method: "POST", cookie, body: { ...notice, content } })).status,
      400
    );
  assert.equal(
    (await f.call("/api/opponents", { method: "POST", cookie, body: { ...opponent, playerSummary: [] } })).status,
    400
  );
  assert.equal((await f.call("/api/competitions", { method: "POST", cookie, body: null })).status, 400);
  await f.restart();
  assert.equal((await f.call("/api/notice-templates/1", { cookie })).body.content, notice.content);
});

test("season icon/image and catalog logos are optional, decoded safely, cleared explicitly and retained on omitted updates", async (t) => {
  const f = await fixture(t),
    cookie = await f.login(),
    png = await image(true);
  const bare = await create(f, cookie, "seasons", season);
  assert.equal(bare.icon, null);
  assert.equal(bare.image, null);
  let s = await update(f, cookie, "seasons", bare, { icon: png, image: png });
  for (const dataUrl of [s.icon, s.image]) {
    assert.match(dataUrl, /^data:image\/jpeg;base64,/);
    const metadata = await sharp(Buffer.from(dataUrl.split(",")[1], "base64")).metadata();
    assert.equal(metadata.width, 24);
    assert.equal(metadata.height, 18);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
  }
  const original = s;
  s = await update(f, cookie, "seasons", s, { ...s, name: "带原图片的完整表单" });
  assert.equal(s.icon, original.icon);
  assert.equal(s.image, original.image);
  s = await update(f, cookie, "seasons", s, { name: "只改名称" });
  assert.equal(s.icon, original.icon);
  assert.equal(s.image, original.image);
  s = await update(f, cookie, "seasons", s, { icon: null });
  assert.equal(s.icon, null);
  assert.equal(s.image, original.image);
  s = await update(f, cookie, "seasons", s, { image: null });
  assert.equal(s.image, null);
  const entries = [];
  for (const [kind, payload] of [
    ["competitions", competition],
    ["opponents", opponent],
  ]) {
    let item = await create(f, cookie, kind, { ...payload, logo: png });
    assert.match(item.logo, /^data:image\/jpeg;base64,/);
    const originalLogo = item.logo;
    assert.deepEqual((await f.call(`/api/${kind}?summary=1`, { cookie })).body, [
      { id: item.id, name: item.name, status: item.status },
    ]);
    for (const route of [
      `/api/${kind}?summary=0`,
      `/api/${kind}?summary=1&summary=1`,
      `/api/${kind}/${item.id}?summary=1`,
    ])
      assert.equal((await f.call(route, { cookie })).status, 400);
    item = await update(f, cookie, kind, item, { ...item, name: "完整表单保存" });
    assert.equal(item.logo, originalLogo);
    item = await update(f, cookie, kind, item, { introduction: "修改介绍" });
    assert.notEqual(item.logo, null);
    item = await update(f, cookie, kind, item, { logo: null });
    assert.equal(item.logo, null);
    entries.push([kind, item]);
  }
  const fakePng = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(fakePng);
  fakePng.write("IHDR", 12);
  fakePng.writeUInt32BE(1, 16);
  fakePng.writeUInt32BE(1, 20);
  for (const invalid of [
    "https://example.test/logo.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/gif;base64,R0lGODlh",
    "data:image/png;base64," + fakePng.toString("base64"),
    png.slice(0, -12),
    "",
    2,
    "data:image/jpeg;base64," + Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
  ]) {
    for (const field of ["icon", "image"])
      assert.equal(
        (
          await f.call(`/api/seasons/${s.id}`, {
            method: "PUT",
            cookie,
            body: { revision: s.revision, [field]: invalid },
          })
        ).status,
        400
      );
    for (const [kind, item] of entries)
      assert.equal(
        (
          await f.call(`/api/${kind}/${item.id}`, {
            method: "PUT",
            cookie,
            body: { revision: item.revision, logo: invalid },
          })
        ).status,
        400
      );
  }
  assert.deepEqual((await f.call(`/api/seasons/${s.id}`, { cookie })).body, s);
  assert.equal((await f.call("/api/notice-templates?summary=1", { cookie })).status, 400);
  assert.equal(
    (
      await f.call(`/api/seasons/${s.id}`, {
        method: "PUT",
        cookie,
        body: { revision: s.revision, icon: png, image: "not-an-image" },
      })
    ).status,
    400
  );
  assert.deepEqual((await f.call(`/api/seasons/${s.id}`, { cookie })).body, s);
  await f.restart();
  assert.deepEqual((await f.call(`/api/seasons/${s.id}`, { cookie })).body, s);
});

test("native clients can maintain catalogs and season requests support two independently bounded photos", async (t) => {
  const f = await fixture(t);
  const login = await f.nativeCall("/api/auth/native-login", { method: "POST", body: credentials });
  assert.equal(login.status, 200);
  const token = login.body.token;
  const png =
    "data:image/png;base64," +
    (
      await sharp(randomBytes(640 * 640 * 3), { raw: { width: 640, height: 640, channels: 3 } })
        .png()
        .toBuffer()
    ).toString("base64");
  const body = { ...season, icon: png, image: png };
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 3 * 1024 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(body)) < 6 * 1024 * 1024);
  const saved = await f.nativeCall("/api/seasons", { method: "POST", token, body });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.notEqual(saved.body.icon, null);
  assert.notEqual(saved.body.image, null);
  for (const [kind, payload] of [
    ["competitions", competition],
    ["opponents", opponent],
    ["notice-templates", notice],
  ]) {
    const created = await f.nativeCall(`/api/${kind}`, { method: "POST", token, body: payload });
    assert.equal(created.status, 201);
    assert.deepEqual((await f.nativeCall(`/api/${kind}/${created.body.id}`, { token })).body, created.body);
    assert.equal(
      (
        await f.nativeCall(`/api/${kind}/${created.body.id}`, {
          method: "PUT",
          token,
          body: { revision: created.body.revision, status: "inactive" },
        })
      ).status,
      200
    );
  }
});

test("logout during actual asynchronous image decoding prevents catalog or season persistence", async (t) => {
  const f = await fixture(t),
    png = await image();
  // Pause a real decoder's first completed raw buffer, not the persistence path.
  // This makes the in-flight revocation deterministic without adding API hooks.
  for (const [kind, payload] of [
    ["opponents", { ...opponent, logo: png }],
    ["seasons", { ...season, image: png }],
  ]) {
    const cookie = await f.login();
    let entered, release;
    const didEnter = new Promise((resolve) => {
      entered = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const original = sharp.prototype.toBuffer;
    let paused = false;
    sharp.prototype.toBuffer = async function (...args) {
      const result = await original.apply(this, args);
      if (!paused) {
        paused = true;
        entered();
        await gate;
      }
      return result;
    };
    let pending;
    try {
      pending = f.call(`/api/${kind}`, { method: "POST", cookie, body: payload });
      await didEnter;
      assert.equal((await f.call("/api/auth/logout", { method: "POST", cookie, body: {} })).status, 204);
      release();
      assert.equal((await pending).status, 401);
    } finally {
      release();
      sharp.prototype.toBuffer = original;
      if (pending) await pending;
    }
    assert.deepEqual((await f.call(`/api/${kind}`, { cookie: await f.login() })).body, []);
  }
});

test("matches snapshot selected catalogs and exact notice text without rewriting historical free text", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  let c = await create(f, cookie, "competitions", { ...competition, logo: await image() });
  let o = await create(f, cookie, "opponents", { ...opponent, logo: await image() });
  let n = await create(f, cookie, "notice-templates", notice);
  const free = await create(f, cookie, "matches", {
    opponent: "手动对手",
    competition: "手动赛事",
    notice: "手动须知",
    date: "2026-11-19",
  });
  assert.equal(free.competitionId, null);
  assert.equal(free.opponentId, null);
  assert.equal(free.noticeTemplateId, null);
  let m = await create(f, cookie, "matches", {
    competitionId: c.id,
    opponentId: o.id,
    noticeTemplateId: n.id,
    date: "2026-11-20",
    status: "published",
    competitionSnapshot: { name: "伪造" },
    opponentSnapshot: { name: "伪造" },
  });
  assert.equal(m.competition, c.name);
  assert.equal(m.opponent, o.name);
  assert.equal(m.notice, n.content);
  assert.deepEqual(m.opponentSnapshot, { name: o.name, logo: o.logo });
  const original = m;
  c = await update(f, cookie, "competitions", c, { name: "新赛事名称", logo: null, status: "inactive" });
  o = await update(f, cookie, "opponents", o, {
    name: "新对手名称",
    logo: null,
    introduction: "新介绍",
    playerSummary: "新资料",
    status: "inactive",
  });
  n = await update(f, cookie, "notice-templates", n, { content: "新版须知", status: "inactive" });
  assert.deepEqual((await f.call(`/api/matches/${m.id}`, { cookie })).body, original);
  m = await update(f, cookie, "matches", m, { location: "新地点", opponentSnapshot: { name: "忽略" } });
  assert.deepEqual(m.opponentSnapshot, original.opponentSnapshot);
  assert.deepEqual(m.competitionSnapshot, original.competitionSnapshot);
  assert.equal(m.notice, notice.content);
  assert.equal(m.opponent, opponent.name);
  m = await update(f, cookie, "matches", m, { notice: "" });
  assert.equal(m.notice, "");
  assert.equal(m.noticeTemplateId, n.id);
  m = await update(f, cookie, "matches", m, { analysis: "只改分析" });
  assert.equal(m.notice, "");
  for (const field of ["competitionId", "opponentId", "noticeTemplateId"])
    assert.equal(
      (
        await f.call("/api/matches", {
          method: "POST",
          cookie,
          body: { opponent: "手动", date: "2026-11-21", [field]: 1 },
        })
      ).status,
      400
    );
  m = await update(f, cookie, "matches", m, { competitionId: null, opponentId: null, noticeTemplateId: null });
  assert.equal(m.opponentSnapshot, null);
  assert.equal(m.competitionSnapshot, null);
  assert.equal(m.opponent, opponent.name);
  assert.equal(m.competition, competition.name);
  assert.equal(m.notice, "");
  n = await update(f, cookie, "notice-templates", n, { status: "active" });
  m = await update(f, cookie, "matches", m, { noticeTemplateId: n.id, notice: "" });
  assert.equal(m.notice, "");
  const manual = await create(f, cookie, "matches", {
    date: "2026-12-01",
    opponent: "仍可手填",
    noticeTemplateId: n.id,
    notice: "本场特例\n保持换行",
  });
  assert.equal(manual.notice, "本场特例\n保持换行");
  await f.restart();
  assert.deepEqual((await f.call(`/api/matches/${m.id}`, { cookie })).body, m);
  assert.deepEqual((await f.call(`/api/matches/${free.id}`, { cookie })).body, free);
});

test("catalog and season reads are team-scoped, player writes forbidden and foreign references rejected atomically", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const p = await create(f, cookie, "players", { name: "演练球员", number: 9, positions: ["前锋"] });
  await f.call(`/api/players/${p.id}/account`, {
    method: "POST",
    cookie,
    body: { username: "catalog-player", password: "fictional-player-password" },
  });
  const playerCookie = await f.login({ username: "catalog-player", password: "fictional-player-password" });
  const db = new DatabaseSync(f.path);
  db.exec("INSERT INTO club_teams(id,name) VALUES(2,'另一测试球队')");
  for (const [table, columns, values] of [
    ["club_competitions", "name", "'他队赛事'"],
    ["club_opponents", "name", "'他队对手'"],
    ["club_notice_templates", "title,content", "'他队模板','他队内容'"],
    ["club_seasons", "name,start_date,end_date", "'他队赛季','2026-01-01','2026-12-31'"],
  ])
    db.exec(`INSERT INTO ${table}(id,team_id,${columns}) VALUES(9,2,${values})`);
  db.close();
  for (const [kind, payload] of [
    ["competitions", competition],
    ["opponents", opponent],
    ["notice-templates", notice],
    ["seasons", season],
  ]) {
    const item = await create(f, cookie, kind, payload);
    const readable = kind === "seasons";
    assert.equal((await f.call(`/api/${kind}/${item.id}`, { cookie: playerCookie })).status, readable ? 200 : 403);
    const list = await f.call(`/api/${kind}`, { cookie: playerCookie });
    assert.equal(list.status, readable ? 200 : 403);
    if (readable) assert.equal(list.body.length, 1);
    assert.equal((await f.call(`/api/${kind}`, { method: "POST", cookie: playerCookie, body: payload })).status, 403);
    assert.equal(
      (
        await f.call(`/api/${kind}/${item.id}`, {
          method: "PUT",
          cookie: playerCookie,
          body: { revision: 1, ...payload },
        })
      ).status,
      403
    );
    assert.equal((await f.call(`/api/${kind}/9`, { cookie })).status, 404);
    assert.equal(
      (await f.call(`/api/${kind}/9`, { method: "PUT", cookie, body: { revision: 1, ...payload } })).status,
      404
    );
  }
  const m = await create(f, cookie, "matches", { date: "2026-11-19", opponent: "手动", status: "published" });
  for (const field of ["competitionId", "opponentId", "noticeTemplateId"]) {
    for (const [value, expected] of [
      [9, 404],
      [999, 404],
      [-1, 400],
      [0, 400],
      ["1", 400],
      [1.5, 400],
    ])
      assert.equal(
        (
          await f.call(`/api/matches/${m.id}`, {
            method: "PUT",
            cookie,
            body: { revision: m.revision, [field]: value, analysis: "不能落库" },
          })
        ).status,
        expected
      );
  }
  assert.deepEqual((await f.call(`/api/matches/${m.id}`, { cookie })).body, m);
  assert.equal((await f.call(`/api/matches/${m.id}`, { cookie: playerCookie })).status, 200);
});

test("legacy migration leaves optional media and references null and complete SQLite backup restores catalog history", async (t) => {
  const f = await fixture(t, (path) => {
    const legacy = openFootballStore(path),
      club = createClubStore(legacy.database, legacy);
    club.saveSeason(1, null, season);
    club.saveMatch({ team_id: 1, role: "admin" }, null, {
      opponent: "旧对手",
      competition: "旧赛事",
      notice: "旧须知",
      date: "2026-11-19",
    });
    const db = legacy.database;
    for (const column of [
      "competition_id",
      "opponent_id",
      "notice_template_id",
      "competition_snapshot",
      "opponent_snapshot",
    ])
      db.exec(`ALTER TABLE club_matches DROP COLUMN ${column}`);
    for (const column of ["icon", "image"]) db.exec(`ALTER TABLE club_seasons DROP COLUMN ${column}`);
    db.exec(
      "DROP TABLE club_competitions; DROP TABLE club_opponents; DROP TABLE club_notice_templates; DELETE FROM app_migrations WHERE migration_name='club-catalogs-v1'"
    );
    legacy.close();
  });
  const cookie = await f.login();
  const oldSeason = (await f.call("/api/seasons/1", { cookie })).body;
  assert.equal(oldSeason.icon, null);
  assert.equal(oldSeason.image, null);
  const oldMatch = (await f.call("/api/matches/1", { cookie })).body;
  assert.equal(oldMatch.opponent, "旧对手");
  assert.equal(oldMatch.competition, "旧赛事");
  assert.equal(oldMatch.notice, "旧须知");
  for (const field of ["competitionId", "opponentId", "noticeTemplateId", "competitionSnapshot", "opponentSnapshot"])
    assert.equal(oldMatch[field], null);
  for (const kind of ["competitions", "opponents", "notice-templates"])
    assert.deepEqual((await f.call(`/api/${kind}`, { cookie })).body, []);
  const c = await create(f, cookie, "competitions", { ...competition, logo: await image() });
  const o = await create(f, cookie, "opponents", opponent);
  const n = await create(f, cookie, "notice-templates", notice);
  const s = await update(f, cookie, "seasons", oldSeason, { icon: await image(), image: await image() });
  const m = await create(f, cookie, "matches", {
    date: "2026-12-19",
    competitionId: c.id,
    opponentId: o.id,
    noticeTemplateId: n.id,
    seasonId: s.id,
  });
  const backup = join(f.directory, "backup.sqlite");
  execFileSync(process.execPath, [new URL("../scripts/backup.mjs", import.meta.url).pathname, backup], {
    env: { ...process.env, FOOTBALL_DB_PATH: f.path },
    stdio: "pipe",
  });
  const source = new DatabaseSync(f.path, { readOnly: true }),
    restored = new DatabaseSync(backup, { readOnly: true });
  for (const table of ["club_competitions", "club_opponents", "club_notice_templates", "club_seasons", "club_matches"])
    assert.deepEqual(
      restored.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      source.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    );
  assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
  source.close();
  restored.close();
  await f.restart(backup);
  assert.deepEqual((await f.call(`/api/matches/${m.id}`, { cookie })).body, m);
  assert.deepEqual((await f.call(`/api/seasons/${s.id}`, { cookie })).body, s);
  assert.deepEqual((await f.call("/api/matches/1", { cookie })).body, oldMatch);
});
