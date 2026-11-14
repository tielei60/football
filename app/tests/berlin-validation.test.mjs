import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBerlinValidation, main } from "../../scripts/create-berlin-validation.mjs";
import { openFootballStore } from "../../server/football-store.mjs";
import { createClubStore } from "../../server/club-store.mjs";

// 只在本测试进程替换来源读取，绝不把真实姓名写进测试数据库。
function anonymousSources() {
  const names = Array.from({ length: 20 }, (_, i) => `匿名样例${i + 1}`);
  return [
    `const PLAYER_POSITIONS=["中场"]; const seeds=${JSON.stringify(names.map((n) => [n, ["中场"]]))};`,
    `const berlinGardenNames=${JSON.stringify(names)}; const berlinGardenPositions=${JSON.stringify(names.map((_, i) => [`bg-${i + 1}`, ["中场"]]))};`,
  ];
}
test("拒绝任何目标路径或参数", () => {
  assert.throws(() => createBerlinValidation("/tmp/target"));
  assert.throws(() => createBerlinValidation({}));
  assert.throws(() => main(["--details"]));
});
test("匿名隔离库：未知资料、空历史、仅验证管理员、迁移重开稳定", () => {
  const originalRead = fs.readFileSync;
  const sources = anonymousSources();
  fs.readFileSync = function (path, ...args) {
    const p = String(path);
    if (p.endsWith("/app/src/data/berlinGarden.ts")) return sources[0];
    if (p.endsWith("/server/football-store.mjs")) return sources[1];
    return originalRead.call(this, path, ...args);
  };
  syncBuiltinESMExports();
  const sentinelDir = fs.mkdtempSync(join(tmpdir(), "football-validation-sentinel-"));
  const sentinel = join(sentinelDir, "untouched");
  fs.writeFileSync(sentinel, "不得修改");
  const previous = process.env.FOOTBALL_DB_PATH;
  process.env.FOOTBALL_DB_PATH = sentinel;
  let result, store;
  try {
    result = createBerlinValidation();
    assert.equal(result.total, 20);
    assert.equal(result.serviceStarted, false);
    assert.equal(originalRead(sentinel, "utf8"), "不得修改");
    assert.equal(fs.statSync(result.directory).mode & 0o777, 0o700);
    const manifestPath = join(result.directory, "manifest.json");
    assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);
    const manifest = JSON.parse(originalRead(manifestPath, "utf8"));
    assert.equal(fs.statSync(manifest.databasePath).mode & 0o777, 0o600);
    assert.ok(manifest.credentials.password.length >= 40);
    store = openFootballStore(manifest.databasePath);
    createClubStore(store.database, store);
    const db = store.database;
    const players = db.prepare("SELECT * FROM club_players ORDER BY id").all();
    assert.equal(players.length, 20);
    for (const p of players) {
      assert.match(p.name, /^匿名样例/);
      assert.match(p.id, /^bg-\d+$/);
      assert.equal(p.number, null);
      assert.equal(p.avatar, null);
      assert.equal(p.preferred_foot, "");
      assert.equal(p.status, "inactive");
      assert.deepEqual(JSON.parse(p.positions), ["中场"]);
      assert.match(p.note, /未知/);
    }
    assert.equal(db.prepare("SELECT count(*) n FROM validation_roster_sources").get().n, 20);
    const users = db.prepare("SELECT role,player_id FROM club_users").all();
    assert.equal(users.length, 1);
    assert.equal(users[0].role, "admin");
    assert.equal(users[0].player_id, null);
    for (const table of [
      "team_players",
      "coaching_desks",
      "club_matches",
      "club_roster",
      "club_rsvps",
      "club_seasons",
      "club_season_roster",
      "tactics",
      "tactic_versions",
      "club_sessions",
    ])
      assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0, table);
  } finally {
    store?.close();
    fs.readFileSync = originalRead;
    syncBuiltinESMExports();
    if (previous === undefined) delete process.env.FOOTBALL_DB_PATH;
    else process.env.FOOTBALL_DB_PATH = previous;
    if (result) fs.rmSync(result.directory, { recursive: true, force: true });
    fs.rmSync(sentinelDir, { recursive: true, force: true });
  }
});
