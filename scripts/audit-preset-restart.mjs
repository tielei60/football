/** Independent preset/migration audit. Only owned temporary SQLite databases.
 * Real frontend importSeedTactics + real HTTP, then real SQLite close/reopen.
 * Legacy/upgraded fixtures are synthesized here; no demo/production path is read.
 * Run: node scripts/audit-preset-restart.mjs
 */
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { createFootballServer } from "../server/index.mjs";
import { openFootballStore } from "../server/football-store.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "app/package.json"));
const { build } = require("esbuild");
const dir = mkdtempSync(join(tmpdir(), "football-preset-restart-audit-"));
const databasePath = join(dir, "fictional.sqlite");
const credential = { username: "preset-audit", password: randomUUID() };
const nativeFetch = globalThis.fetch;
const migrations = [
  "berlin-garden-roster-csv-positions-v2",
  "berlin-garden-position-matched-lineup-v3",
  "berlin-garden-formation-matched-lineups-v6",
];
const tables = [
  "tactics",
  "tactic_versions",
  "coaching_desks",
  "team_players",
  "tactic_collections",
];
const sourceFiles = [
  "server/football-store.mjs",
  "app/src/stores/tacticsStore.ts",
  "app/src/data/seedTactics.ts",
];
const hashes = () =>
  Object.fromEntries(
    sourceFiles.map((f) => [
      f,
      createHash("sha256")
        .update(readFileSync(join(root, f)))
        .digest("hex"),
    ]),
  );
const sourceHashes = hashes();
let server,
  origin,
  cookie,
  assertions = 0;
const equal = (a, b, label) => {
  assertions++;
  if (!isDeepStrictEqual(a, b)) throw new Error(label);
};
const rows = (db) =>
  Object.fromEntries(
    tables.map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
    ]),
  );
const checkMarkers = (db, label) =>
  equal(
    migrations.map(
      (m) =>
        !!db
          .prepare("SELECT 1 FROM app_migrations WHERE migration_name=?")
          .get(m),
    ),
    [true, true, true],
    label,
  );
const read = (path, fn) => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
async function start() {
  server = createFootballServer({
    databasePath,
    bootstrapAdmin: credential,
    publicOrigin: null,
    secureCookies: false,
    trustedProxyAddresses: [],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
}
async function stop() {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
async function api(path, method = "GET", body) {
  const response = await nativeFetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${method} ${path} HTTP ${response.status}`);
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return response.json();
}
const collection = async () => {
  const result = await api("/api/tactic-collections");
  delete result.exportedAt;
  return result;
};

try {
  await start();
  await api("/api/auth/login", "POST", credential);
  read(databasePath, (db) =>
    checkMarkers(db, "empty new initialization closes all legacy migrations"),
  );
  globalThis.fetch = (path, options = {}) =>
    nativeFetch(String(path).startsWith("/") ? origin + path : path, {
      ...options,
      headers: { ...options.headers, Origin: origin, Cookie: cookie },
    });
  globalThis.window = {
    innerWidth: 1440,
    innerHeight: 960,
    navigator: { userAgent: "independent-preset-audit" },
    location: {
      assign() {
        throw new Error("unexpected redirect");
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const built = await build({
    stdin: {
      contents:
        "import{createPinia,setActivePinia}from'pinia';import{useTacticsStore}from'./src/stores/tacticsStore.ts';setActivePinia(createPinia());export{useTacticsStore};",
      resolveDir: join(root, "app"),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    alias: { "@": join(root, "app/src") },
    loader: { ".png": "dataurl", ".svg": "text" },
  });
  const bundle = join(dir, "actual-preset-import.cjs");
  writeFileSync(bundle, built.outputFiles[0].text);
  const t = require(bundle).useTacticsStore();
  equal(
    await t.importSeedTactics(),
    10,
    "actual UI store imports all ten presets",
  );
  equal(await t.importSeedTactics(), 0, "duplicate preset import adds nothing");
  const imported = await collection();
  equal(imported.tactics.length, 10, "ten persisted presets");
  equal(imported.versions.length, 10, "one real version per imported preset");
  await stop();
  const initialRows = read(databasePath, rows);
  await start();
  equal(
    await collection(),
    imported,
    "all ten unedited presets plus versions remain byte-equivalent after first restart",
  );
  equal(
    read(databasePath, rows),
    initialRows,
    "first restart changes no tactical SQLite rows",
  );
  const original = imported.tactics.find((x) => x.presetName === "t6");
  const edited = structuredClone(original);
  edited.title = "虚构预置自定义后不可被旧迁移重排";
  edited.board.pieces[0].x += 37;
  edited.board.pieces[0].position = "FW";
  edited.board.pieces[0].color = "#123456";
  await api(`/api/tactics/${original.tacticId}`, "PUT", {
    tactic: edited,
    note: "独立虚构验收自定义",
  });
  const players = Array.from({ length: 8 }, (_, i) => ({
    playerId: `bg-${i + 1}`,
    name: `虚构自定义成年球员${i + 1}`,
    number: 50 + i,
    positions: ["前锋"],
    preferredFoot: "Right",
    status: "ok",
    note: "独立临时数据",
    fieldPieceId: null,
  }));
  await api("/api/coaching-desk", "PUT", {
    edition: 0,
    desk: { board: edited.board, players, selectedTacticId: original.tacticId },
  });
  const customizedCollection = await collection();
  const customizedDesk = await api("/api/coaching-desk");
  await stop();
  const customRows = read(databasePath, rows);
  await start();
  equal(
    await collection(),
    customizedCollection,
    "edited preset content and history survive restart exactly",
  );
  equal(
    await api("/api/coaching-desk"),
    customizedDesk,
    "modern bg-* player names/numbers/positions and desk survive exactly",
  );
  equal(
    read(databasePath, rows),
    customRows,
    "modern user customization has no SQL changes on restart",
  );
  await stop();
  console.log(
    "PASS fresh initialization -> actual ten-preset import -> duplicate import -> restart -> custom save -> restart",
  );

  // Simulate shipped modern databases with missing old migration markers. Each
  // case uses a closed copy of this script's own fictional fixture, never a demo.
  for (const mode of [
    "all-missing",
    "only-v2-missing",
    "only-v3-missing",
    "only-v6-missing",
    "schema-only",
    "marker-only",
  ]) {
    const path = join(dir, `${mode}.sqlite`);
    cpSync(databasePath, path);
    let db = new DatabaseSync(path);
    const selected = mode.startsWith("only-")
      ? [
          migrations[
            ["only-v2-missing", "only-v3-missing", "only-v6-missing"].indexOf(
              mode,
            )
          ],
        ]
      : migrations;
    for (const migration of selected)
      db.prepare("DELETE FROM app_migrations WHERE migration_name=?").run(
        migration,
      );
    if (mode === "schema-only")
      db.exec(
        "DELETE FROM app_migrations WHERE migration_name='club-management-v1'",
      );
    if (mode === "marker-only") {
      db.exec("PRAGMA foreign_keys=OFF");
      for (const { name } of db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'club_*'",
        )
        .all())
        db.exec(`DROP TABLE "${name}"`);
    }
    const before = rows(db);
    db.close();
    let store = openFootballStore(path);
    equal(
      rows(store.database),
      before,
      `${mode}: existing modern tactical rows unchanged`,
    );
    checkMarkers(store.database, `${mode}: all deferred migrations now closed`);
    store.close();
    store = openFootballStore(path);
    equal(
      rows(store.database),
      before,
      `${mode}: repeated reopen still unchanged`,
    );
    equal(
      store.database.prepare("PRAGMA integrity_check").get().integrity_check,
      "ok",
      `${mode}: SQLite integrity`,
    );
    equal(
      store.database.prepare("PRAGMA foreign_key_check").all(),
      [],
      `${mode}: references intact`,
    );
    store.close();
  }
  console.log(
    "PASS existing modern db holes: all / each individual migration marker, schema-only and marker-only detection",
  );

  // True legacy pre-club fixture: no club schema/marker. Deliberately old slots
  // and positions must still receive their one-time historical corrections.
  const legacyPath = join(dir, "true-pre-club.sqlite");
  let legacy = openFootballStore(legacyPath);
  const pieces = players.map((p, i) => ({
    pieceId: `old-${i}`,
    kind: "player",
    playerId: p.playerId,
    label: p.name,
    shirtNumber: p.number,
    team: "home",
    x: 100 + i * 100,
    y: 200,
    position: i === 0 ? "GK" : "FW",
    color: "#000000",
  }));
  const board = {
    pieces,
    markings: [],
    trainingPlan: { focus: "legacy fixture" },
  };
  const tactic = legacy.saveTactic(null, {
    tactic: {
      title: "旧库虚构预置",
      tags: [],
      favorite: false,
      formationName: "3-3-1",
      board,
      thumbnail: null,
      presetName: "legacy-fixture",
      presetEdition: 1,
    },
    note: "original version remains historic",
  });
  legacy.saveDesk({
    edition: 0,
    desk: { board, players, selectedTacticId: tactic.tacticId },
  });
  const originalVersions = legacy.listVersions(tactic.tacticId);
  for (const migration of migrations)
    legacy.database
      .prepare("DELETE FROM app_migrations WHERE migration_name=?")
      .run(migration);
  equal(
    legacy.database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'club_*'",
      )
      .all(),
    [],
    "legacy fixture has no modern club schema",
  );
  legacy.close();
  legacy = openFootballStore(legacyPath);
  const migratedDesk = legacy.getDesk();
  const migratedTactic = legacy.getTactic(tactic.tacticId);
  for (const currentBoard of [migratedDesk.desk.board, migratedTactic.board]) {
    const byPlayer = new Map(currentBoard.pieces.map((p) => [p.playerId, p]));
    equal(
      byPlayer.get("bg-2").position,
      "GK",
      "legacy keeper position corrected",
    );
    equal(byPlayer.get("bg-2").x, 100, "legacy keeper moved to keeper slot");
    equal(
      byPlayer.get("bg-6").position,
      "MF",
      "legacy 3-3-1 attacking midfielder slot corrected",
    );
    equal(
      new Set(currentBoard.pieces.map((p) => p.playerId)).size,
      8,
      "legacy migration retains all eight identities",
    );
  }
  equal(
    migratedDesk.desk.players.find((p) => p.playerId === "bg-6").positions,
    ["前腰", "右边前"],
    "legacy first migration corrects known roster positions",
  );
  equal(
    legacy.listVersions(tactic.tacticId),
    originalVersions,
    "legacy migration does not rewrite historical versions",
  );
  checkMarkers(legacy.database, "legacy one-time migrations marked complete");
  migratedDesk.desk.players[0].name = "迁移后虚构更名";
  migratedDesk.desk.players[0].positions = ["前锋"];
  migratedDesk.desk.board.pieces[0].x = 333;
  legacy.saveDesk({ desk: migratedDesk.desk, edition: migratedDesk.edition });
  migratedTactic.board.pieces[0].x = 444;
  legacy.saveTactic(tactic.tacticId, {
    tactic: migratedTactic,
    note: "post-migration customization",
  });
  const legacyAfterEdit = rows(legacy.database);
  legacy.close();
  legacy = openFootballStore(legacyPath);
  equal(
    rows(legacy.database),
    legacyAfterEdit,
    "after legacy migration user edits survive every later reopen",
  );
  equal(
    legacy.database.prepare("PRAGMA integrity_check").get().integrity_check,
    "ok",
    "legacy SQLite integrity",
  );
  equal(
    legacy.database.prepare("PRAGMA foreign_key_check").all(),
    [],
    "legacy foreign keys intact",
  );
  legacy.close();
  console.log(
    "PASS real pre-club data migrates once; old versions and all post-migration edits remain intact",
  );
  equal(hashes(), sourceHashes, "source unchanged during independent run");
  console.log(
    JSON.stringify(
      {
        result: "PASS",
        assertions,
        sourceHashes,
        scope:
          "actual frontend preset import, real loopback HTTP and owned temporary SQLite; NOT UI rendering or production data",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  await stop();
  rmSync(dir, { recursive: true, force: true });
}
