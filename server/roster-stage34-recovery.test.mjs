// 阶段34：真实存储层版本恢复测试。忽略成功返回值模拟客户端未收到回执，不模拟网络断连或原生UI。
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { createDemo } from "../scripts/create-demo.mjs";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";

function fixture(t) {
  const demo = createDemo();
  const store = openFootballStore(demo.databasePath);
  t.after(() => { store.close(); rmSync(demo.directory, { recursive: true, force: true }); });
  const club = createClubStore(store.database, store);
  const session = club.login(demo.credentials[0], "stage34-recovery");
  const admin = club.authenticate(session.token);
  const match = club.saveMatch(admin, null, { opponent: "匿名名单恢复队", date: "2099-01-01", status: "published" });
  const row = { playerId: demo.players[0].id, position: "中场", selection: "starter", appeared: true, goals: 1, assists: 0 };
  const get = () => club.getMatch(admin, match.id);
  const save = input => club.saveRoster(admin, match.id, input);
  const snapshot = () => ({
    match: store.database.prepare("SELECT * FROM club_matches WHERE id=?").get(match.id),
    rows: store.database.prepare("SELECT * FROM club_roster WHERE match_id=? ORDER BY player_id").all(match.id),
  });
  return { club, admin, match, row, get, save, snapshot };
}

test("成功写入但客户端未获回执，旧版本重试409不重复不覆盖，读取可恢复结果", t => {
  const { match, row, save, snapshot, get } = fixture(t);
  const request = { revision: match.revision, roster: [row] };
  save(request); // 故意不使用返回值，客户端仍持有原版本。
  const committed = snapshot();
  assert.equal(committed.match.revision, match.revision + 1);
  assert.equal(committed.rows.length, 1);
  for (const roster of [[row], [], [{ ...row, goals: 9 }]]) {
    assert.throws(() => save({ revision: request.revision, roster }), error => error.status === 409);
    assert.deepEqual(snapshot(), committed);
  }
  const recovered = get();
  assert.equal(recovered.revision, match.revision + 1);
  assert.equal(recovered.roster.length, 1);
  for (const key of Object.keys(row)) assert.deepEqual(recovered.roster[0][key], row[key]);
  save({ revision: recovered.revision, roster: [{ ...row, assists: 2 }] });
  const updated = snapshot();
  assert.equal(updated.match.revision, recovered.revision + 1);
  assert.equal(updated.rows.length, 1);
  assert.equal(updated.rows[0].assists, 2);
  for (const field of ["player_snapshot", "snapshot_captured_at", "snapshot_source"])
    assert.equal(updated.rows[0][field], committed.rows[0][field]);
});

test("另一编辑者先保存，旧名单409保留服务器最新名单和完整快照", t => {
  const { row, get, save, snapshot } = fixture(t);
  const stale = get();
  const newer = save({ revision: stale.revision, roster: [{ ...row, appeared: false, goals: null, assists: null }] });
  const expected = snapshot();
  assert.throws(() => save({ revision: stale.revision, roster: [row] }), error => error.status === 409);
  assert.deepEqual(snapshot(), expected);
  assert.deepEqual(get(), newer);
});

test("缺失非法版本和重复球员失败均不写入，未落库请求以当前版本重试可成功", t => {
  const { match, row, save, snapshot } = fixture(t);
  const before = snapshot();
  for (const revision of [undefined, null, 0, -1, 1.5, "1"])
    assert.throws(() => save({ revision, roster: [row] }), error => error.status === 428);
  assert.throws(() => save({ revision: match.revision, roster: [row, row] }), error => error.status === 400);
  assert.deepEqual(snapshot(), before);
  const saved = save({ revision: match.revision, roster: [row] });
  assert.equal(saved.revision, match.revision + 1);
  assert.equal(snapshot().rows.length, 1);
});
