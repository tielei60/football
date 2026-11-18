// 阶段31补充：真实统计存储层 + 每测试新建匿名临时库，不代表原生操作或HTTP覆盖。
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
  const session = club.login(demo.credentials[0], "stage31-boundaries");
  const admin = club.authenticate(session.token);
  return { club, admin, demo, stats: query => club.statistics(admin, new URLSearchParams(query)) };
}

test("统计范围全部互斥组合及非法值拒绝，不改变合法查询结果", t => {
  const { stats, demo } = fixture(t);
  const before = stats({ all: "1" });
  for (const query of [
    { all: "1", seasonId: String(demo.season.id) },
    { all: "1", year: "2026" },
    { year: "2026", seasonId: String(demo.season.id) },
    { all: "1", year: "2026", seasonId: String(demo.season.id) },
    { all: "1", year: "" }, { all: "" }, { all: "0" },
    ...["", "1899", "10000", "2026.5", "abc", "Infinity"].map(year => ({ year })),
    ...["", "0", "-1", "1.5", "abc"].map(seasonId => ({ seasonId })),
  ]) assert.throws(() => stats(query), error => error.status === 400, JSON.stringify(query));
  assert.deepEqual(stats({ all: "1" }), before);
});

test("闰日赛季首尾均包含，仅按明确赛季归属，不吸收同日其它赛季或未归属比赛", t => {
  const { club, admin, stats } = fixture(t);
  const season = club.saveSeason(admin.team_id, null, { name: "闰日边界", startDate: "2028-02-29", endDate: "2028-03-01" });
  const other = club.saveSeason(admin.team_id, null, { name: "重叠赛季", startDate: "2028-02-29", endDate: "2028-03-01" });
  const create = (date, seasonId = null, status = "completed") => club.saveMatch(admin, null, { opponent: "匿名边界队", date, seasonId, status, homeScore: 1, awayScore: 0 });
  create("2028-02-29", season.id); create("2028-03-01", season.id);
  create("2028-02-29", other.id); create("2028-02-29");
  create("2028-02-28"); create("2028-03-02");
  create("2028-02-29", season.id, "draft"); create("2028-03-01", season.id, "cancelled");
  const scoped = stats({ seasonId: String(season.id) });
  assert.equal(scoped.matches, 2); assert.equal(scoped.registrationMatches, 2);
  assert.equal(scoped.team.goalsFor, 2);
  assert.deepEqual(scoped.filter, { startDate: "2028-02-29", endDate: "2028-03-01", label: "闰日边界" });
  assert.equal(stats({ seasonId: String(other.id) }).matches, 1);
  assert.equal(stats({ year: "2028" }).matches, 6);
  const before = stats({ all: "1" });
  for (const date of ["2028-02-28", "2028-03-02", "2027-02-29"])
    assert.throws(() => create(date, season.id), error => error.status === 400, date);
  assert.deepEqual(stats({ all: "1" }), before);
});
