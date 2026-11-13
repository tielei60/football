import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const adminCredentials = {
  username: "testadmin",
  password: "test-password-123",
};

async function login(origin) {
  const response = await fetch(origin + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(adminCredentials),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

const board = {
  pieces: [{ pieceId: "player-1", x: 50, y: 100 }],
  markings: [],
  trainingPlan: { focus: "Press" },
};
const tactic = {
  title: "High press",
  tags: ["press"],
  favorite: false,
  formationName: "3-3-1",
  board,
  thumbnail: null,
};
const player = {
  playerId: "p1",
  name: "Alex",
  number: 9,
  positions: ["前锋"],
  preferredFoot: "Right",
  status: "ok",
  note: "",
  avatar: "/alex.png",
  fieldPieceId: "player-1",
};

async function fixture(t, options = {}) {
  const { createFootballServer } = await import("./index.mjs");
  const directory = await mkdtemp(join(tmpdir(), "football-"));
  const databasePath = join(directory, "football.sqlite");
  let server;
  let origin;
  let cookie;
  async function start() {
    server = createFootballServer({
      databasePath,
      bootstrapAdmin: adminCredentials,
      ...options,
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
    cookie = await login(origin);
  }
  async function close() {
    if (server?.listening)
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }
  t.after(async () => {
    await close();
    await rm(directory, { recursive: true, force: true });
  });
  await start();
  return {
    databasePath,
    directory,
    close,
    start,
    async request(path, method = "GET", body) {
      const response = await fetch(origin + path, {
        method,
        headers: {
          cookie,
          origin,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) : null,
        headers: response.headers,
      };
    },
    get cookie() {
      return cookie;
    },
    get origin() {
      return origin;
    },
  };
}

test("tactics and desk roster survive closing and reopening the SQLite database", async (t) => {
  const app = await fixture(t);
  const saved = await app.request("/api/tactics", "POST", {
    tactic,
    note: "First practice",
  });
  assert.equal(saved.status, 201);
  assert.ok(saved.body.tacticId > 0);
  const desk = {
    board,
    players: [player],
    selectedTacticId: saved.body.tacticId,
  };
  assert.equal(
    (await app.request("/api/coaching-desk", "PUT", { desk, edition: 0 }))
      .status,
    200,
  );
  await app.close();
  const database = new DatabaseSync(app.databasePath);
  assert.equal(
    database.prepare("SELECT name FROM team_players").get().name,
    "Alex",
  );
  assert.equal(
    database.prepare("PRAGMA journal_mode").get().journal_mode,
    "wal",
  );
  database.close();
  await app.start();
  assert.deepEqual(
    (await app.request(`/api/tactics/${saved.body.tacticId}`)).body,
    saved.body,
  );
  assert.deepEqual((await app.request("/api/coaching-desk")).body.desk, desk);
  assert.equal(
    (await app.request(`/api/tactics/${saved.body.tacticId}/versions`)).body[0]
      .note,
    "First practice",
  );
});

test("saving tactics creates versions atomically and keeps the latest fifty", async (t) => {
  const app = await fixture(t);
  const saved = (
    await app.request("/api/tactics", "POST", { tactic, note: "First" })
  ).body;
  for (let index = 0; index < 51; index++) {
    assert.equal(
      (
        await app.request(`/api/tactics/${saved.tacticId}`, "PUT", {
          tactic: { ...tactic, title: `Practice ${index}` },
          note: `Save ${index}`,
        })
      ).status,
      200,
    );
  }
  const versions = (
    await app.request(`/api/tactics/${saved.tacticId}/versions`)
  ).body;
  assert.equal(versions.length, 50);
  assert.equal(versions[0].note, "Save 50");
  assert.equal(versions[49].note, "Save 1");
  assert.equal(
    (
      await app.request(`/api/tactics/${saved.tacticId}`, "PUT", {
        tactic: { ...tactic, board: { pieces: [] } },
        note: "Invalid",
      })
    ).status,
    400,
  );
  assert.equal(
    (await app.request(`/api/tactics/${saved.tacticId}`)).body.title,
    "Practice 50",
  );
  assert.deepEqual(
    (await app.request(`/api/tactics/${saved.tacticId}/versions`)).body,
    versions,
  );
  assert.equal(
    (
      await app.request(`/api/tactics/${saved.tacticId}`, "PATCH", {
        favorite: true,
      })
    ).body.favorite,
    true,
  );
  assert.equal(
    (await app.request(`/api/tactics/${saved.tacticId}/versions`)).body.length,
    50,
  );
  assert.equal(
    (await app.request(`/api/tactics/${saved.tacticId}`, "DELETE")).status,
    204,
  );
  await app.close();
  const database = new DatabaseSync(app.databasePath);
  assert.equal(
    database.prepare("SELECT count(*) AS total FROM tactic_versions").get()
      .total,
    0,
  );
  database.close();
});

test("stale desk edits and invalid players never replace the saved board or roster", async (t) => {
  const app = await fixture(t);
  assert.deepEqual((await app.request("/api/coaching-desk")).body, {
    desk: null,
    edition: 0,
    savedAt: null,
    initialPlayers: [],
  });
  const desk = { board, players: [player], selectedTacticId: null };
  const saved = await app.request("/api/coaching-desk", "PUT", {
    desk,
    edition: 0,
  });
  assert.equal(saved.body.edition, 1);
  const changed = { ...desk, board: { pieces: [], markings: [] }, players: [] };
  assert.equal(
    (
      await app.request("/api/coaching-desk", "PUT", {
        desk: changed,
        edition: 0,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await app.request("/api/coaching-desk", "PUT", {
        desk: { ...changed, players: [player, player] },
        edition: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await app.request("/api/coaching-desk", "PUT", {
        desk: { ...changed, players: [{ ...player, status: "unrecognized" }] },
        edition: 1,
      })
    ).status,
    400,
  );
  assert.deepEqual((await app.request("/api/coaching-desk")).body, saved.body);
  const cleared = await app.request("/api/coaching-desk", "PUT", {
    desk: null,
    edition: 1,
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.desk, null);
  assert.equal(cleared.body.edition, 2);
  assert.equal(
    (await app.request("/api/coaching-desk", "PUT", { desk, edition: 1 }))
      .status,
    409,
  );
});

test("player positions support multiple enumerated values and survive reopening the database", async (t) => {
  const app = await fixture(t);
  const multiPositionPlayer = {
    ...player,
    positions: ["中后卫", "后腰"],
  };
  delete multiPositionPlayer.position;
  const desk = {
    board,
    players: [multiPositionPlayer],
    selectedTacticId: null,
  };
  const saved = await app.request("/api/coaching-desk", "PUT", {
    desk,
    edition: 0,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.desk.players[0].positions, ["中后卫", "后腰"]);
  await app.close();
  await app.start();
  assert.deepEqual(
    (await app.request("/api/coaching-desk")).body.desk.players[0].positions,
    ["中后卫", "后腰"],
  );
  const invalid = { ...multiPositionPlayer, positions: ["守门员"] };
  assert.equal(
    (
      await app.request("/api/coaching-desk", "PUT", {
        desk: { ...desk, players: [invalid] },
        edition: 1,
      })
    ).status,
    400,
  );
  const legacy = { ...multiPositionPlayer, position: "Forward" };
  delete legacy.positions;
  const normalized = await app.request("/api/coaching-desk", "PUT", {
    desk: { ...desk, players: [legacy] },
    edition: 1,
  });
  assert.deepEqual(normalized.body.desk.players[0].positions, ["前锋"]);
});

// Build the pre-club schema explicitly: modern records are not legacy data.
function makeLegacyFixture(database) {
  database.exec("PRAGMA foreign_keys=OFF");
  for (const { name } of database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'club_%'",
    )
    .all())
    database.exec(`DROP TABLE "${name}"`);
  database.exec(
    "DELETE FROM app_migrations WHERE migration_name LIKE 'club-%' OR migration_name LIKE 'berlin-garden-%'",
  );
}

test("legacy Berlin Garden roster and lineup migrate once from the CSV roster", async (t) => {
  const app = await fixture(t);
  const legacyPlayer = {
    ...player,
    playerId: "bg-6",
    name: "妥昱",
    number: 6,
  };
  const legacyBoard = {
    ...board,
    pieces: [
      {
        ...board.pieces[0],
        playerId: "bg-6",
        label: "妥昱",
        shirtNumber: 6,
        position: "FW",
        color: "#DC2626",
      },
    ],
  };
  const desk = {
    board: legacyBoard,
    players: [legacyPlayer],
    selectedTacticId: null,
  };
  assert.equal(
    (await app.request("/api/coaching-desk", "PUT", { desk, edition: 0 }))
      .status,
    200,
  );
  await app.close();
  const database = new DatabaseSync(app.databasePath);
  makeLegacyFixture(database);
  database
    .prepare("UPDATE team_players SET position = ? WHERE player_id = ?")
    .run("待定", "bg-6");
  database.close();
  await app.start();
  const migrated = (await app.request("/api/coaching-desk")).body.desk;
  assert.deepEqual(migrated.players[0], {
    ...legacyPlayer,
    name: "妥昰",
    positions: ["前腰", "右边前"],
    avatar: "/avatars/bg-6.jpg",
  });
  assert.deepEqual(migrated.board.pieces[0], {
    ...legacyBoard.pieces[0],
    label: "妥昰",
    position: "MF",
    color: "#16A34A",
  });
  const customized = {
    ...migrated,
    players: [{ ...migrated.players[0], positions: ["中锋"] }],
    board: {
      ...migrated.board,
      pieces: [
        { ...migrated.board.pieces[0], position: "FW", color: "#DC2626" },
      ],
    },
  };
  assert.equal(
    (
      await app.request("/api/coaching-desk", "PUT", {
        desk: customized,
        edition: 1,
      })
    ).status,
    200,
  );
  await app.close();
  await app.start();
  const afterRestart = (await app.request("/api/coaching-desk")).body.desk;
  assert.deepEqual(afterRestart.players[0].positions, ["中锋"]);
  assert.equal(afterRestart.board.pieces[0].position, "FW");
});

test("Berlin Garden starters migrate from roster order to position-matched formation slots", async (t) => {
  const app = await fixture(t);
  const legacySlots = [
    { x: 100, y: 400, position: "GK" },
    { x: 300, y: 250, position: "DF" },
    { x: 300, y: 550, position: "DF" },
    { x: 550, y: 180, position: "MF" },
    { x: 550, y: 400, position: "MF" },
    { x: 550, y: 620, position: "MF" },
    { x: 800, y: 280, position: "FW" },
    { x: 800, y: 520, position: "FW" },
  ];
  const players = legacySlots.map((slot, index) => ({
    ...player,
    playerId: `bg-${index + 1}`,
    name: `旧队员${index + 1}`,
    number: index + 1,
    fieldPieceId: `piece-${index + 1}`,
  }));
  const pieces = legacySlots.map((slot, index) => ({
    pieceId: `piece-${index + 1}`,
    kind: "player",
    ...slot,
    color: "#000000",
    label: `旧队员${index + 1}`,
    shirtNumber: index + 1,
    team: "home",
    playerId: `bg-${index + 1}`,
  }));
  assert.equal(
    (
      await app.request("/api/coaching-desk", "PUT", {
        desk: {
          board: { pieces, markings: [], trainingPlan: {} },
          players,
          selectedTacticId: null,
        },
        edition: 0,
      })
    ).status,
    200,
  );
  const preset = await app.request("/api/tactics", "POST", {
    tactic: {
      ...tactic,
      board: { pieces, markings: [], trainingPlan: {} },
      presetName: "position-matched-lineup-test",
      presetEdition: 2,
    },
    note: "旧预置阵容",
  });
  assert.equal(preset.status, 201);

  await app.close();
  const legacyDatabase = new DatabaseSync(app.databasePath);
  makeLegacyFixture(legacyDatabase);
  legacyDatabase.close();
  await app.start();
  const migrated = (await app.request("/api/coaching-desk")).body.desk;
  const pieceByPlayer = new Map(
    migrated.board.pieces.map((piece) => [piece.playerId, piece]),
  );

  assert.equal(pieceByPlayer.get("bg-2").x, 100);
  assert.deepEqual(
    [pieceByPlayer.get("bg-1").x, pieceByPlayer.get("bg-4").x],
    [300, 300],
  );
  assert.deepEqual(
    ["bg-3", "bg-7", "bg-8"].map((playerId) => pieceByPlayer.get(playerId).x),
    [550, 550, 550],
  );
  assert.deepEqual(
    [pieceByPlayer.get("bg-5").x, pieceByPlayer.get("bg-6").x],
    [800, 800],
  );
  assert.equal(pieceByPlayer.get("bg-2").position, "GK");
  assert.equal(pieceByPlayer.get("bg-5").position, "FW");
  const migratedPreset = (
    await app.request(`/api/tactics/${preset.body.tacticId}`)
  ).body;
  const presetPieceByPlayer = new Map(
    migratedPreset.board.pieces.map((piece) => [piece.playerId, piece]),
  );
  assert.equal(presetPieceByPlayer.get("bg-2").x, 100);
  assert.equal(presetPieceByPlayer.get("bg-6").label, "妥昰");
  assert.equal(presetPieceByPlayer.get("bg-8").position, "DF");
});

test("collection imports append, preserve versions, rollback invalid entries and retry once by name", async (t) => {
  const app = await fixture(t);
  await app.request("/api/tactics", "POST", { tactic, note: "Existing" });
  const collection = {
    collectionName: "browser-migration",
    tactics: [{ ...tactic, title: "Imported" }],
    versions: [
      { tacticNumber: 0, note: "Old practice", board, createdAt: 123456 },
    ],
    exportedAt: 123456,
  };
  const imported = await app.request(
    "/api/tactic-collections",
    "POST",
    collection,
  );
  assert.equal(imported.status, 201);
  assert.equal(imported.body.importedCount, 1);
  const repeated = await app.request(
    "/api/tactic-collections",
    "POST",
    collection,
  );
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.importedCount, 0);
  assert.deepEqual(repeated.body.tacticIds, imported.body.tacticIds);
  assert.equal((await app.request("/api/tactics")).body.length, 2);
  assert.equal(
    (await app.request(`/api/tactics/${imported.body.tacticIds[0]}/versions`))
      .body[0].createdAt,
    123456,
  );
  assert.equal(
    (
      await app.request("/api/tactic-collections", "POST", {
        tactics: [tactic, { ...tactic, title: "" }],
        versions: [],
      })
    ).status,
    400,
  );
  assert.equal((await app.request("/api/tactics")).body.length, 2);
  assert.equal(
    (
      await app.request("/api/tactic-collections", "POST", {
        tactics: [tactic],
        versions: [{ tacticNumber: 2, board, note: "Wrong tactic" }],
      })
    ).status,
    400,
  );
  assert.equal((await app.request("/api/tactics")).body.length, 2);
  const exported = (await app.request("/api/tactic-collections")).body;
  assert.equal(exported.tactics.length, 2);
  assert.equal(exported.versions.length, 2);
  assert.ok(
    exported.versions.every((version) =>
      Number.isInteger(version.tacticNumber),
    ),
  );
});

test("malformed requests and unknown API paths return bounded uncached errors", async (t) => {
  const app = await fixture(t, { maximumRequestBytes: 1024 });
  const malformed = await fetch(app.origin + "/api/tactics", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: app.cookie,
      origin: app.origin,
    },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal(typeof (await malformed.json()).message, "string");
  assert.equal(
    (
      await app.request("/api/tactics", "POST", {
        tactic: { ...tactic, thumbnail: "x".repeat(2048) },
      })
    ).status,
    413,
  );
  assert.equal((await app.request("/api/absent")).status, 404);
  assert.equal((await app.request("/api/tactics/999")).status, 404);
  assert.match(
    (await app.request("/api/tactics")).headers.get("cache-control"),
    /no-store/,
  );
});

test("production serves static assets and page routes without hiding absent assets or API routes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "football-site-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "index.html"), "<html>Football</html>");
  await writeFile(
    join(directory, "assets", "app.js"),
    'console.log("football")',
  );
  await writeFile(
    join(directory, "manifest.webmanifest"),
    '{"name":"Football"}',
  );
  const app = await fixture(t, { staticDirectory: directory });
  assert.equal(
    await (await fetch(app.origin + "/tactics")).text(),
    "<html>Football</html>",
  );
  assert.match(
    (await fetch(app.origin + "/assets/app.js")).headers.get("content-type"),
    /javascript/,
  );
  assert.equal(
    (await fetch(app.origin + "/manifest.webmanifest")).headers.get(
      "content-type",
    ),
    "application/manifest+json",
  );
  assert.equal((await fetch(app.origin + "/assets/missing.js")).status, 404);
  assert.equal((await app.request("/api/missing")).status, 404);
});

test("a committed tactic survives stopping and restarting the Node server process", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "football-restart-"));
  let child;
  async function start() {
    child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./index.mjs", import.meta.url))],
      {
        env: {
          ...process.env,
          PORT: "0",
          HOST: "127.0.0.1",
          FOOTBALL_DB_PATH: join(directory, "football.sqlite"),
          FOOTBALL_ADMIN_USERNAME: adminCredentials.username,
          FOOTBALL_ADMIN_PASSWORD: adminCredentials.password,
          FOOTBALL_PUBLIC_ORIGIN: "",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("The football server did not start.")),
        10000,
      );
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const address = /http:\/\/127\.0\.0\.1:\d+/.exec(output);
        if (address) {
          clearTimeout(timer);
          resolve(address[0]);
        }
      });
    });
  }
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      await stopped;
    }
  }
  t.after(async () => {
    await stop();
    await rm(directory, { recursive: true, force: true });
  });
  let origin = await start();
  let cookie = await login(origin);
  const saved = await (
    await fetch(origin + "/api/tactics", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({ tactic, note: "Persist through restart" }),
    })
  ).json();
  assert.ok(saved.tacticId > 0);
  await stop();
  origin = await start();
  cookie = await login(origin);
  const restored = await (
    await fetch(origin + `/api/tactics/${saved.tacticId}`, {
      headers: { cookie },
    })
  ).json();
  assert.deepEqual(restored, saved);
});

test("explicit practice versions and imported board demonstrations retain their football details", async (t) => {
  const app = await fixture(t);
  const practiceBoard = {
    ...board,
    demonstration: {
      demonstrationId: "press",
      title: "Press together",
      participants: [{ pieceId: "player-1", kind: "player", x: 50, y: 100 }],
      stages: [
        {
          stageNumber: 0,
          durationSeconds: 2,
          positions: [{ pieceId: "player-1", x: 80, y: 110 }],
        },
      ],
      runs: [{ pieceId: "player-1", fromStage: 0, bend: { x: 65, y: 120 } }],
    },
  };
  const saved = (
    await app.request("/api/tactics", "POST", { tactic, note: "Start" })
  ).body;
  const version = await app.request(
    `/api/tactics/${saved.tacticId}/versions`,
    "POST",
    { note: "Pressing run", board: practiceBoard },
  );
  assert.equal(version.status, 201);
  assert.deepEqual(version.body.board, practiceBoard);
  const imported = await app.request("/api/tactic-collections", "POST", {
    tactics: [{ ...saved, board: practiceBoard }],
    versions: [],
    exportedAt: 100,
  });
  assert.equal(imported.status, 201);
  assert.notEqual(imported.body.tacticIds[0], saved.tacticId);
  assert.deepEqual(
    (await app.request(`/api/tactics/${imported.body.tacticIds[0]}`)).body
      .board,
    practiceBoard,
  );
  assert.equal(
    (
      await app.request("/api/tactics", "POST", {
        tactic: { ...tactic, board: { ...board, snapshot: {} } },
        note: "Invalid vocabulary",
      })
    ).status,
    400,
  );
});

test("deleting the selected tactic clears its desk selection without conflicting with the next board save", async (t) => {
  const app = await fixture(t);
  const saved = (
    await app.request("/api/tactics", "POST", { tactic, note: "" })
  ).body;
  const desk = { board, players: [player], selectedTacticId: saved.tacticId };
  const practice = (
    await app.request("/api/coaching-desk", "PUT", { desk, edition: 0 })
  ).body;
  await app.request(`/api/tactics/${saved.tacticId}`, "DELETE");
  const afterDelete = (await app.request("/api/coaching-desk")).body;
  assert.equal(afterDelete.desk.selectedTacticId, null);
  assert.equal(afterDelete.edition, practice.edition);
  const next = await app.request("/api/coaching-desk", "PUT", {
    desk: { ...desk, selectedTacticId: null },
    edition: practice.edition,
  });
  assert.equal(next.status, 200);
  assert.deepEqual(next.body.desk.board, board);
});

test("repeated preset saves create one tactic and version while backup imports still append", async (t) => {
  const app = await fixture(t);
  const preset = { ...tactic, presetName: "press-example", presetEdition: 1 };
  const [first, second] = await Promise.all([
    app.request("/api/tactics", "POST", { tactic: preset, note: "Preset" }),
    app.request("/api/tactics", "POST", {
      tactic: preset,
      note: "Preset retry",
    }),
  ]);
  assert.equal(first.body.tacticId, second.body.tacticId);
  assert.equal(
    (await app.request(`/api/tactics/${first.body.tacticId}/versions`)).body
      .length,
    1,
  );
  const imported = await app.request("/api/tactic-collections", "POST", {
    tactics: [preset],
    versions: [],
  });
  assert.notEqual(imported.body.tacticIds[0], first.body.tacticId);
});

test("malformed nested practice details are rejected before they can break board restoration", async (t) => {
  const app = await fixture(t);
  const invalidBoards = [
    { ...board, pieces: [{ pieceId: "p1", x: "left", y: 2 }] },
    { ...board, pieces: [{ pieceId: "p1", x: 1, y: 2, label: {} }] },
    {
      ...board,
      markings: [
        {
          markingId: "m1",
          kind: "line",
          startX: {},
          startY: 0,
          endX: 1,
          endY: 1,
        },
      ],
    },
    { ...board, demonstration: {} },
    {
      ...board,
      demonstration: {
        demonstrationId: "d1",
        title: "Press",
        participants: [],
        stages: [{}],
        runs: [],
      },
    },
    {
      ...board,
      demonstration: {
        demonstrationId: "d1",
        title: "Press",
        participants: [],
        stages: [],
        runs: [{ pieceId: "p1", fromStage: 0, bend: { x: "left", y: 0 } }],
      },
    },
    {
      ...board,
      trainingPlan: { objective: {}, instructions: "", durationMinutes: 15 },
    },
    { ...board, trainingPlan: { durationMinutes: "fifteen" } },
  ];
  for (const invalidBoard of invalidBoards) {
    const response = await app.request("/api/tactics", "POST", {
      tactic: { ...tactic, board: invalidBoard },
      note: "",
    });
    assert.equal(response.status, 400);
    assert.match(response.body.message, /[\u4e00-\u9fff]/);
  }
  assert.equal(
    (
      await app.request("/api/tactics", "POST", {
        tactic: { ...tactic, match: { opponent: {} } },
        note: "",
      })
    ).status,
    400,
  );
  assert.deepEqual((await app.request("/api/tactics")).body, []);
});

test("invalid formation metadata is rejected without changing the desk edition", async (t) => {
  const app = await fixture(t);
  for (const metadata of [
    { formationId: 42 },
    { awayFormationId: {} },
    { formationCustomized: "true" },
  ]) {
    const result = await app.request("/api/coaching-desk", "PUT", {
      edition: 0,
      desk: {
        board: { ...board, ...metadata },
        players: [player],
        selectedTacticId: null,
      },
    });
    assert.equal(result.status, 400);
    assert.equal((await app.request("/api/coaching-desk")).body.edition, 0);
  }
});
