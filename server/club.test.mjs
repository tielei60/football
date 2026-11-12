import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createFootballServer } from "./index.mjs";
import { openFootballStore } from "./football-store.mjs";

const credentials = { username: "owner", password: "owner-password-123" };
async function fixture(t, before) {
  const dir = await mkdtemp(join(tmpdir(), "football-club-"));
  const path = join(dir, "test.sqlite");
  if (before) before(path);
  let server, base;
  async function start() {
    server = createFootballServer({
      databasePath: path,
      bootstrapAdmin: credentials,
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  await start();
  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  async function request(
    route,
    { method = "GET", body, cookie, origin = true } = {},
  ) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: base } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(data = credentials) {
    const response = await request("/api/auth/login", {
      method: "POST",
      body: data,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.cookie;
  }
  return {
    path,
    request,
    login,
    restart: async () => {
      await stop();
      await start();
    },
  };
}

test("complete club workflow, RSVP is not appearance, null metrics, inclusive seasons and year boundaries", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const admin = (route, method = "GET", body) =>
    f.request(route, { method, body, cookie });
  const player = (
    await admin("/api/players", "POST", {
      name: "小明",
      positions: ["前锋"],
      number: 9,
    })
  ).body;
  const other = (
    await admin("/api/players", "POST", { name: "小李", positions: ["中场"] })
  ).body;
  assert.equal(player.name, "小明");
  assert.equal(other.number, null);
  assert.equal(
    (
      await admin(`/api/players/${player.id}/account`, "POST", {
        username: "ming",
        password: "ming-password-123",
      })
    ).status,
    201,
  );
  const playerCookie = await f.login({
    username: "ming",
    password: "ming-password-123",
  });
  const match = (
    await admin("/api/matches", "POST", {
      opponent: "友谊队",
      date: "2025-12-31",
    })
  ).body;
  assert.equal(
    (await f.request(`/api/matches/${match.id}`, { cookie: playerCookie }))
      .status,
    404,
  );
  await admin(`/api/matches/${match.id}`, "PUT", { status: "published" });
  let r = await f.request(`/api/matches/${match.id}/rsvp`, {
    method: "PUT",
    body: { response: "yes", playerId: other.id },
    cookie: playerCookie,
  });
  assert.equal(r.body.rsvps[0].playerId, player.id);
  await admin(`/api/matches/${match.id}`, "PUT", {
    status: "completed",
    homeScore: 0,
    awayScore: 2,
    analysis: "传球需要改善。",
  });
  assert.equal(
    (
      await f.request(`/api/matches/${match.id}/rsvp`, {
        method: "PUT",
        body: { response: "no" },
        cookie: playerCookie,
      })
    ).status,
    409,
  );
  const season = (
    await admin("/api/seasons", "POST", {
      name: "跨年赛季",
      startDate: "2025-12-31",
      endDate: "2026-01-01",
    })
  ).body;
  let stats = (await admin(`/api/statistics?seasonId=${season.id}`)).body;
  assert.equal(
    stats.players.find((p) => p.playerId === player.id).appearances,
    0,
  );
  assert.equal(stats.players.find((p) => p.playerId === player.id).goals, null);
  await admin(`/api/matches/${match.id}/roster`, "PUT", {
    roster: [
      {
        playerId: player.id,
        position: "前锋",
        appeared: true,
        goals: 0,
        assists: null,
      },
      { playerId: other.id, appeared: null },
    ],
  });
  const second = (
    await admin("/api/matches", "POST", {
      opponent: "新年队",
      date: "2026-01-01",
      status: "completed",
    })
  ).body;
  await admin(`/api/matches/${second.id}/roster`, "PUT", {
    roster: [{ playerId: player.id, appeared: true, goals: 2, assists: 1 }],
  });
  await admin("/api/matches", "POST", {
    opponent: "边界外",
    date: "2026-01-02",
    status: "completed",
  });
  stats = (await admin(`/api/statistics?seasonId=${season.id}`)).body;
  assert.equal(stats.matches, 2);
  const aggregate = stats.players.find((p) => p.playerId === player.id);
  assert.deepEqual(
    {
      appearances: aggregate.appearances,
      goals: aggregate.goals,
      assists: aggregate.assists,
      goalsKnownMatches: aggregate.goalsKnownMatches,
      assistsKnownMatches: aggregate.assistsKnownMatches,
    },
    {
      appearances: 2,
      goals: 2,
      assists: 1,
      goalsKnownMatches: 2,
      assistsKnownMatches: 1,
    },
  );
  assert.equal(
    stats.players.find((p) => p.playerId === other.id).unknownAppearances,
    1,
  );
  assert.equal((await admin("/api/statistics?year=2025")).body.matches, 1);
  assert.equal((await admin("/api/statistics?year=2026")).body.matches, 2);
  assert.equal(
    (await admin(`/api/statistics?year=2026&seasonId=${season.id}`)).status,
    400,
  );
  await admin(`/api/players/${player.id}`, "PUT", { status: "inactive" });
  assert.equal(
    (await f.request("/api/auth/me", { cookie: playerCookie })).status,
    401,
  );
  assert.equal(
    (await admin("/api/statistics?year=2025")).body.players.find(
      (p) => p.playerId === player.id,
    ).appearances,
    1,
  );
  await f.restart();
  const newCookie = await f.login();
  r = await f.request(`/api/matches/${match.id}`, { cookie: newCookie });
  assert.equal(r.body.analysis, "传球需要改善。");
  assert.equal(r.body.homeScore, 0);
});

test("authentication, authorization, origin checks, account reset and password change revoke sessions", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/api/tactics",
    "/api/coaching-desk",
    "/api/tactic-collections",
    "/api/players",
    "/api/matches",
    "/api/seasons",
    "/api/statistics",
  ])
    assert.equal((await f.request(path)).status, 401);
  assert.equal((await f.request("/api/health")).status, 200);
  assert.equal(
    (
      await f.request("/api/auth/login", {
        method: "POST",
        body: credentials,
        origin: false,
      })
    ).status,
    403,
  );
  const cookie = await f.login();
  const p = (
    await f.request("/api/players", {
      cookie,
      method: "POST",
      body: { name: "测试员" },
    })
  ).body;
  await f.request(`/api/players/${p.id}/account`, {
    cookie,
    method: "POST",
    body: { username: "player", password: "player-password" },
  });
  const pc = await f.login({ username: "player", password: "player-password" });
  for (const [route, method, body] of [
    ["/api/players", "POST", { name: "不允许" }],
    ["/api/matches", "POST", {}],
    ["/api/seasons", "POST", {}],
    ["/api/tactics", "POST", {}],
    ["/api/coaching-desk", "PUT", {}],
    ["/api/tactic-collections", "POST", {}],
  ])
    assert.equal(
      (await f.request(route, { method, body, cookie: pc })).status,
      403,
    );
  assert.equal(
    (
      await f.request(`/api/players/${p.id}/password`, {
        cookie,
        method: "PUT",
        body: { newPassword: "reset-password" },
      })
    ).status,
    204,
  );
  assert.equal((await f.request("/api/auth/me", { cookie: pc })).status, 401);
  assert.equal(
    (
      await f.request("/api/auth/login", {
        method: "POST",
        body: { username: "player", password: "player-password" },
      })
    ).status,
    401,
  );
  const fresh = await f.login({
    username: "player",
    password: "reset-password",
  });
  assert.equal(
    (
      await f.request("/api/auth/password", {
        cookie: fresh,
        method: "PUT",
        body: { currentPassword: "wrong", newPassword: "new-password-123" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/auth/password", {
        cookie: fresh,
        method: "PUT",
        body: {
          currentPassword: "reset-password",
          newPassword: "new-password-123",
        },
      })
    ).status,
    204,
  );
  assert.equal(
    (await f.request("/api/auth/me", { cookie: fresh })).status,
    401,
  );
  await f.login({ username: "player", password: "new-password-123" });
});

test("legacy roster migrates without losing tactics; club history survives tactical roster replacement and restart", async (t) => {
  let tacticId;
  const f = await fixture(t, (path) => {
    const legacy = openFootballStore(path);
    const board = { pieces: [], markings: [] };
    tacticId = legacy.saveTactic(null, {
      tactic: {
        title: "保留战术",
        tags: [],
        favorite: false,
        formationName: "2-3-2",
        board,
        thumbnail: null,
      },
    }).tacticId;
    legacy.saveDesk({
      edition: 0,
      desk: {
        board,
        selectedTacticId: tacticId,
        players: [
          {
            playerId: "legacy-one",
            name: "老球员",
            number: 7,
            positions: ["前锋"],
            preferredFoot: "右",
            status: "ok",
            note: "保留",
            fieldPieceId: null,
          },
        ],
      },
    });
    legacy.close();
  });
  const cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body });
  assert.equal((await call("/api/players")).body[0].id, "legacy-one");
  assert.equal((await call(`/api/tactics/${tacticId}`)).body.title, "保留战术");
  await call("/api/players/legacy-one", "PUT", { name: "已修改" });
  let desk = (await call("/api/coaching-desk")).body;
  assert.equal(desk.desk.players[0].name, "已修改");
  const m = (
    await call("/api/matches", "POST", {
      opponent: "历史",
      date: "2026-01-01",
      status: "completed",
    })
  ).body;
  await call(`/api/matches/${m.id}/roster`, "PUT", {
    roster: [{ playerId: "legacy-one", appeared: true, goals: 3 }],
  });
  await call("/api/coaching-desk", "PUT", {
    edition: desk.edition,
    desk: null,
  });
  assert.equal((await call("/api/players")).body.length, 1);
  await f.restart();
  const next = await f.login();
  const stats = (await f.request("/api/statistics?year=2026", { cookie: next }))
    .body;
  assert.equal(stats.players[0].goals, 3);
  assert.equal(
    (await f.request("/api/tactics", { cookie: next })).body.length,
    1,
  );
});

test("all club queries and tactical resources isolate another team; invalid data rolls back", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const db = new DatabaseSync(f.path);
  db.exec(
    "PRAGMA foreign_keys=ON; INSERT INTO club_teams VALUES (2,'另一个球队')",
  );
  db.prepare(
    "INSERT INTO club_users(team_id,username,password_hash,role) SELECT 2,'other-owner',password_hash,'admin' FROM club_users WHERE username='owner'",
  ).run();
  db.close();
  const foreign = await f.login({
    username: "other-owner",
    password: credentials.password,
  });
  const p = (
    await f.request("/api/players", {
      cookie,
      method: "POST",
      body: { name: "第一队" },
    })
  ).body;
  const m = (
    await f.request("/api/matches", {
      cookie,
      method: "POST",
      body: { opponent: "第一队比赛", date: "2026-10-01" },
    })
  ).body;
  assert.deepEqual(
    (await f.request("/api/players", { cookie: foreign })).body,
    [],
  );
  assert.deepEqual(
    (await f.request("/api/matches", { cookie: foreign })).body,
    [],
  );
  assert.equal(
    (await f.request(`/api/players/${p.id}`, { cookie: foreign })).status,
    404,
  );
  assert.equal(
    (await f.request(`/api/matches/${m.id}`, { cookie: foreign })).status,
    404,
  );
  assert.equal(
    (await f.request("/api/tactics", { cookie: foreign })).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/matches", {
        cookie,
        method: "POST",
        body: { opponent: "坏日期", date: "2026-02-30" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/seasons", {
        cookie,
        method: "POST",
        body: { name: "反向", startDate: "2026-01-02", endDate: "2026-01-01" },
      })
    ).status,
    400,
  );
  const route = `/api/matches/${m.id}/roster`;
  assert.equal(
    (
      await f.request(route, {
        cookie,
        method: "PUT",
        body: { roster: [{ playerId: p.id, appeared: false, goals: 0 }] },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(route, {
        cookie,
        method: "PUT",
        body: { roster: [{ playerId: p.id, appeared: true, goals: -1 }] },
      })
    ).status,
    400,
  );
  assert.deepEqual(
    (await f.request(`/api/matches/${m.id}`, { cookie })).body.roster,
    [],
  );
});

test("sessions expire, logout invalidates cookies, and bootstrap never resets an existing administrator", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const db = new DatabaseSync(f.path);
  db.prepare("UPDATE club_sessions SET expires_at=?").run(Date.now() - 1);
  db.close();
  assert.equal((await f.request("/api/auth/me", { cookie })).status, 401);
  assert.equal(
    (await f.request("/api/auth/logout", { cookie, method: "POST", body: {} }))
      .status,
    204,
  );
  const fresh = await f.login();
  assert.equal(
    (
      await f.request("/api/auth/logout", {
        cookie: fresh,
        method: "POST",
        body: {},
      })
    ).status,
    204,
  );
  assert.equal(
    (await f.request("/api/auth/me", { cookie: fresh })).status,
    401,
  );
  const active = await f.login();
  await f.request("/api/auth/password", {
    cookie: active,
    method: "PUT",
    body: {
      currentPassword: credentials.password,
      newPassword: "changed-owner-password",
    },
  });
  await f.restart();
  assert.equal(
    (await f.request("/api/auth/login", { method: "POST", body: credentials }))
      .status,
    401,
  );
  await f.login({ ...credentials, password: "changed-owner-password" });
});

test("club profile edits invalidate stale tactical desks and known scores bound goal and assist totals", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body });
  const p = (
    await call("/api/players", "POST", { name: "当前名称", number: null })
  ).body;
  await call("/api/coaching-desk", "PUT", {
    edition: 0,
    desk: {
      board: { pieces: [], markings: [] },
      players: [],
      selectedTacticId: null,
    },
  });
  const stale = (await call("/api/coaching-desk")).body;
  await call(`/api/players/${p.id}`, "PUT", { name: "更新名称", number: 8 });
  assert.equal((await call("/api/coaching-desk", "PUT", stale)).status, 409);
  assert.equal((await call(`/api/players/${p.id}`)).body.name, "更新名称");
  await call(`/api/players/${p.id}`, "PUT", { number: null });
  const latest = (await call("/api/coaching-desk")).body;
  assert.equal((await call("/api/coaching-desk", "PUT", latest)).status, 200);
  assert.equal((await call(`/api/players/${p.id}`)).body.number, null);
  const m = (
    await call("/api/matches", "POST", {
      opponent: "比分校验",
      date: "2026-01-01",
      status: "completed",
      homeScore: 0,
      awayScore: 0,
    })
  ).body;
  const roster = `/api/matches/${m.id}/roster`;
  assert.equal(
    (
      await call(roster, "PUT", {
        roster: [{ playerId: p.id, appeared: true, goals: 1 }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(roster, "PUT", {
        roster: [{ playerId: p.id, appeared: true, assists: 1 }],
      })
    ).status,
    400,
  );
  await call(`/api/matches/${m.id}`, "PUT", { homeScore: null });
  assert.equal(
    (
      await call(roster, "PUT", {
        roster: [{ playerId: p.id, appeared: true, goals: 2, assists: 1 }],
      })
    ).status,
    200,
  );
  assert.equal(
    (await call(`/api/matches/${m.id}`, "PUT", { homeScore: 1 })).status,
    400,
  );
  assert.equal((await call(`/api/matches/${m.id}`)).body.homeScore, null);
  assert.equal(
    (await call(`/api/matches/${m.id}`, "PUT", { homeScore: 2 })).status,
    200,
  );
});

test("statistics expose missing and partial rosters separately from explicit unknown or nonappearance", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body });
  const a = (await call("/api/players", "POST", { name: "有记录球员" })).body;
  const b = (await call("/api/players", "POST", { name: "缺少记录球员" })).body;
  const create = async (date, status = "completed") =>
    (await call("/api/matches", "POST", { opponent: "覆盖测试", date, status }))
      .body;
  await create("2025-12-31"); // Complete match, entirely missing roster.
  const partial = await create("2026-01-01");
  await call(`/api/matches/${partial.id}/roster`, "PUT", {
    roster: [{ playerId: a.id, appeared: null }],
  });
  const explicit = await create("2026-01-02");
  await call(`/api/matches/${explicit.id}/roster`, "PUT", {
    roster: [
      { playerId: a.id, appeared: false },
      { playerId: b.id, appeared: true, goals: 0 },
    ],
  });
  await create("2026-01-03", "published"); // Never counted as completed.
  const season = (
    await call("/api/seasons", "POST", {
      name: "边界覆盖",
      startDate: "2025-12-31",
      endDate: "2026-01-01",
    })
  ).body;
  const scoped = (await call(`/api/statistics?seasonId=${season.id}`)).body;
  assert.equal(scoped.matches, 2);
  assert.equal(scoped.matchesWithoutRoster, 1);
  const sa = scoped.players.find((p) => p.playerId === a.id),
    sb = scoped.players.find((p) => p.playerId === b.id);
  assert.equal(sa.appearances, 0);
  assert.equal(sa.unknownAppearances, 1);
  assert.equal(sa.unrecordedMatches, 1);
  assert.equal(sa.goals, null);
  assert.equal(sb.appearances, 0);
  assert.equal(sb.unknownAppearances, 0);
  assert.equal(sb.unrecordedMatches, 2);
  assert.equal(sb.goals, null);
  const year = (await call("/api/statistics?year=2026")).body;
  assert.equal(year.matches, 2);
  assert.equal(year.matchesWithoutRoster, 0);
  const ya = year.players.find((p) => p.playerId === a.id),
    yb = year.players.find((p) => p.playerId === b.id);
  assert.equal(ya.unrecordedMatches, 0);
  assert.equal(ya.unknownAppearances, 1);
  assert.equal(ya.appearances, 0);
  assert.equal(yb.unrecordedMatches, 1);
  assert.equal(yb.unknownAppearances, 0);
  assert.equal(yb.appearances, 1);
  assert.equal(yb.goals, 0);
  const previous = (await call("/api/statistics?year=2025")).body;
  assert.equal(previous.matchesWithoutRoster, 1);
  assert.ok(previous.players.every((p) => p.unrecordedMatches === 1));
});

test("tactical removal archives persisted players, preserves history, and explicit undo restores membership", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body });
  const member = (id, number) => ({
    playerId: id,
    name: id,
    number,
    positions: ["前锋"],
    preferredFoot: "右",
    status: "injured",
    note: "健康状态保留",
    fieldPieceId: null,
  });
  const desk = {
    board: { pieces: [], markings: [] },
    players: [member("first", 9), member("second", 2)],
    selectedTacticId: null,
  };
  await call("/api/coaching-desk", "PUT", { edition: 0, desk });
  await call("/api/players/first/account", "POST", {
    username: "first",
    password: "first-password",
  });
  const playerCookie = await f.login({
    username: "first",
    password: "first-password",
  });
  const match = (
    await call("/api/matches", "POST", {
      opponent: "保留历史",
      date: "2026-01-01",
      status: "completed",
    })
  ).body;
  await call(`/api/matches/${match.id}/roster`, "PUT", {
    roster: [{ playerId: "first", appeared: true, goals: 1 }],
  });
  const unrelated = (
    await call("/api/players", "POST", { name: "未保存到战术名单" })
  ).body;
  const current = (await call("/api/coaching-desk")).body;
  assert.deepEqual(
    current.desk.players.map((p) => p.playerId),
    ["first", "second", unrelated.id],
  );
  const removed = (
    await call("/api/coaching-desk", "PUT", {
      edition: current.edition,
      desk: {
        ...current.desk,
        players: current.desk.players.filter((p) => p.playerId !== "first"),
      },
    })
  ).body;
  assert.equal((await call("/api/players/first")).body.status, "inactive");
  assert.equal(
    (await call(`/api/players/${unrelated.id}`)).body.status,
    "active",
  );
  assert.deepEqual(
    removed.desk.players.map((p) => p.playerId),
    ["second", unrelated.id],
  );
  assert.equal(removed.desk.players[0].status, "injured");
  assert.equal(
    (await f.request("/api/auth/me", { cookie: playerCookie })).status,
    401,
  );
  assert.equal(
    (await call("/api/statistics?year=2026")).body.players.find(
      (p) => p.playerId === "first",
    ).goals,
    1,
  );
  assert.equal(
    (
      await call("/api/coaching-desk", "PUT", {
        edition: current.edition,
        desk,
      })
    ).status,
    409,
  );
  await call("/api/coaching-desk", "PUT", {
    edition: removed.edition,
    desk: {
      ...desk,
      players: [
        ...desk.players,
        current.desk.players.find((p) => p.playerId === unrelated.id),
      ],
    },
  });
  assert.equal((await call("/api/players/first")).body.status, "active");
  const restored = (await call("/api/coaching-desk")).body;
  assert.deepEqual(
    restored.desk.players.map((p) => p.playerId),
    ["first", "second", unrelated.id],
  );
  await call("/api/coaching-desk", "PUT", {
    edition: restored.edition,
    desk: null,
  });
  assert.equal((await call("/api/players/first")).body.status, "active");
});

test("first board save returns club-only profiles and reconciliation failure rolls back the desk", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body });
  const p = (await call("/api/players", "POST", { name: "先创建的球员" })).body;
  assert.equal((await call("/api/coaching-desk")).body.desk, null);
  const desk = {
    board: { pieces: [], markings: [] },
    players: [],
    selectedTacticId: null,
  };
  const saved = (await call("/api/coaching-desk", "PUT", { edition: 0, desk }))
    .body;
  assert.equal(saved.desk.players[0].playerId, p.id);
  const db = new DatabaseSync(f.path);
  db.exec(
    "CREATE TRIGGER reject_club_sync BEFORE UPDATE ON club_players BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
  );
  const loggedError = t.mock.method(console, "error", () => {});
  const failed = await call("/api/coaching-desk", "PUT", {
    edition: saved.edition,
    desk: saved.desk,
  });
  loggedError.mock.restore();
  assert.equal(failed.status, 500);
  db.exec("DROP TRIGGER reject_club_sync");
  db.close();
  const after = (await call("/api/coaching-desk")).body;
  assert.equal(after.edition, saved.edition);
  const check = new DatabaseSync(f.path);
  assert.equal(
    check.prepare("SELECT count(*) AS n FROM team_players").get().n,
    0,
  );
  check.close();
  assert.equal((await call(`/api/players/${p.id}`)).body.status, "active");
});

test("an appended club-only profile can be removed immediately after initial board save", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body });
  const p = (await call("/api/players", "POST", { name: "先于首次战术创建" }))
    .body;
  const players = Array.from({ length: 20 }, (_, index) => ({
    playerId: `seed-${index}`,
    name: `球员${index}`,
    number: index + 1,
    positions: ["待定"],
    preferredFoot: "",
    status: "ok",
    note: "",
    fieldPieceId: null,
  }));
  const seeded = (
    await call("/api/coaching-desk", "PUT", {
      edition: 0,
      desk: {
        board: { pieces: [], markings: [] },
        players,
        selectedTacticId: null,
      },
    })
  ).body;
  assert.equal(seeded.desk.players.length, 21);
  assert.equal(seeded.desk.players[20].playerId, p.id);
  const removed = (
    await call("/api/coaching-desk", "PUT", {
      edition: seeded.edition,
      desk: {
        ...seeded.desk,
        players: seeded.desk.players.filter(
          (player) => player.playerId !== p.id,
        ),
      },
    })
  ).body;
  assert.equal(removed.desk.players.length, 20);
  assert.equal((await call(`/api/players/${p.id}`)).body.status, "inactive");
  const newProfile = (
    await call("/api/players", "POST", { name: "旧页面未见的新球员" })
  ).body;
  assert.equal((await call("/api/coaching-desk", "PUT", removed)).status, 409);
  assert.equal(
    (await call(`/api/players/${newProfile.id}`)).body.status,
    "active",
  );
  assert.equal((await call("/api/coaching-desk")).body.desk.players.length, 21);
});
