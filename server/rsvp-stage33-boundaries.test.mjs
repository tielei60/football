// 阶段33：真实报名存储层边界；每例只使用新建匿名隔离库，不代表原生或HTTP验证。
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
  const users = demo.credentials.map(credentials => {
    const session = club.login(credentials, "stage33-boundaries");
    return club.authenticate(session.token);
  });
  const [admin, first, second] = users;
  const create = (status = "published", date = "2099-01-01", maxParticipants = null) =>
    club.saveMatch(admin, null, { opponent: "匿名报名边界队", date, status, maxParticipants });
  const rows = id => store.database.prepare("SELECT * FROM club_rsvps WHERE match_id=? ORDER BY player_id").all(id);
  return { club, admin, first, second, create, rows };
}

test("已发布比赛过去或未来均可报名，当前规则不按日期自动截止", t => {
  const { club, first, create, rows } = fixture(t);
  for (const date of ["2000-01-01", "2099-01-01"]) {
    const match = create("published", date);
    club.saveRsvp(first, match.id, { response: "yes" });
    assert.equal(rows(match.id).length, 1);
    assert.equal(rows(match.id)[0].player_id, first.player_id);
    assert.equal(rows(match.id)[0].response, "yes");
  }
});

test("完成取消比赛拒绝报名，草稿对球员隐藏，未绑定管理员不能代报名", t => {
  const { club, admin, first, create, rows } = fixture(t);
  assert.equal(admin.player_id, null);
  for (const status of ["completed", "cancelled", "draft"]) {
    const match = create(status);
    const before = rows(match.id);
    for (const response of ["yes", "maybe", "no"])
      assert.throws(() => club.saveRsvp(first, match.id, { response }), error => error.status === (status === "draft" ? 404 : 409));
    assert.deepEqual(rows(match.id), before);
  }
  const published = create();
  for (const response of ["yes", "maybe", "no"])
    assert.throws(() => club.saveRsvp(admin, published.id, { response }), error => error.status === 403);
  assert.deepEqual(rows(published.id), []);
});

test("满员拒绝新增参加但允许待定请假，重复报名及切换始终单条，释放名额后可加入", t => {
  const { club, first, second, create, rows } = fixture(t);
  const match = create("published", "2099-01-01", 1);
  const save = (user, response) => club.saveRsvp(user, match.id, { response });
  save(first, "yes"); save(first, "yes");
  assert.equal(rows(match.id).length, 1);
  const full = rows(match.id);
  assert.throws(() => save(second, "yes"), error => error.status === 409);
  assert.deepEqual(rows(match.id), full);
  for (const response of ["maybe", "no", "maybe"]) {
    save(second, response);
    const current = rows(match.id);
    assert.equal(current.length, 2);
    assert.equal(current.find(row => row.player_id === second.player_id).response, response);
    assert.equal(current.filter(row => row.response === "yes").length, 1);
    assert.throws(() => save(second, "yes"), error => error.status === 409);
    assert.deepEqual(rows(match.id), current);
  }
  save(first, "no"); save(second, "yes"); save(second, "yes");
  const final = rows(match.id);
  assert.equal(final.length, 2);
  assert.equal(final.find(row => row.player_id === first.player_id).response, "no");
  assert.equal(final.find(row => row.player_id === second.player_id).response, "yes");
  assert.equal(new Set(final.map(row => row.player_id)).size, 2);
});
