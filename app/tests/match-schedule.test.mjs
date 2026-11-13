import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarDays,
  formatMatchDate,
  formatSchedule,
  matchEndLabel,
  parseMatchDate,
  validKickoff,
} from "../src/utils/matchSchedule.ts";

test("wall clock date/weekday formatting retains unknown time and rejects impossible dates", () => {
  assert.equal(formatMatchDate("2027-02-07"), "2027-02-07 周日");
  assert.equal(formatMatchDate("2024-02-29"), "2024-02-29 周四");
  assert.equal(parseMatchDate("2027-02-29"), null);
  assert.equal(parseMatchDate("2027-2-07"), null);
  assert.equal(parseMatchDate(""), null);
  assert.equal(formatSchedule({ date: "2027-02-07", kickoff: "" }), "2027-02-07 周日 · 时间待定");
  assert.equal(formatSchedule("2027-02-07", "15:07"), "2027-02-07 周日 · 15:07");
  assert.equal(validKickoff("24:00"), false);
  assert.equal(validKickoff("00:00"), true);
});

test("duration arithmetic preserves local clock across year/leap/month boundaries", () => {
  assert.equal(matchEndLabel("2026-12-31", "23:30", 90), "预计结束：2027-01-01 周五 01:00");
  assert.equal(
    matchEndLabel({ date: "2024-02-28", kickoff: "23:30", durationMinutes: 90 }),
    "预计结束：2024-02-29 周四 01:00"
  );
  assert.equal(matchEndLabel("2027-02-07", "15:07", 60), "预计结束：2027-02-07 周日 16:07");
  assert.equal(matchEndLabel("2027-02-07", "00:00", 1440), "预计结束：2027-02-08 周一 00:00");
  for (const duration of [null, undefined, 0, -1, 1.5, 1441, NaN])
    assert.equal(matchEndLabel("2027-02-07", "15:00", duration), "结束时间待定");
  assert.equal(matchEndLabel("2027-02-07", "", 90), "结束时间待定");
  assert.equal(matchEndLabel("bad", "15:00", 90), "结束时间待定");
  assert.equal(matchEndLabel("9999-12-31", "23:30", 90), "结束时间超出支持日期范围");
});

test("calendar grid is Monday-first, stable six weeks, with real adjacent dates", () => {
  const days = calendarDays(2027, 2);
  assert.equal(days.length, 42);
  assert.equal(days[0], "2027-02-01");
  assert.equal(days[6], "2027-02-07");
  assert.equal(days[41], "2027-03-14");
  const leap = calendarDays(2024, 2);
  assert.equal(leap[0], "2024-01-29");
  assert.ok(leap.includes("2024-02-29"));
  assert.equal(new Set(leap).size, 42);
  assert.deepEqual(calendarDays(2027, 13), []);
});
