import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createFootballServer } from "../../server/index.mjs";
import { createTestDatabase, removeTestDatabase, resetClubTestData } from "./test-database.mjs";

const credentials = { username: "testadmin", password: "test-password-123" };

test("temporary fixture cleanup isolates club entities and preserves real administrator authentication", async (t) => {
  const databasePath = createTestDatabase();
  const server = createFootballServer({ databasePath, bootstrapAdmin: credentials });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
    removeTestDatabase(databasePath);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  async function request(path, method = "GET", body = undefined) {
    const response = await fetch(origin + path, {
      method,
      headers: { Origin: origin, "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response;
  }
  async function login() {
    const response = await request("/api/auth/login", "POST", credentials);
    assert.equal(response.status, 200);
    cookie = response.headers.get("set-cookie").split(";")[0];
  }
  await login();
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys=ON;
    UPDATE club_teams SET name='Previous team',crest='previous-crest',revision=8 WHERE id=1;
    INSERT INTO club_players(id,team_id,name,positions) VALUES ('dirty-player',1,'Previous test','["中场"]');
    INSERT INTO club_users(team_id,username,password_hash,role,player_id) VALUES (1,'previous-player','unused','player','dirty-player');
    INSERT INTO club_sessions(token_hash,user_id,expires_at) SELECT 'previous-player-token',id,9999999999999 FROM club_users WHERE role='player';
    INSERT INTO club_matches(id,team_id,opponent,match_date,status) VALUES (1,1,'Previous opponent','2027-01-01','published');
    INSERT INTO club_rsvps VALUES (1,1,'dirty-player','yes');
    INSERT INTO club_roster VALUES (1,1,'dirty-player','中场',1,0,NULL);
    INSERT INTO club_seasons(team_id,name,start_date,end_date) VALUES (1,'Previous season','2026-08-01','2027-07-31');
  `);
  database.close();
  const tacticResponse = await request("/api/tactics", "POST", {
    tactic: {
      title: "Previous tactic",
      tags: [],
      favorite: false,
      formationName: "",
      board: { pieces: [], markings: [] },
      thumbnail: null,
    },
    note: "",
  });
  assert.equal(tacticResponse.status, 201);
  const tactic = await tacticResponse.json();
  const linked = new DatabaseSync(databasePath);
  linked.prepare("INSERT INTO club_match_tactics VALUES (1,?)").run(tactic.tacticId);
  linked.close();
  assert.equal((await (await request("/api/players")).json()).length, 1);

  await resetClubTestData(databasePath);
  assert.equal((await request("/api/players")).status, 401, "previous admin session is invalidated too");
  await login();
  assert.deepEqual(await (await request("/api/team")).json(), { id: 1, name: "我的球队", crest: null, revision: 1 });
  await Promise.all(
    ["/api/players", "/api/matches", "/api/seasons"].map(async (path) => {
      assert.deepEqual(await (await request(path)).json(), []);
    })
  );
  assert.equal((await request(`/api/tactics/${tactic.tacticId}`, "DELETE")).status, 204);
  const { edition } = await (await request("/api/coaching-desk")).json();
  assert.equal((await request("/api/coaching-desk", "PUT", { desk: null, edition })).status, 200);
  const state = await (await request("/api/coaching-desk")).json();
  const players = Array.from({ length: 20 }, (_, index) => ({
    playerId: `bg-${index + 1}`,
    name: `Fixture player ${index + 1}`,
    number: index + 1,
    positions: ["中场"],
    preferredFoot: "",
    status: "ok",
    note: "",
    avatar: null,
    fieldPieceId: null,
  }));
  const seeded = await request("/api/coaching-desk", "PUT", {
    edition: state.edition,
    desk: { board: { pieces: [], markings: [] }, players, selectedTacticId: null },
  });
  assert.equal(seeded.status, 200);
  assert.equal(
    (await (await request("/api/players")).json()).length,
    20,
    "next tactical fixture has no inherited extra players"
  );
  const checked = new DatabaseSync(databasePath);
  try {
    assert.deepEqual(checked.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(checked.prepare("SELECT count(*) AS n FROM club_users WHERE role='player'").get().n, 0);
    assert.equal(checked.prepare("SELECT count(*) AS n FROM club_users WHERE role='admin'").get().n, 1);
    ["club_match_tactics", "club_rsvps", "club_roster", "club_matches", "club_seasons"].forEach((table) => {
      assert.equal(checked.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    });
  } finally {
    checked.close();
  }
});

test("cleanup refuses non-test paths, missing ownership markers and symlinked databases", async () => {
  await assert.rejects(() => resetClubTestData(undefined));
  await assert.rejects(() => resetClubTestData(join(process.cwd(), "data", "football.sqlite")));
  const unowned = mkdtempSync(join(tmpdir(), "football-playwright-"));
  const owned = createTestDatabase();
  const sentinel = join(unowned, "production.sqlite");
  writeFileSync(sentinel, "DO NOT ALTER");
  try {
    await assert.rejects(() => resetClubTestData(join(unowned, "test.sqlite")));
    symlinkSync(sentinel, owned);
    await assert.rejects(() => resetClubTestData(owned), /non-regular/);
    assert.equal(readFileSync(sentinel, "utf8"), "DO NOT ALTER");
    unlinkSync(owned);
  } finally {
    removeTestDatabase(owned);
    rmSync(unowned, { recursive: true, force: true });
  }
});

test("cleanup yields to a concurrent HTTP writer and leaves no transaction open", async (t) => {
  const { createServer } = await import("node:http");
  const { setTimeout: delay } = await import("node:timers/promises");
  const databasePath = createTestDatabase();
  const initializer = createFootballServer({ databasePath, bootstrapAdmin: credentials });
  initializer.listen(0, "127.0.0.1");
  await once(initializer, "listening");
  await new Promise((resolve) => {
    initializer.close(resolve);
  });
  const writer = new DatabaseSync(databasePath);
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const server = createServer(async (_request, response) => {
    writer.exec("BEGIN IMMEDIATE");
    writer.exec("INSERT INTO club_players(id,team_id,name,positions) VALUES ('inflight',1,'In-flight request','[]')");
    signalStarted();
    await delay(100);
    writer.exec("COMMIT");
    response.end("committed");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
    writer.close();
    removeTestDatabase(databasePath);
  });
  const pendingRequest = fetch(`http://127.0.0.1:${server.address().port}/save`);
  await started;
  await resetClubTestData(databasePath);
  assert.equal(await (await pendingRequest).text(), "committed");
  assert.equal(writer.isTransaction, false);
  assert.equal(writer.prepare("SELECT count(*) AS n FROM club_players").get().n, 0);
  writer.exec("BEGIN IMMEDIATE; COMMIT;");
  assert.equal(writer.isTransaction, false, "cleanup released its own connection and write transaction");

  writer.exec("BEGIN IMMEDIATE");
  try {
    await assert.rejects(resetClubTestData(databasePath, { timeoutMs: 100 }), /stayed locked/);
  } finally {
    writer.exec("ROLLBACK");
  }
  await resetClubTestData(databasePath);
  assert.equal(writer.isTransaction, false);
});
