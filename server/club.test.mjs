import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { createFootballServer } from "./index.mjs";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";

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
    { method = "GET", body, cookie, origin = true, withRevision = true } = {},
  ) {
    // Workflow tests obtain current revisions; conflict tests use explicit revisions.
    if (
      withRevision &&
      method === "PUT" &&
      body &&
      body.revision === undefined
    ) {
      const match =
        /^\/api\/(players|matches|seasons)\/([^/]+)(?:\/(roster))?$/.exec(
          route,
        );
      if (match) {
        const current = await request(
          match[1] === "seasons"
            ? "/api/seasons"
            : `/api/${match[1]}/${match[2]}`,
          { cookie },
        );
        const value =
          match[1] === "seasons" && Array.isArray(current.body)
            ? current.body.find((item) => item.id === Number(match[2]))
            : current.body;
        if (current.status === 200 && value)
          body = { ...body, revision: value.revision };
      }
    }
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
    "PRAGMA foreign_keys=ON; INSERT INTO club_teams(id,name) VALUES (2,'另一个球队')",
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
    desk: {
      ...saved.desk,
      players: saved.desk.players.map((p) => ({
        ...p,
        name: "trigger changed profile",
      })),
    },
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

test("club revisions reject missing and stale writes, including cross-panel roster and tactical profile changes", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body, withRevision: false });
  const player = (await call("/api/players", "POST", { name: "旧名" })).body;
  assert.equal(player.revision, 1);
  assert.equal(
    (await call(`/api/players/${player.id}`, "PUT", { name: "缺少版本" }))
      .status,
    428,
  );
  const updated = (
    await call(`/api/players/${player.id}`, "PUT", {
      revision: player.revision,
      name: "新名",
    })
  ).body;
  assert.equal(updated.revision, 2);
  assert.equal(
    (
      await call(`/api/players/${player.id}`, "PUT", {
        ...player,
        status: "inactive",
      })
    ).status,
    409,
  );
  assert.equal((await call(`/api/players/${player.id}`)).body.name, "新名");
  const match = (
    await call("/api/matches", "POST", {
      opponent: "对手",
      date: "2026-01-01",
      status: "published",
    })
  ).body;
  assert.equal(
    (await call(`/api/matches/${match.id}`, "PUT", { location: "无版本" }))
      .status,
    428,
  );
  const completed = (
    await call(`/api/matches/${match.id}`, "PUT", {
      revision: match.revision,
      status: "completed",
      homeScore: 3,
      awayScore: 1,
    })
  ).body;
  assert.equal(
    (
      await call(`/api/matches/${match.id}`, "PUT", {
        ...match,
        location: "旧完整表单",
      })
    ).status,
    409,
  );
  assert.equal(
    (await call(`/api/matches/${match.id}/roster`, "PUT", { roster: [] }))
      .status,
    428,
  );
  const roster = (
    await call(`/api/matches/${match.id}/roster`, "PUT", {
      revision: completed.revision,
      roster: [{ playerId: player.id, appeared: true, goals: 1 }],
    })
  ).body;
  assert.equal(roster.revision, completed.revision + 1);
  assert.equal(
    (
      await call(`/api/matches/${match.id}/roster`, "PUT", {
        revision: completed.revision,
        roster: [],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(`/api/matches/${match.id}`, "PUT", {
        ...completed,
        analysis: "旧面板",
      })
    ).status,
    409,
  );
  const remaining = (await call(`/api/matches/${match.id}`)).body;
  assert.equal(remaining.status, "completed");
  assert.equal(remaining.homeScore, 3);
  assert.equal(remaining.roster[0].goals, 1);
  const season = (
    await call("/api/seasons", "POST", {
      name: "赛季",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    })
  ).body;
  assert.equal(
    (await call(`/api/seasons/${season.id}`, "PUT", { name: "无版本" })).status,
    428,
  );
  assert.equal(
    (
      await call(`/api/seasons/${season.id}`, "PUT", {
        revision: season.revision,
        endDate: "2027-01-01",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call(`/api/seasons/${season.id}`, "PUT", {
        ...season,
        name: "旧表单",
      })
    ).status,
    409,
  );
  const desk = (
    await call("/api/coaching-desk", "PUT", {
      edition: 0,
      desk: {
        board: { pieces: [], markings: [] },
        players: [],
        selectedTacticId: null,
      },
    })
  ).body;
  const profileBefore = (await call(`/api/players/${player.id}`)).body;
  const saved = (
    await call("/api/coaching-desk", "PUT", {
      ...desk,
      desk: {
        ...desk.desk,
        players: desk.desk.players.map((p) => ({ ...p, name: "战术改名" })),
      },
    })
  ).body;
  const profileAfter = (await call(`/api/players/${player.id}`)).body;
  assert.equal(profileAfter.revision, profileBefore.revision + 1);
  assert.equal(
    (
      await call(`/api/players/${player.id}`, "PUT", {
        ...profileBefore,
        note: "旧资料",
      })
    ).status,
    409,
  );
  await call("/api/coaching-desk", "PUT", saved);
  assert.equal(
    (await call(`/api/players/${player.id}`)).body.revision,
    profileAfter.revision,
  );
});

test("legacy large avatars survive full profile editing and archiving through HTTP", async (t) => {
  const avatar = "data:image/png;base64," + "a".repeat(2 * 1024 * 1024);
  const f = await fixture(t, (path) => {
    const legacy = openFootballStore(path);
    legacy.saveDesk({
      edition: 0,
      desk: {
        board: { pieces: [], markings: [] },
        selectedTacticId: null,
        players: [
          {
            playerId: "large-avatar",
            name: "旧球员",
            number: 1,
            positions: ["中场"],
            preferredFoot: "右",
            status: "ok",
            note: "",
            avatar,
            fieldPieceId: null,
          },
        ],
      },
    });
    legacy.close();
  });
  const cookie = await f.login();
  const player = (await f.request("/api/players/large-avatar", { cookie }))
    .body;
  const renamed = await f.request("/api/players/large-avatar", {
    cookie,
    method: "PUT",
    body: { ...player, name: "新名" },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.avatar, avatar);
  const archived = await f.request("/api/players/large-avatar", {
    cookie,
    method: "PUT",
    body: { revision: renamed.body.revision, status: "inactive" },
  });
  assert.equal(archived.status, 200);
  assert.equal(archived.body.avatar, avatar);
  await f.restart();
  const next = await f.login();
  const persisted = (
    await f.request("/api/players/large-avatar", { cookie: next })
  ).body;
  assert.equal(persisted.status, "inactive");
  assert.equal(persisted.avatar, avatar);
  assert.equal(persisted.name, "新名");
});

test("team statistics use independent score coverage and inclusive season and year filters", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body });
  for (const [date, homeScore, awayScore, status = "completed"] of [
    ["2025-12-31", 3, 1],
    ["2026-01-01", 0, 0],
    ["2026-01-02", 1, 2],
    ["2026-01-03", 2, null],
    ["2026-01-04", null, 4],
    ["2026-01-05", null, null],
    ["2026-01-06", 9, 0, "published"],
  ])
    await call("/api/matches", "POST", {
      opponent: "统计对手",
      date,
      homeScore,
      awayScore,
      status,
    });
  const season = (
    await call("/api/seasons", "POST", {
      name: "跨年范围",
      startDate: "2025-12-31",
      endDate: "2026-01-04",
    })
  ).body;
  const seasonal = (await call(`/api/statistics?seasonId=${season.id}`)).body
    .team;
  assert.deepEqual(seasonal, {
    matches: 5,
    scoredMatches: 3,
    wins: 1,
    draws: 1,
    losses: 1,
    goalsFor: 6,
    goalsAgainst: 7,
    goalsForKnownMatches: 4,
    goalsAgainstKnownMatches: 4,
  });
  const year = (await call("/api/statistics?year=2026")).body.team;
  assert.deepEqual(year, {
    matches: 5,
    scoredMatches: 2,
    wins: 0,
    draws: 1,
    losses: 1,
    goalsFor: 3,
    goalsAgainst: 6,
    goalsForKnownMatches: 3,
    goalsAgainstKnownMatches: 3,
  });
  const empty = (await call("/api/statistics?year=2024")).body.team;
  assert.equal(empty.matches, 0);
  assert.equal(empty.goalsFor, null);
  assert.equal(empty.goalsAgainst, null);
  assert.equal(empty.scoredMatches, 0);
});

test("linked match tactics require explicit unlinking before deletion", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body });
  const tactic = (
    await call("/api/tactics", "POST", {
      tactic: {
        title: "历史关联",
        tags: [],
        favorite: false,
        formationName: "2-3-2",
        board: { pieces: [], markings: [] },
        thumbnail: null,
      },
    })
  ).body;
  const match = (
    await call("/api/matches", "POST", {
      opponent: "历史对手",
      date: "2026-01-01",
      status: "completed",
      tacticIds: [tactic.tacticId],
    })
  ).body;
  const blocked = await call(`/api/tactics/${tactic.tacticId}`, "DELETE");
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /1 场比赛/);
  assert.deepEqual((await call(`/api/matches/${match.id}`)).body.tacticIds, [
    tactic.tacticId,
  ]);
  await call(`/api/matches/${match.id}`, "PUT", {
    revision: match.revision,
    tacticIds: [],
  });
  assert.equal(
    (await call(`/api/tactics/${tactic.tacticId}`, "DELETE")).status,
    204,
  );
});

test("revision migration upgrades existing club tables without replacing records", async (t) => {
  const f = await fixture(t, (path) => {
    const legacy = openFootballStore(path),
      club = createClubStore(legacy.database, legacy);
    club.savePlayer(1, null, { name: "迁移球员" });
    club.saveSeason(1, null, {
      name: "迁移赛季",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    club.saveMatch({ team_id: 1, role: "admin" }, null, {
      opponent: "迁移对手",
      date: "2026-01-01",
    });
    for (const table of ["club_players", "club_matches", "club_seasons"])
      legacy.database.exec(`ALTER TABLE ${table} DROP COLUMN revision`);
    legacy.database
      .prepare(
        "DELETE FROM app_migrations WHERE migration_name='club-revisions-v2'",
      )
      .run();
    legacy.close();
  });
  const cookie = await f.login();
  for (const path of ["/api/players", "/api/seasons", "/api/matches"]) {
    const result = (await f.request(path, { cookie })).body;
    assert.equal(result.length, 1);
    assert.equal(result[0].revision, 1);
  }
  await f.restart();
  const next = await f.login();
  assert.equal(
    (await f.request("/api/players", { cookie: next })).body[0].revision,
    1,
  );
});

test("team profile is role/team scoped, validates raster crests, rejects stale revisions and survives restart", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body });
  assert.equal((await f.request("/api/team")).status, 401);
  const team = (await call("/api/team")).body;
  assert.equal(team.crest, null);
  assert.equal(team.revision, 1);
  assert.equal(
    (await call("/api/team", "PUT", { name: "无版本" })).status,
    428,
  );
  const crest =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ3kAAAAASUVORK5CYII=";
  const saved = (
    await call("/api/team", "PUT", {
      revision: team.revision,
      name: "  新球队  ",
      crest,
    })
  ).body;
  assert.equal(saved.name, "新球队");
  assert.equal(saved.crest, crest);
  assert.equal(saved.revision, 2);
  assert.equal((await call("/api/auth/me")).body.team.crest, crest);
  assert.equal(
    (
      await call("/api/team", "PUT", {
        revision: team.revision,
        name: "旧页面",
      })
    ).status,
    409,
  );
  for (const image of [
    "https://example.com/crest.png",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/png;base64,aGVsbG8=",
    crest.replace("image/png", "image/jpeg"),
    "data:image/png;base64,@@@@",
    "data:image/png;base64," +
      Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
  ]) {
    assert.equal(
      (
        await call("/api/team", "PUT", {
          revision: saved.revision,
          crest: image,
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (await call("/api/team", "PUT", { revision: saved.revision, name: " " }))
      .status,
    400,
  );
  const player = (await call("/api/players", "POST", { name: "只读球员" }))
    .body;
  await call(`/api/players/${player.id}/account`, "POST", {
    username: "readonly",
    password: "readonly-password",
  });
  const playerCookie = await f.login({
    username: "readonly",
    password: "readonly-password",
  });
  assert.equal(
    (await f.request("/api/team", { cookie: playerCookie })).body.name,
    "新球队",
  );
  assert.equal(
    (
      await f.request("/api/team", {
        cookie: playerCookie,
        method: "PUT",
        body: { revision: saved.revision, name: "越权" },
      })
    ).status,
    403,
  );
  const db = new DatabaseSync(f.path);
  db.exec(
    "PRAGMA foreign_keys=ON; INSERT INTO club_teams(id,name) VALUES(2,'第二队')",
  );
  db.prepare(
    "INSERT INTO club_users(team_id,username,password_hash,role) SELECT 2,'second-team',password_hash,'admin' FROM club_users WHERE username='owner'",
  ).run();
  db.close();
  const other = await f.login({
    username: "second-team",
    password: credentials.password,
  });
  const otherTeam = (await f.request("/api/team", { cookie: other })).body;
  assert.equal(otherTeam.name, "第二队");
  assert.equal(otherTeam.crest, null);
  await f.request("/api/team", {
    cookie: other,
    method: "PUT",
    body: { id: 1, revision: otherTeam.revision, name: "第二队更新" },
  });
  assert.equal((await call("/api/team")).body.name, "新球队");
  await f.restart();
  const next = await f.login();
  const after = (await f.request("/api/team", { cookie: next })).body;
  assert.deepEqual(after, saved);
  assert.equal(
    (
      await f.request("/api/team", {
        cookie: next,
        method: "PUT",
        body: { revision: after.revision, crest: null },
      })
    ).body.crest,
    null,
  );
});

test("opponent summaries group trimmed names within season/year and retain unknown score coverage", async (t) => {
  const f = await fixture(t),
    cookie = await f.login();
  const call = (route, method = "GET", body) =>
    f.request(route, { cookie, method, body });
  for (const [opponent, date, homeScore, awayScore, status = "completed"] of [
    [" 对手甲 ", "2025-12-31", 2, 1],
    ["对手甲", "2026-01-01", null, 3],
    ["对手甲", "2026-01-02", 0, 0],
    ["对手乙", "2026-01-01", null, null],
    ["对手乙", "2026-01-03", 1, 4],
    ["对手甲", "2026-01-04", 9, 0, "published"],
  ])
    await call("/api/matches", "POST", {
      opponent,
      date,
      homeScore,
      awayScore,
      status,
    });
  const season = (
    await call("/api/seasons", "POST", {
      name: "跨年对手",
      startDate: "2025-12-31",
      endDate: "2026-01-01",
    })
  ).body;
  const seasonal = (await call(`/api/statistics?seasonId=${season.id}`)).body
    .opponents;
  assert.equal(seasonal.length, 2);
  assert.deepEqual(
    seasonal.find((r) => r.opponent === "对手甲"),
    {
      opponent: "对手甲",
      matches: 2,
      scoredMatches: 1,
      wins: 1,
      draws: 0,
      losses: 0,
      goalsFor: 2,
      goalsAgainst: 4,
      goalsForKnownMatches: 1,
      goalsAgainstKnownMatches: 2,
    },
  );
  const unknown = seasonal.find((r) => r.opponent === "对手乙");
  assert.equal(unknown.matches, 1);
  assert.equal(unknown.goalsFor, null);
  assert.equal(unknown.goalsAgainst, null);
  assert.equal(unknown.scoredMatches, 0);
  assert.equal(unknown.losses, 0);
  const year = (await call("/api/statistics?year=2026")).body.opponents;
  const a = year.find((r) => r.opponent === "对手甲");
  assert.equal(a.matches, 2);
  assert.equal(a.wins, 0);
  assert.equal(a.draws, 1);
  assert.equal(a.goalsFor, 0);
  assert.equal(a.goalsForKnownMatches, 1);
  const b = year.find((r) => r.opponent === "对手乙");
  assert.equal(b.matches, 2);
  assert.equal(b.losses, 1);
  assert.equal(b.goalsAgainst, 4);
  assert.equal(b.goalsAgainstKnownMatches, 1);
  assert.deepEqual(
    (await call("/api/statistics?year=2024")).body.opponents,
    [],
  );
  const db = new DatabaseSync(f.path);
  db.exec(
    "INSERT INTO club_teams(id,name) VALUES(2,'其他队'); INSERT INTO club_matches(team_id,opponent,match_date,status,home_score,away_score) VALUES(2,'其他对手','2026-01-01','completed',99,0)",
  );
  db.close();
  assert.equal(
    (await call("/api/statistics?year=2026")).body.opponents.length,
    2,
  );
});

test("team profile migration preserves existing names and membership", async (t) => {
  const f = await fixture(t, (path) => {
    const legacy = openFootballStore(path);
    createClubStore(legacy.database, legacy, { bootstrapAdmin: credentials });
    legacy.database.exec(
      "UPDATE club_teams SET name='已有球队名称' WHERE id=1; ALTER TABLE club_teams DROP COLUMN crest; ALTER TABLE club_teams DROP COLUMN revision; DELETE FROM app_migrations WHERE migration_name='club-team-profile-v3'",
    );
    legacy.close();
  });
  const cookie = await f.login();
  const team = (await f.request("/api/team", { cookie })).body;
  assert.deepEqual(team, {
    id: 1,
    name: "已有球队名称",
    crest: null,
    revision: 1,
  });
  assert.deepEqual(
    (await f.request("/api/auth/me", { cookie })).body.team,
    team,
  );
});
