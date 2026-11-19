/**
 * Independent continuous HTTP/SQLite acceptance audit. All adults/teams are fictional.
 * Run: node scripts/audit-business-flow.mjs (Node >= 22.13).
 * Always creates and removes its own temporary databases, binds loopback ephemeral ports,
 * never reads FOOTBALL_DB_PATH, production/demo databases, credentials, or remote services.
 * There are no CLI path arguments, no remote writes, and no business-code edits.
 */
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { once } from "node:events";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  statSync,
  copyFileSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { createFootballServer } from "../server/index.mjs";
import { openFootballStore } from "../server/football-store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(tmpdir(), "football-independent-audit-"));
let databasePath = join(directory, "new-fictional-club.sqlite");
let server,
  origin,
  count = 0,
  stage = "setup";
const started = Date.now();
const credentials = { username: "audit-owner", password: randomUUID() };
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const sourceFiles = [
  "server/index.mjs",
  "server/club-store.mjs",
  "server/football-store.mjs",
];
const hash = (s) => createHash("sha256").update(s).digest("hex");
const sourceHashes = () =>
  Object.fromEntries(
    sourceFiles.map((f) => [f, hash(readFileSync(join(root, f)))]),
  );
const beforeHashes = sourceHashes();
// Never print complete compared rows: accounts/session hashes can occur in SQLite diagnostics.
function eq(actual, expected, label) {
  count++;
  assert.equal(
    isDeepStrictEqual(actual, expected),
    true,
    `${stage}: ${label} (assertion ${count})`,
  );
}
function check(value, label) {
  eq(Boolean(value), true, label);
}
function phase(name) {
  stage = name;
  console.log(`CHECK ${name}`);
}
async function start() {
  server = createFootballServer({
    databasePath,
    bootstrapAdmin: credentials,
    publicOrigin: null,
    secureCookies: false,
    trustedProxyAddresses: [],
    staticDirectory: join(directory, "no-static-files"),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
}
async function stop() {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
async function call(cookie, path, method = "GET", body, expected = 200) {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  eq(response.status, expected, `${method} ${path} HTTP ${expected}`);
  const result = response.status === 204 ? null : await response.json();
  return {
    body: result,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
async function login(data = credentials, expected = 200) {
  return (await call(null, "/api/auth/login", "POST", data, expected)).cookie;
}
function inspect(fn, path = databasePath) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function integrity(path = databasePath) {
  inspect((db) => {
    eq(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
      "SQLite integrity",
    );
    eq(db.prepare("PRAGMA foreign_key_check").all(), [], "SQLite foreign keys");
  }, path);
}
function databaseDigest(path, excludeSessions = false) {
  return inspect((db) => {
    const tables = db
      .prepare(
        "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
    return hash(
      JSON.stringify(
        tables
          .filter((t) => !excludeSessions || t.name !== "club_sessions")
          .map((t) => {
            const safeName = '"' + t.name.replaceAll('"', '""') + '"';
            const rows = db
              .prepare(`SELECT * FROM ${safeName}`)
              .all()
              .map((r) => JSON.stringify(r))
              .sort();
            return [t.name, t.sql, rows];
          }),
      ),
    );
  }, path);
}

try {
  await start();
  phase("fresh initialization and account/team/player setup");
  await call(null, "/api/players", "GET", undefined, 401);
  let admin = await login();
  const A = async (path, method = "GET", body, expected = 200) =>
    (await call(admin, path, method, body, expected)).body;
  let team = await A("/api/team");
  eq(team.name, "我的球队", "neutral default team");
  eq(await A("/api/players"), [], "new club has no sample players");
  eq(await A("/api/tactics"), [], "new club has no sample tactics");
  let desk = await A("/api/coaching-desk");
  eq([desk.desk, desk.initialPlayers], [null, []], "new desk is empty");
  team = await A("/api/team", "PUT", {
    revision: team.revision,
    name: "  审计虚构成年队  ",
    crest: png,
  });
  eq([team.name, team.crest], ["审计虚构成年队", png], "team trim and crest");
  const oldTeam = structuredClone(team);
  await A("/api/team", "PUT", { revision: 1, name: "stale" }, 409);
  eq(await A("/api/team"), oldTeam, "stale team no mutation");
  await A("/api/team", "PUT", { name: "missing" }, 428);
  await A(
    "/api/team",
    "PUT",
    { revision: team.revision, crest: "https://invalid.example/a.png" },
    400,
  );
  eq(await A("/api/team"), oldTeam, "invalid crest no mutation");
  let p = await A(
    "/api/players",
    "POST",
    {
      name: "虚构甲",
      number: 7,
      positions: ["中锋", "中场"],
      preferredFoot: "右",
      note: "虚构成年验收资料",
      avatar: png,
    },
    201,
  );
  let q = await A(
    "/api/players",
    "POST",
    { name: "虚构乙", number: 0, positions: ["中场"] },
    201,
  );
  const r = await A(
    "/api/players",
    "POST",
    { name: "虚构丙", positions: ["门将"] },
    201,
  );
  eq(
    [p.hasAccount, q.number, r.number],
    [false, 0, null],
    "profile separate from account and 0 distinct from null",
  );
  const pc = { username: "fictional-a", password: randomUUID() },
    qc = { username: "fictional-b", password: randomUUID() },
    rc = { username: "fictional-c", password: randomUUID() };
  for (const [player, account] of [
    [p, pc],
    [q, qc],
    [r, rc],
  ])
    await A(`/api/players/${player.id}/account`, "POST", account, 201);
  let pCookie = await login(pc),
    qCookie = await login(qc),
    rCookie = await login(rc);
  eq(
    (await call(pCookie, "/api/auth/me")).body.user.playerId,
    p.id,
    "player login binding",
  );
  desk = await A("/api/coaching-desk");
  eq(
    desk.initialPlayers.map((x) => x.playerId).sort(),
    [p.id, q.id, r.id].sort(),
    "desk only actual club profiles",
  );
  eq(
    desk.initialPlayers.find((x) => x.playerId === r.id).number,
    null,
    "desk initial unknown number",
  );
  desk = await A("/api/coaching-desk", "PUT", {
    edition: desk.edition,
    desk: {
      board: { pieces: [], markings: [] },
      players: desk.initialPlayers,
      selectedTacticId: null,
    },
  });
  eq(desk.desk.players.length, 3, "desk save does not add sample roster");
  inspect((db) => {
    eq(
      db
        .prepare("SELECT shirt_number FROM team_players WHERE player_id=?")
        .get(r.id).shirt_number,
      null,
      "unknown number persists SQL NULL",
    );
    eq(
      db
        .prepare("SELECT shirt_number FROM team_players WHERE player_id=?")
        .get(q.id).shirt_number,
      0,
      "explicit zero persists SQL zero",
    );
  });

  phase("cross-year overlapping seasons and seasonal numbers");
  let s = await A(
    "/api/seasons",
    "POST",
    { name: "跨年甲赛季", startDate: "2026-08-01", endDate: "2027-07-31" },
    201,
  );
  let overlap = await A(
    "/api/seasons",
    "POST",
    { name: "重叠乙赛季", startDate: "2026-08-01", endDate: "2027-07-31" },
    201,
  );
  const staleSeason = structuredClone(s);
  let sr = await A(`/api/seasons/${s.id}/roster`, "PUT", {
    revision: s.revision,
    roster: [
      { playerId: p.id, number: 19 },
      { playerId: q.id, number: 0 },
      { playerId: r.id },
    ],
  });
  s = sr.season;
  let or = await A(`/api/seasons/${overlap.id}/roster`, "PUT", {
    revision: overlap.revision,
    roster: [{ playerId: p.id, number: 99 }],
  });
  overlap = or.season;
  eq(sr.roster.find((x) => x.playerId === p.id).number, 19, "season A number");
  eq(or.roster[0].number, 99, "season B independent number");
  eq(
    (await A(`/api/players/${p.id}`)).number,
    7,
    "season squad does not change profile number",
  );
  await A(
    `/api/seasons/${s.id}`,
    "PUT",
    { revision: staleSeason.revision, name: "stale" },
    409,
  );
  await A(`/api/seasons/${s.id}/roster`, "PUT", { roster: [] }, 428);
  eq(
    await A(`/api/seasons/${s.id}/roster`),
    sr,
    "invalid season changes atomic",
  );
  await call(
    pCookie,
    `/api/seasons/${s.id}/roster`,
    "PUT",
    { revision: s.revision, roster: [] },
    403,
  );

  phase("match publication, explicit membership, tri-state registration");
  const originalPiece = {
    pieceId: "fictional-forward",
    playerId: p.id,
    x: 30,
    y: 40,
    shirtNumber: 19,
    label: "虚构甲",
    kind: "player",
    team: "home",
  };
  const originalTactic = {
    title: "虚构原战术",
    tags: ["验收"],
    favorite: false,
    formationName: "3-2-1",
    board: {
      playerCount: 7,
      formationId: "3-2-1",
      awayFormationId: "2-2-2",
      pieces: [originalPiece],
      markings: [
        {
          markingId: "audit-arrow",
          kind: "arrow",
          startX: 30,
          startY: 40,
          endX: 60,
          endY: 80,
          color: "#ffffff",
        },
      ],
      trainingPlan: { instructions: "历史训练指示" },
      demonstration: {
        demonstrationId: "audit-animation",
        title: "历史两步演示",
        participants: [originalPiece],
        stages: [
          {
            stageNumber: 0,
            title: "站位",
            durationSeconds: 1,
            positions: [{ pieceId: originalPiece.pieceId, x: 30, y: 40 }],
          },
          {
            stageNumber: 1,
            title: "前插",
            durationSeconds: 2,
            positions: [{ pieceId: originalPiece.pieceId, x: 60, y: 80 }],
          },
        ],
        runs: [
          {
            pieceId: originalPiece.pieceId,
            fromStage: 0,
            bend: { x: 40, y: 75 },
          },
        ],
      },
    },
    thumbnail: png,
  };
  let tactic = await A("/api/tactics", "POST", { tactic: originalTactic }, 201);
  const makeMatch = (fields) =>
    A(
      "/api/matches",
      "POST",
      { opponent: "虚构对手", date: "2027-01-01", ...fields },
      201,
    );
  let away = await makeMatch({
    opponent: "  虚构对手  ",
    date: "2026-12-31",
    seasonId: s.id,
    competition: "友谊赛",
    format: 7,
    side: "away",
    kickoff: "19:30",
    location: "虚构球场",
    tacticIds: [tactic.tacticId],
  });
  eq(
    away.tacticSnapshots[0].tactic.board,
    originalTactic.board,
    "snapshot captures exact players, arrows, formations and animation stages",
  );
  eq(
    away.tacticSnapshots[0].captureSource,
    "association",
    "fresh snapshot honest association provenance",
  );
  let home = await makeMatch({ seasonId: s.id, side: "home" });
  let unknown = await makeMatch({
    opponent: "未知比分队",
    date: "2027-07-31",
    seasonId: s.id,
    status: "completed",
  });
  const otherSeason = await makeMatch({
    seasonId: overlap.id,
    status: "completed",
    homeScore: 5,
    awayScore: 0,
  });
  const unassigned = await makeMatch({
    status: "completed",
    homeScore: 7,
    awayScore: 1,
  });
  let upcoming = await makeMatch({
    seasonId: s.id,
    date: "2026-08-01",
    status: "published",
  });
  const cancelled = await makeMatch({
    seasonId: s.id,
    status: "cancelled",
    homeScore: 8,
    awayScore: 0,
  });
  const draft = await makeMatch({ seasonId: s.id, homeScore: 9, awayScore: 0 });
  eq(
    [home.competition, home.format, unassigned.seasonId, unknown.side],
    ["", null, null, "unknown"],
    "unknown fields remain unknown, no implicit season",
  );
  eq(
    [away.competition, away.format, away.side, away.kickoff, away.location],
    ["友谊赛", 7, "away", "19:30", "虚构球场"],
    "complete match fields",
  );
  await call(pCookie, `/api/matches/${away.id}`, "GET", undefined, 404);
  check(
    !(await call(pCookie, "/api/matches")).body.some((m) => m.id === draft.id),
    "player list hides draft",
  );
  for (const fields of [
    { date: "2026-07-31", seasonId: s.id },
    { format: 10 },
    { side: "left" },
    { date: "2027-02-29" },
  ])
    await A(
      "/api/matches",
      "POST",
      { opponent: "非法测试", date: "2027-01-01", ...fields },
      400,
    );
  const beforeMatches = await A("/api/matches");
  await A(
    `/api/seasons/${s.id}`,
    "PUT",
    { revision: s.revision, startDate: "2026-08-02" },
    409,
  );
  eq(
    await A("/api/matches"),
    beforeMatches,
    "season narrowing never changes existing matches",
  );
  away = await A(`/api/matches/${away.id}`, "PUT", {
    revision: away.revision,
    status: "published",
  });
  home = await A(`/api/matches/${home.id}`, "PUT", {
    revision: home.revision,
    status: "published",
  });
  let signed = (
    await call(pCookie, `/api/matches/${away.id}/rsvp`, "PUT", {
      response: "yes",
      playerId: q.id,
    })
  ).body;
  eq(
    signed.rsvps,
    [{ playerId: p.id, response: "yes", membershipKind: "member" }],
    "cannot RSVP as supplied other player ID",
  );
  eq(
    signed.revision,
    away.revision,
    "RSVP does not invalidate admin match form",
  );
  await call(qCookie, `/api/matches/${away.id}/rsvp`, "PUT", {
    response: "no",
  });
  await call(rCookie, `/api/matches/${away.id}/rsvp`, "PUT", {
    response: "maybe",
  });
  await call(pCookie, `/api/matches/${home.id}/rsvp`, "PUT", {
    response: "no",
  });
  await call(pCookie, `/api/matches/${upcoming.id}/rsvp`, "PUT", {
    response: "maybe",
  });
  await A(`/api/matches/${away.id}/rsvp`, "PUT", { response: "yes" }, 403);
  await call(
    pCookie,
    `/api/matches/${cancelled.id}/rsvp`,
    "PUT",
    { response: "yes" },
    409,
  );
  await call(
    pCookie,
    `/api/matches/${upcoming.id}/rsvp`,
    "PUT",
    { response: "invalid" },
    400,
  );

  phase(
    "lineups, actual appearances, known zero, unknown and complete results",
  );
  away = await A(`/api/matches/${away.id}/roster`, "PUT", {
    revision: away.revision,
    roster: [
      {
        playerId: p.id,
        position: "中锋",
        selection: "starter",
        appeared: true,
        goals: 2,
        assists: 0,
      },
      {
        playerId: q.id,
        position: "中场",
        selection: "bench",
        appeared: true,
        goals: 1,
        assists: 1,
      },
      {
        playerId: r.id,
        position: "门将",
        selection: "starter",
        appeared: null,
        goals: null,
        assists: null,
      },
    ],
  });
  eq(
    away.roster.find((x) => x.playerId === p.id).playerSnapshot.number,
    19,
    "match snapshot seasonal shirt number",
  );
  eq(
    away.roster.find((x) => x.playerId === q.id).selection,
    "bench",
    "bench may actually appear despite declined RSVP",
  );
  const beforeBadScore = structuredClone(away);
  await A(
    `/api/matches/${away.id}`,
    "PUT",
    {
      revision: away.revision,
      status: "completed",
      homeScore: 2,
      awayScore: 1,
    },
    400,
  );
  eq(
    await A(`/api/matches/${away.id}`),
    beforeBadScore,
    "invalid score full rollback",
  );
  away = await A(`/api/matches/${away.id}`, "PUT", {
    revision: away.revision,
    status: "completed",
    homeScore: 3,
    awayScore: 1,
    analysis: "虚构赛后总结",
  });
  await call(
    pCookie,
    `/api/matches/${away.id}/rsvp`,
    "PUT",
    { response: "no" },
    409,
  );
  home = await A(`/api/matches/${home.id}/roster`, "PUT", {
    revision: home.revision,
    roster: [
      {
        playerId: p.id,
        position: "中锋",
        selection: "starter",
        appeared: false,
      },
      {
        playerId: q.id,
        position: "中场",
        selection: "bench",
        appeared: true,
        goals: 0,
        assists: null,
      },
    ],
  });
  home = await A(`/api/matches/${home.id}`, "PUT", {
    revision: home.revision,
    status: "completed",
    homeScore: 0,
    awayScore: null,
  });
  const stableHome = structuredClone(home);
  for (const roster of [
    [{ playerId: p.id, appeared: false, goals: 0 }],
    [{ playerId: q.id, appeared: true, goals: -1 }],
    [{ playerId: q.id, appeared: true, goals: 1 }],
    [{ playerId: q.id, appeared: true, assists: 1 }],
  ])
    await A(
      `/api/matches/${home.id}/roster`,
      "PUT",
      { revision: home.revision, roster },
      400,
    );
  eq(
    await A(`/api/matches/${home.id}`),
    stableHome,
    "invalid roster full rollback",
  );

  phase("season/year/player/team/opponent statistics and coverage");
  let stats = await A(`/api/statistics?seasonId=${s.id}`);
  eq(
    [
      stats.matches,
      stats.registrationMatches,
      stats.matchesWithoutRoster,
      stats.unassignedMatches,
    ],
    [3, 4, 1, 1],
    "scope and absence coverage",
  );
  eq(
    stats.team,
    {
      matches: 3,
      scoredMatches: 1,
      wins: 1,
      draws: 0,
      losses: 0,
      goalsFor: 3,
      goalsAgainst: 1,
      goalsForKnownMatches: 2,
      goalsAgainstKnownMatches: 1,
      attendance: {
        confirmedAppearances: 3,
        unknownAppearances: 1,
        matchesWithoutRoster: 1,
      },
    },
    "away score means our team wins; independent known score coverage",
  );
  const ps = stats.players.find((x) => x.playerId === p.id),
    qs = stats.players.find((x) => x.playerId === q.id),
    rs = stats.players.find((x) => x.playerId === r.id);
  eq(
    ps.registration,
    { yes: 1, no: 1, maybe: 1, unanswered: 1 },
    "three RSVP states and unanswered",
  );
  eq(
    [
      ps.appearances,
      ps.unknownAppearances,
      ps.unrecordedMatches,
      ps.goals,
      ps.assists,
      ps.goalsKnownMatches,
      ps.assistsKnownMatches,
    ],
    [1, 0, 1, 2, 0, 1, 1],
    "player explicit nonappearance and zero assists",
  );
  eq(
    [
      qs.appearances,
      qs.goals,
      qs.assists,
      qs.goalsKnownMatches,
      qs.assistsKnownMatches,
    ],
    [2, 1, 1, 2, 1],
    "known zero contributes coverage, unknown does not",
  );
  eq(
    [
      rs.appearances,
      rs.unknownAppearances,
      rs.unrecordedMatches,
      rs.goals,
      rs.assists,
    ],
    [0, 1, 2, null, null],
    "unknown and missing rows never zero",
  );
  eq(
    stats.opponents.map((x) => [
      x.opponent,
      x.matches,
      x.scoredMatches,
      x.goalsFor,
      x.goalsAgainst,
    ]),
    [
      ["虚构对手", 2, 1, 3, 1],
      ["未知比分队", 1, 0, null, null],
    ],
    "trimmed opponent grouping and unknown opponent totals",
  );
  const statsB = await A(`/api/statistics?seasonId=${overlap.id}`),
    y26 = await A("/api/statistics?year=2026"),
    y27 = await A("/api/statistics?year=2027");
  eq(
    [statsB.matches, statsB.team.goalsFor],
    [1, 5],
    "overlap season isolation",
  );
  eq(
    [y26.matches, y26.team.goalsFor, y26.registrationMatches],
    [1, 3, 2],
    "year 2026 dates not season full range",
  );
  eq(
    [
      y27.matches,
      y27.team.goalsFor,
      y27.team.goalsAgainst,
      y27.team.scoredMatches,
      y27.registrationMatches,
    ],
    [4, 12, 1, 2, 4],
    "year 2027 includes unassigned and other season, not prior-year away",
  );
  await A(`/api/statistics?year=2027&seasonId=${s.id}`, "GET", undefined, 400);
  eq(
    (await call(qCookie, `/api/statistics?seasonId=${s.id}`)).body,
    stats,
    "player reads same truthful team statistics",
  );

  phase("strict revisions, roles, foreign-team read/write isolation");
  const frozenAway = await A(`/api/matches/${away.id}`);
  away = await A(`/api/matches/${away.id}`, "PUT", {
    revision: frozenAway.revision,
    location: "更新后的虚构球场",
  });
  await A(
    `/api/matches/${away.id}`,
    "PUT",
    { revision: frozenAway.revision, status: "draft", homeScore: 99 },
    409,
  );
  await A(
    `/api/matches/${away.id}/roster`,
    "PUT",
    { revision: frozenAway.revision, roster: [] },
    409,
  );
  await A(
    `/api/matches/${away.id}`,
    "PUT",
    { location: "missing revision" },
    428,
  );
  eq(
    await A(`/api/matches/${away.id}`),
    away,
    "stale and missing revision leave full match identical",
  );
  p = await A(`/api/players/${p.id}`);
  const oldP = structuredClone(p);
  p = await A(`/api/players/${p.id}`, "PUT", {
    revision: p.revision,
    note: "已更新",
  });
  await A(
    `/api/players/${p.id}`,
    "PUT",
    { revision: oldP.revision, name: "stale" },
    409,
  );
  eq(
    await A(`/api/players/${p.id}`),
    p,
    "stale player leaves profile identical",
  );
  for (const [path, method, body] of [
    ["/api/team", "PUT", { revision: team.revision, name: "forbidden" }],
    ["/api/players", "POST", { name: "forbidden" }],
    [
      `/api/players/${p.id}`,
      "PUT",
      { revision: p.revision, name: "forbidden" },
    ],
    ["/api/seasons", "POST", {}],
    ["/api/matches", "POST", {}],
    [
      `/api/matches/${away.id}`,
      "PUT",
      { revision: away.revision, status: "draft" },
    ],
    [
      `/api/matches/${away.id}/roster`,
      "PUT",
      { revision: away.revision, roster: [] },
    ],
    ["/api/tactics", "POST", { tactic: originalTactic }],
  ])
    await call(qCookie, path, method, body, 403);
  // Future-team identity setup only: there is intentionally no multi-team signup UI.
  const fixtureDb = new DatabaseSync(databasePath);
  fixtureDb.exec("INSERT INTO club_teams(id,name) VALUES(2,'另一虚构成年队')");
  fixtureDb
    .prepare(
      "INSERT INTO club_users(team_id,username,password_hash,role) SELECT 2,'foreign-admin',password_hash,'admin' FROM club_users WHERE username=?",
    )
    .run(credentials.username);
  fixtureDb.close();
  const foreignCookie = await login({
    username: "foreign-admin",
    password: credentials.password,
  });
  const F = async (path, method = "GET", body, expected = 200) =>
    (await call(foreignCookie, path, method, body, expected)).body;
  eq(await F("/api/players"), [], "foreign team no player leak");
  eq(await F("/api/matches"), [], "foreign team no match leak");
  eq(await F("/api/seasons"), [], "foreign team no season leak");
  const foreignPlayer = await F(
    "/api/players",
    "POST",
    { name: "外队虚构甲" },
    201,
  );
  const foreignSeason = await F(
    "/api/seasons",
    "POST",
    { name: "外队赛季", startDate: "2026-01-01", endDate: "2027-12-31" },
    201,
  );
  const foreignMatch = await F(
    "/api/matches",
    "POST",
    {
      opponent: "外队对手",
      date: "2027-01-01",
      status: "completed",
      homeScore: 90,
      awayScore: 0,
    },
    201,
  );
  for (const path of [
    `/api/players/${p.id}`,
    `/api/matches/${away.id}`,
    `/api/seasons/${s.id}/roster`,
    `/api/statistics?seasonId=${s.id}`,
  ])
    await F(path, "GET", undefined, 404);
  await F("/api/tactics", "GET", undefined, 403);
  await F("/api/coaching-desk", "GET", undefined, 403);
  await F(
    `/api/matches/${away.id}`,
    "PUT",
    { revision: away.revision, location: "foreign" },
    404,
  );
  await F(
    `/api/matches/${foreignMatch.id}`,
    "PUT",
    { revision: foreignMatch.revision, seasonId: s.id },
    404,
  );
  await F(
    `/api/matches/${foreignMatch.id}/roster`,
    "PUT",
    { revision: foreignMatch.revision, roster: [{ playerId: p.id }] },
    404,
  );
  await A(
    `/api/matches/${away.id}`,
    "PUT",
    { revision: away.revision, seasonId: foreignSeason.id },
    404,
  );
  await A(
    `/api/matches/${away.id}/roster`,
    "PUT",
    { revision: away.revision, roster: [{ playerId: foreignPlayer.id }] },
    404,
  );
  await A(
    `/api/seasons/${s.id}/roster`,
    "PUT",
    { revision: s.revision, roster: [{ playerId: foreignPlayer.id }] },
    404,
  );
  eq(
    await A(`/api/matches/${away.id}`),
    away,
    "foreign attempts leave original match identical",
  );
  eq(
    (await A("/api/statistics?year=2027")).team,
    y27.team,
    "foreign 90 goals never leak into original statistics",
  );

  phase("immutable history after template/profile/season edits and archival");
  const savedSnapshots = structuredClone(away.tacticSnapshots),
    savedRoster = structuredClone(away.roster);
  tactic = await A(`/api/tactics/${tactic.tacticId}`, "PUT", {
    tactic: {
      ...originalTactic,
      title: "后来模板",
      formationName: "2-3-1",
      board: {
        pieces: [],
        markings: [],
        trainingPlan: { instructions: "后来指示" },
      },
      thumbnail: png,
    },
  });
  for (let i = 0; i < 51; i++)
    await A(
      `/api/tactics/${tactic.tacticId}/versions`,
      "POST",
      { note: `虚构版本${i}`, board: { pieces: [], markings: [] } },
      201,
    );
  eq(
    (await A(`/api/tactics/${tactic.tacticId}/versions`)).length,
    50,
    "old version pruning exercised",
  );
  p = await A(`/api/players/${p.id}`, "PUT", {
    revision: p.revision,
    name: "虚构甲更名",
    number: 77,
    status: "inactive",
  });
  await call(pCookie, "/api/auth/me", "GET", undefined, 401);
  await login(pc, 403);
  sr = await A(`/api/seasons/${s.id}/roster`, "PUT", {
    revision: s.revision,
    roster: [
      { playerId: p.id, number: 55 },
      { playerId: q.id, number: 0 },
    ],
  });
  s = sr.season;
  away = await A(`/api/matches/${away.id}`, "PUT", {
    revision: away.revision,
    analysis: "追加赛后总结",
    tacticSnapshots: [],
  });
  away = await A(`/api/matches/${away.id}/roster`, "PUT", {
    revision: away.revision,
    roster: away.roster.map((x) => ({
      ...x,
      playerSnapshot: { id: "forged", name: "forged", number: 999 },
      snapshotSource: "migration",
    })),
  });
  eq(
    away.roster,
    savedRoster,
    "same-row edits ignore forged snapshots and preserve historical identity",
  );
  eq(
    away.tacticSnapshots,
    savedSnapshots,
    "template versions and all ordinary edits preserve full snapshot",
  );
  await A(`/api/tactics/${tactic.tacticId}`, "DELETE", undefined, 204);
  await A(`/api/tactics/${tactic.tacticId}`, "GET", undefined, 404);
  away = await A(`/api/matches/${away.id}`, "PUT", {
    revision: away.revision,
    location: "删除模板后仍可编辑",
  });
  eq(
    away.tacticSnapshots,
    savedSnapshots,
    "template deletion leaves independent history",
  );
  eq(
    (await call(qCookie, `/api/matches/${away.id}`)).body.tacticSnapshots,
    savedSnapshots,
    "player sees saved history after template removal",
  );
  const listed = await A("/api/matches");
  check(
    listed.every((m) => !("tacticSnapshots" in m)),
    "lists omit heavyweight snapshots",
  );
  eq(
    listed.find((m) => m.id === away.id).tacticIds,
    [tactic.tacticId],
    "list retains historical association",
  );
  stats = await A(`/api/statistics?seasonId=${s.id}`);
  eq(
    stats.players.find((x) => x.playerId === p.id).goals,
    2,
    "archived player retains historical goals",
  );
  eq(
    away.roster.find((x) => x.playerId === p.id).playerSnapshot,
    { id: p.id, name: "虚构甲", number: 19, positions: ["中锋", "中场"] },
    "historical seasonal identity remains original",
  );
  await A(
    `/api/players/${q.id}`,
    "PUT",
    { revision: q.revision, avatar: "https://invalid.example/a.png" },
    400,
  );
  eq(
    (await A(`/api/players/${q.id}`)).avatar,
    null,
    "invalid avatar remains unchanged",
  );
  // Explicit removal/re-add intentionally captures new seasonal number, not accidental refresh.
  home = await A(`/api/matches/${home.id}/roster`, "PUT", {
    revision: home.revision,
    roster: home.roster.filter((x) => x.playerId !== p.id),
  });
  home = await A(`/api/matches/${home.id}/roster`, "PUT", {
    revision: home.revision,
    roster: [
      ...home.roster,
      { playerId: p.id, appeared: false, selection: "bench" },
    ],
  });
  eq(
    home.roster.find((x) => x.playerId === p.id).playerSnapshot.number,
    55,
    "explicit re-add recaptures new seasonal number",
  );
  eq(
    (await A(`/api/matches/${away.id}`)).roster,
    savedRoster,
    "other match remains unchanged",
  );
  integrity();

  phase("real backup command, restart, restore and full logical equivalence");
  const capture = async () => ({
    team: await A("/api/team"),
    players: await A("/api/players"),
    seasons: await A("/api/seasons"),
    seasonRoster: await A(`/api/seasons/${s.id}/roster`),
    tactics: await A("/api/tactics"),
    desk: await A("/api/coaching-desk"),
    matches: await A("/api/matches"),
    detail: await A(`/api/matches/${away.id}`),
    home: await A(`/api/matches/${home.id}`),
    seasonStats: await A(`/api/statistics?seasonId=${s.id}`),
    yearStats: await A("/api/statistics?year=2027"),
  });
  const beforeRestart = await capture();
  await stop();
  await start();
  eq(
    await capture(),
    beforeRestart,
    "restart leaves all captured API data exactly equivalent",
  );
  const backupPath = join(directory, "backup.sqlite");
  const backup = spawnSync(
    process.execPath,
    [join(root, "scripts/backup.mjs"), backupPath],
    {
      env: { ...process.env, FOOTBALL_DB_PATH: databasePath },
      encoding: "utf8",
      timeout: 20000,
    },
  );
  eq(backup.status, 0, "official backup command succeeds");
  eq(statSync(backupPath).mode & 0o777, 0o600, "backup private permissions");
  integrity(backupPath);
  eq(
    databaseDigest(databasePath),
    databaseDigest(backupPath),
    "all SQLite table schemas/rows identical at backup, including account/session data without disclosure",
  );
  const backupBefore = hash(readFileSync(backupPath));
  const duplicate = spawnSync(
    process.execPath,
    [join(root, "scripts/backup.mjs"), backupPath],
    {
      env: { ...process.env, FOOTBALL_DB_PATH: databasePath },
      encoding: "utf8",
      timeout: 20000,
    },
  );
  eq(duplicate.status, 1, "backup refuses existing destination");
  eq(
    hash(readFileSync(backupPath)),
    backupBefore,
    "failed backup never overwrites existing backup",
  );
  const originalPath = databasePath;
  const originalBefore = databaseDigest(originalPath, true);
  await stop();
  databasePath = join(directory, "restored.sqlite");
  copyFileSync(backupPath, databasePath);
  await start();
  eq(
    await capture(),
    beforeRestart,
    "restore API data exactly equivalent, including snapshots, RSVP, revisions and nulls",
  );
  eq(
    databaseDigest(databasePath, true),
    databaseDigest(originalPath, true),
    "restored business rows unchanged by startup migration",
  );
  admin = await login();
  eq(
    await capture(),
    beforeRestart,
    "restored administrator credentials work and do not change business values",
  );
  qCookie = await login(qc);
  eq(
    (await call(qCookie, `/api/matches/${away.id}`)).body.tacticSnapshots,
    savedSnapshots,
    "restored player credentials and history access",
  );
  await login(pc, 403);
  const restoredTeam = await A("/api/team");
  await A("/api/team", "PUT", {
    revision: restoredTeam.revision,
    name: "恢复副本独立变更",
  });
  eq(
    databaseDigest(originalPath, true),
    originalBefore,
    "restore writes never modify original database",
  );
  eq(
    hash(readFileSync(backupPath)),
    backupBefore,
    "restore writes never modify backup",
  );
  integrity();
  await stop();

  phase("legacy NOT NULL shirt-number migration on another isolated database");
  databasePath = join(directory, "fictional-legacy.sqlite");
  const legacy = openFootballStore(databasePath);
  const historical = {
    playerId: "audit-historical",
    name: "旧虚构成年球员",
    number: 8,
    positions: ["后卫"],
    preferredFoot: "左",
    status: "injured",
    note: "迁移保留",
    avatar: null,
    fieldPieceId: null,
  };
  legacy.saveDesk({
    edition: 0,
    desk: {
      board: { pieces: [], markings: [] },
      selectedTacticId: null,
      players: [historical],
    },
  });
  legacy.database
    .exec(`BEGIN IMMEDIATE; ALTER TABLE team_players RENAME TO prior_nullable;
    CREATE TABLE team_players (player_id TEXT PRIMARY KEY,desk_id INTEGER NOT NULL REFERENCES coaching_desks(desk_id) ON DELETE CASCADE,
    team_order INTEGER NOT NULL,name TEXT NOT NULL,shirt_number INTEGER NOT NULL,position TEXT NOT NULL,preferred_foot TEXT NOT NULL,
    availability TEXT NOT NULL,note TEXT NOT NULL,portrait TEXT,field_piece_id TEXT) STRICT;
    INSERT INTO team_players SELECT * FROM prior_nullable; DROP TABLE prior_nullable; COMMIT;`);
  legacy.close();
  await start();
  admin = await login();
  eq(
    (await A("/api/coaching-desk")).desk.players,
    [historical],
    "legacy migration preserves all historical roster fields",
  );
  const historicProfile = await A("/api/players/audit-historical");
  await A("/api/players/audit-historical", "PUT", {
    revision: historicProfile.revision,
    number: null,
  });
  eq(
    (await A("/api/coaching-desk")).desk.players,
    [{ ...historical, number: null }],
    "legacy unknown number no zero or injury reset",
  );
  await stop();
  await start();
  eq(
    (await A("/api/coaching-desk")).desk.players,
    [{ ...historical, number: null }],
    "legacy unknown survives second restart",
  );
  inspect((db) =>
    eq(
      db.prepare("SELECT shirt_number FROM team_players").get().shirt_number,
      null,
      "legacy SQL NULL preserved",
    ),
  );
  integrity();
  eq(
    sourceHashes(),
    beforeHashes,
    "three business source files unchanged throughout audit",
  );
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        assertions: count,
        seconds: Math.round((Date.now() - started) / 1000),
        sourceHashes: beforeHashes,
        scope:
          "fresh fictional loopback HTTP/SQLite, no production or desktop demo data, no browser/mobile/print claim",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`FAIL ${stage}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await stop();
  rmSync(directory, { recursive: true, force: true });
}
