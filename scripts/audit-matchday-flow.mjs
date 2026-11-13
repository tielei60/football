/** Repeatable matchday HTTP/SQLite acceptance. Fictional data, owned temporary files only.
 * Run with Node >=22.13: node scripts/audit-matchday-flow.mjs
 * No production paths, saved secrets, external services or browser claims.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { deflateSync } from "node:zlib";
import { createFootballServer } from "../server/index.mjs";
import { openFootballStore } from "../server/football-store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(tmpdir(), "football-matchday-audit-"));
let databasePath = join(directory, "fictional.sqlite"),
  server,
  origin;
let assertions = 0,
  phase = "setup";
const credentials = { username: "matchday-audit", password: randomUUID() };
function eq(actual, expected, label) {
  assertions++;
  assert.deepEqual(actual, expected, `${phase}: ${label}`);
}
function check(value, label) {
  eq(Boolean(value), true, label);
}
function stage(name) {
  phase = name;
  console.log(`CHECK ${name}`);
}
const digest = (data) => createHash("sha256").update(data).digest("hex");
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}
function png(red, green, blue) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0, red, green, blue]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const purple = png(136, 69, 160),
  blue = png(162, 217, 247);
const dataUrl = (b) => `data:image/png;base64,${b.toString("base64")}`;
async function start() {
  server = createFootballServer({
    databasePath,
    bootstrapAdmin: credentials,
    publicOrigin: null,
    secureCookies: false,
    trustedProxyAddresses: [],
    staticDirectory: join(directory, "no-static"),
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
async function request(
  cookie,
  path,
  method = "GET",
  body,
  expected = 200,
  binary = false,
) {
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
  eq(response.status, expected, `${method} ${path} status`);
  const value = binary
    ? Buffer.from(await response.arrayBuffer())
    : response.status === 204
      ? null
      : await response.json();
  return {
    value,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
    headers: response.headers,
  };
}
async function login(account = credentials) {
  return (await request(null, "/api/auth/login", "POST", account)).cookie;
}
function databaseDigest(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    eq(
      db.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
      "database integrity",
    );
    eq(
      db.prepare("PRAGMA foreign_key_check").all(),
      [],
      "foreign key integrity",
    );
    return digest(
      JSON.stringify(
        db
          .prepare(
            "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name",
          )
          .all()
          .map((t) => [
            t.name,
            t.sql,
            db
              .prepare(`SELECT * FROM "${t.name.replaceAll('"', '""')}"`)
              .all()
              .map((r) => JSON.stringify(r))
              .sort(),
          ]),
      ),
    );
  } finally {
    db.close();
  }
}
try {
  await start();
  let admin = await login();
  const A = async (path, method = "GET", body, status = 200) =>
    (await request(admin, path, method, body, status)).value;
  stage("venue creation, validation, revision and team permissions");
  await request(null, "/api/venues", "GET", undefined, 401);
  eq(await A("/api/venues"), [], "fresh venue list empty");
  let venue = await A(
    "/api/venues",
    "POST",
    {
      name: "  星河公共球场（虚构）  ",
      address: "虚构路 8 号",
      latitude: 31.23,
      longitude: 121.47,
      note: "南门集合",
      status: "active",
    },
    201,
  );
  eq(venue.name, "星河公共球场（虚构）", "venue name trimmed");
  eq(
    [venue.latitude, venue.longitude],
    [31.23, 121.47],
    "WGS84 coordinates preserved",
  );
  for (const invalid of [
    { latitude: 91, longitude: 1 },
    { latitude: 1, longitude: -181 },
    { latitude: 1, longitude: null },
    { latitude: "31.23", longitude: 121.47 },
  ]) {
    await A(`/api/venues/${venue.id}`, "PUT", { ...venue, ...invalid }, 400);
  }
  await A(`/api/venues/${venue.id}`, "PUT", { name: "missing revision" }, 428);
  const oldVenue = structuredClone(venue);
  venue = await A(`/api/venues/${venue.id}`, "PUT", {
    ...venue,
    note: "更衣室旁集合",
  });
  await A(
    `/api/venues/${venue.id}`,
    "PUT",
    { ...oldVenue, name: "stale change" },
    409,
  );
  eq(
    (await A("/api/venues")).find((v) => v.id === venue.id),
    venue,
    "failed updates leave venue unchanged",
  );
  let player = await A(
    "/api/players",
    "POST",
    {
      name: "星河虚构成年球员",
      positions: ["中场"],
      number: 9,
      avatar: dataUrl(purple),
    },
    201,
  );
  const playerAccount = { username: "matchday-player", password: randomUUID() };
  await A(`/api/players/${player.id}/account`, "POST", playerAccount, 201);
  const playerCookie = await login(playerAccount);
  const P = async (path, method = "GET", body, status = 200) =>
    (await request(playerCookie, path, method, body, status)).value;
  check(
    (await P("/api/venues")).some((v) => v.id === venue.id),
    "same-team player can read venues",
  );
  await P("/api/venues", "POST", { name: "forbidden" }, 403);
  await P(`/api/venues/${venue.id}`, "PUT", venue, 403);
  const fixture = new DatabaseSync(databasePath);
  fixture.exec("INSERT INTO club_teams(id,name) VALUES(2,'另一虚构队')");
  fixture
    .prepare(
      "INSERT INTO club_users(team_id,username,password_hash,role) SELECT 2,'matchday-foreign',password_hash,'admin' FROM club_users WHERE username=?",
    )
    .run(credentials.username);
  fixture.close();
  const foreignCookie = await login({
    username: "matchday-foreign",
    password: credentials.password,
  });
  const F = async (path, method = "GET", body, status = 200) =>
    (await request(foreignCookie, path, method, body, status)).value;
  eq(await F("/api/venues"), [], "foreign team list isolated");
  await F(`/api/venues/${venue.id}`, "PUT", venue, 404);

  stage(
    "cross-year schedule, notice, venue snapshot and unknown legacy fields",
  );
  const season = await A(
    "/api/seasons",
    "POST",
    {
      name: "2091–2092 虚构跨年季",
      startDate: "2091-08-01",
      endDate: "2092-07-31",
    },
    201,
  );
  let match = await A(
    "/api/matches",
    "POST",
    {
      opponent: "虚构北岸队",
      date: "2091-12-31",
      kickoff: "23:30",
      durationMinutes: 90,
      seasonId: season.id,
      venueId: venue.id,
      notice: "请提前 15 分钟到场。\n<script>not executable</script>",
    },
    201,
  );
  eq(
    [match.date, match.kickoff, match.durationMinutes],
    ["2091-12-31", "23:30", 90],
    "schedule wall-clock fields preserved",
  );
  eq(
    match.notice,
    "请提前 15 分钟到场。\n<script>not executable</script>",
    "notice stored as plain text without false legal consent",
  );
  eq(match.venueSnapshot.name, venue.name, "venue name captured");
  const snapshot = structuredClone(match.venueSnapshot);
  const legacy = await A(
    "/api/matches",
    "POST",
    {
      opponent: "旧式未知信息",
      date: "2092-01-01",
      location: "历史自由文字地点",
    },
    201,
  );
  eq(
    [
      legacy.kickoff,
      legacy.durationMinutes,
      legacy.venueId,
      legacy.venueSnapshot,
    ],
    ["", null, null, null],
    "old clients retain unknown values",
  );
  for (const durationMinutes of [0, -1, 1.5, 1441, "90"])
    await A(
      `/api/matches/${match.id}`,
      "PUT",
      { revision: match.revision, durationMinutes },
      400,
    );
  await A(
    `/api/matches/${match.id}`,
    "PUT",
    { revision: match.revision, notice: "x".repeat(10001) },
    400,
  );
  await F(
    "/api/matches",
    "POST",
    { opponent: "forged venue", date: "2091-12-31", venueId: venue.id },
    404,
  );
  await P(`/api/matches/${match.id}`, "GET", undefined, 404);

  stage("ordered secure album, cover, stale updates and image access");
  match = await A(`/api/matches/${match.id}/photos`, "PUT", {
    revision: match.revision,
    photos: [
      { data: dataUrl(purple), caption: "赛前合影（虚构色块）" },
      { data: dataUrl(blue), caption: "赛后合影（虚构色块）" },
    ],
    coverIndex: 1,
  });
  eq(match.photoCount, 2, "two photos saved");
  eq(match.coverPhotoId, match.photos[1].id, "second photo is cover");
  const purpleId = match.photos[0].id,
    blueId = match.photos[1].id;
  const photoUrl = match.photos[0].url;
  const fetched = await request(admin, photoUrl, "GET", undefined, 200, true);
  eq(digest(fetched.value), digest(purple), "photo byte-for-byte exact");
  eq(
    fetched.headers.get("content-type").split(";")[0],
    "image/png",
    "photo MIME fixed",
  );
  eq(fetched.headers.get("x-content-type-options"), "nosniff", "photo nosniff");
  check(
    fetched.headers.get("cache-control").includes("no-store"),
    "photo private/no-store",
  );
  await request(null, photoUrl, "GET", undefined, 401);
  await P(photoUrl, "GET", undefined, 404);
  await F(photoUrl, "GET", undefined, 404);
  const summaries = await A("/api/matches");
  const summary = summaries.find((m) => m.id === match.id);
  eq(summary.photos, undefined, "list omits image payload and full album");
  eq(summary.coverPhotoUrl, match.coverPhotoUrl, "list exposes cover URL only");
  const preserved = structuredClone(match);
  await A(
    `/api/matches/${legacy.id}/photos/${purpleId}`,
    "GET",
    undefined,
    404,
  );
  for (const coverIndex of [-1, 2, 0.5])
    await A(
      `/api/matches/${match.id}/photos`,
      "PUT",
      {
        revision: match.revision,
        photos: match.photos.map((p) => ({ id: p.id })),
        coverIndex,
      },
      400,
    );
  const noisyHeader = Buffer.alloc(13);
  noisyHeader.writeUInt32BE(780, 0);
  noisyHeader.writeUInt32BE(780, 4);
  noisyHeader[8] = 8;
  noisyHeader[9] = 2;
  const noisyPixels = Buffer.concat(
    Array.from({ length: 780 }, () =>
      Buffer.concat([Buffer.from([0]), randomBytes(780 * 3)]),
    ),
  );
  const largeValidPng = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", noisyHeader),
    chunk("IDAT", deflateSync(noisyPixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  check(
    largeValidPng.length < 2 * 1024 * 1024 &&
      largeValidPng.length * 10 > 16 * 1024 * 1024,
    "capacity fixture is ten valid individually allowed PNGs",
  );
  await A(
    `/api/matches/${match.id}/photos`,
    "PUT",
    {
      revision: match.revision,
      photos: Array.from({ length: 10 }, () => ({
        data: dataUrl(largeValidPng),
      })),
    },
    413,
  );

  await A(
    `/api/matches/${match.id}/photos`,
    "PUT",
    { revision: match.revision - 1, photos: [] },
    409,
  );
  await A(`/api/matches/${match.id}/photos`, "PUT", { photos: [] }, 428);
  for (const data of [
    "https://invalid.example/image.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,YmFk",
    "data:image/png;base64," +
      Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64"),
  ]) {
    await A(
      `/api/matches/${match.id}/photos`,
      "PUT",
      { revision: match.revision, photos: [{ data }] },
      400,
    );
  }
  await A(
    `/api/matches/${match.id}/photos`,
    "PUT",
    {
      revision: match.revision,
      photos: Array.from({ length: 11 }, () => ({ data: dataUrl(purple) })),
    },
    400,
  );
  await A(
    `/api/matches/${match.id}/photos`,
    "PUT",
    {
      revision: match.revision,
      photos: [{ id: randomUUID(), caption: "foreign/unknown" }],
    },
    400,
  );
  eq(
    await A(`/api/matches/${match.id}`),
    preserved,
    "every rejected album write leaves match, revision and bytes unchanged",
  );
  match = await A(`/api/matches/${match.id}/photos`, "PUT", {
    revision: match.revision,
    photos: [
      { id: blueId, caption: "封面移到前方" },
      { id: purpleId, caption: "原图保留" },
    ],
    coverIndex: 0,
  });
  eq(
    match.photos.map((p) => p.id),
    [blueId, purpleId],
    "reorder preserves image identities",
  );
  eq(match.coverPhotoId, blueId, "cover preserved after reorder");
  match = await A(`/api/matches/${match.id}`, "PUT", {
    revision: match.revision,
    status: "published",
  });
  eq(
    digest(
      (await request(playerCookie, photoUrl, "GET", undefined, 200, true))
        .value,
    ),
    digest(purple),
    "published photo visible to player",
  );
  await P(
    `/api/matches/${match.id}/photos`,
    "PUT",
    { revision: match.revision, photos: [] },
    403,
  );

  stage(
    "RSVP cycles are per-match choices, not click counts; withdrawal restores unanswered",
  );
  for (const response of ["yes", "yes", "no", "maybe", null]) {
    const changed = await P(`/api/matches/${match.id}/rsvp`, "PUT", {
      response,
    });
    eq(
      changed.rsvps.length,
      response === null ? 0 : 1,
      "one current RSVP or none",
    );
    eq(
      changed.revision,
      match.revision,
      "RSVP does not overwrite admin revision",
    );
    const stats = await P(`/api/statistics?seasonId=${season.id}`);
    const registration = stats.players.find(
      (p) => p.playerId === player.id,
    ).registration;
    eq(
      registration,
      {
        yes: +(response === "yes"),
        no: +(response === "no"),
        maybe: +(response === "maybe"),
        unanswered: +(response === null),
      },
      "distinct three states and unanswered",
    );
  }
  await P(`/api/matches/${match.id}/rsvp`, "PUT", { response: "yes" });
  venue = await A(`/api/venues/${venue.id}`, "PUT", {
    ...venue,
    name: "后来修改的场地",
    latitude: 32,
    longitude: 120,
    status: "archived",
  });
  match = await A(`/api/matches/${match.id}`, "PUT", {
    revision: match.revision,
    analysis: "赛前计划更新",
  });
  eq(
    match.venueSnapshot,
    snapshot,
    "editing/archiving venue and saving unrelated metadata never refreshes history",
  );
  await A(
    "/api/matches",
    "POST",
    { opponent: "archived venue", date: "2092-01-01", venueId: venue.id },
    400,
  );
  match = await A(`/api/matches/${match.id}`, "PUT", {
    revision: match.revision,
    status: "completed",
    homeScore: 1,
    awayScore: 0,
  });
  match = await A(`/api/matches/${match.id}/roster`, "PUT", {
    revision: match.revision,
    roster: [
      {
        playerId: player.id,
        selection: "starter",
        position: "中场",
        appeared: true,
        goals: 1,
        assists: null,
      },
    ],
  });
  await P(`/api/matches/${match.id}/rsvp`, "PUT", { response: null }, 409);
  const stats = await A(`/api/statistics?seasonId=${season.id}`);
  eq(
    [
      stats.team.wins,
      stats.team.goalsFor,
      stats.players.find((p) => p.playerId === player.id).assists,
    ],
    [1, 1, null],
    "result and unknown assists unaffected by added features",
  );
  match = await A(`/api/matches/${match.id}/photos`, "PUT", {
    revision: match.revision,
    photos: [{ id: blueId, caption: "保留封面" }],
    coverIndex: 0,
  });
  await A(photoUrl, "GET", undefined, 404);
  eq(match.photoCount, 1, "remove photo updates metadata");

  stage(
    "restart and real SQLite backup/restore include album bytes and venue history",
  );
  const beforeRestart = structuredClone(match);
  await stop();
  await start();
  admin = await login();
  eq(
    await A(`/api/matches/${match.id}`),
    beforeRestart,
    "restart preserves match and album metadata",
  );
  const backupPath = join(directory, "backup.sqlite");
  const backup = spawnSync(
    process.execPath,
    [join(root, "scripts/backup.mjs"), backupPath],
    {
      env: { ...process.env, FOOTBALL_DB_PATH: databasePath },
      encoding: "utf8",
    },
  );
  eq(backup.status, 0, "official backup succeeds");
  eq(
    databaseDigest(backupPath),
    databaseDigest(databasePath),
    "all backup tables and blobs match live database",
  );
  const backupHash = digest(readFileSync(backupPath));
  await stop();
  databasePath = join(directory, "restored.sqlite");
  copyFileSync(backupPath, databasePath);
  await start();
  admin = await login();
  eq(
    await A(`/api/matches/${match.id}`),
    beforeRestart,
    "restored match exact",
  );
  eq(
    digest(
      (await request(admin, match.coverPhotoUrl, "GET", undefined, 200, true))
        .value,
    ),
    digest(blue),
    "restored photo bytes exact",
  );
  eq(
    digest(readFileSync(backupPath)),
    backupHash,
    "restore never changes original backup",
  );
  databaseDigest(databasePath);
  stage("legacy schema migrates without inventing venue, duration or photos");
  await stop();
  databasePath = join(directory, "legacy-v1.sqlite");
  const legacyStore = openFootballStore(databasePath);
  legacyStore.close();
  const oldDatabase = new DatabaseSync(databasePath);
  oldDatabase.exec(`
    CREATE TABLE club_teams (id INTEGER PRIMARY KEY,name TEXT NOT NULL) STRICT;
    INSERT INTO club_teams VALUES(1,'旧虚构球队');
    CREATE TABLE club_matches (
      id INTEGER PRIMARY KEY,team_id INTEGER NOT NULL REFERENCES club_teams(id),opponent TEXT NOT NULL,
      match_date TEXT NOT NULL,kickoff TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','completed','cancelled')),
      home_score INTEGER,away_score INTEGER,analysis TEXT NOT NULL DEFAULT '',UNIQUE(team_id,id)
    ) STRICT;
    INSERT INTO club_matches VALUES(1,1,'旧虚构对手','2027-02-07','','旧手写球场','completed',NULL,0,'旧分析');
  `);
  oldDatabase.close();
  await start();
  admin = await login();
  const migrated = await A("/api/matches/1");
  eq(
    [
      migrated.location,
      migrated.kickoff,
      migrated.homeScore,
      migrated.awayScore,
      migrated.analysis,
    ],
    ["旧手写球场", "", null, 0, "旧分析"],
    "legacy values preserved",
  );
  eq(
    [
      migrated.venueId,
      migrated.venueSnapshot,
      migrated.durationMinutes,
      migrated.notice,
      migrated.photoCount,
      migrated.photos,
    ],
    [null, null, null, "", 0, []],
    "migration leaves absent features unknown/empty",
  );
  await stop();
  await start();
  admin = await login();
  eq(await A("/api/matches/1"), migrated, "migration restart idempotent");
  databaseDigest(databasePath);
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        assertions,
        scope:
          "isolated fictional loopback HTTP/SQLite; no browser, external map, production or real-person claims",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`FAIL ${phase}: ${error.message}`);
  process.exitCode = 1;
} finally {
  await stop();
  rmSync(directory, { recursive: true, force: true });
}
