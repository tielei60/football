import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { buildRosterPreview, readLiteral, summarizePreview } from "../../scripts/preview-berlin-roster.mjs";

const front = 'const PLAYER_POSITIONS = ["门将", "中场"] as const; const seeds = [["虚构甲", ["门将"]], ["虚构乙", ["中场"]]];';
const back = 'const berlinGardenNames = ["虚构甲", "虚构乙"]; const berlinGardenPositions = [["bg-1", ["门将"]], ["bg-2", ["中场"]]];';

test("只保留已知来源字段，不将派生号码、健康默认值和统计写成事实", () => {
  const result = buildRosterPreview(front, back);
  assert.equal(result.total, 2);
  assert.equal(result.records[0].sourceId, "bg-1");
  assert.deepEqual(result.records[0].positions, ["门将"]);
  for (const row of result.records) {
    for (const key of ["number", "avatar", "foot", "healthStatus", "dateOfBirth"]) assert.equal(row[key], null);
    assert.equal("goals" in row, false);
  }
  assert.deepEqual(result, buildRosterPreview(front, back));
  assert.equal(JSON.stringify(summarizePreview(result)).includes("虚构甲"), false);
  assert.equal("records" in summarizePreview(result), false);
});

test("来源不一致、重复姓名、异常位置、缺失或可执行表达式均停止预览", () => {
  assert.throws(() => buildRosterPreview(front, back.replace("虚构乙", "不同姓名")), /不一致/);
  assert.throws(() => buildRosterPreview(front.replace("虚构乙", "虚构甲"), back), /重复/);
  assert.throws(() => buildRosterPreview(front.replace('["门将"]', '["无效"]'), back), /位置无效/);
  assert.throws(() => buildRosterPreview(front.replace('["门将"]', '["门将", "门将"]'), back), /位置无效/);
  assert.throws(() => readLiteral('const seeds = malicious();', "seeds"), /字符串数组/);
  assert.throws(() => readLiteral('let seeds; const seeds = ["虚构"];', "seeds"), /重复声明/);
  assert.throws(() => readLiteral('const other = [];', "seeds"), /字符串数组/);
  assert.throws(() => readLiteral('const seeds = [', "seeds"), /语法错误/);
});

test("现有前后端来源一致，摘要无姓名，默认命令不接受数据库目标", () => {
  const frontend = readFileSync(new URL("../src/data/berlinGarden.ts", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../../server/football-store.mjs", import.meta.url), "utf8");
  const result = buildRosterPreview(frontend, backend);
  assert.equal(result.total, 20);
  assert.equal(result.multiplePositions, 5);
  const script = new URL("../../scripts/preview-berlin-roster.mjs", import.meta.url);
  const command = spawnSync(process.execPath, [script.pathname], { encoding: "utf8" });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).total, 20);
  for (const player of result.records) assert.equal(command.stdout.includes(player.name), false);
  const refused = spawnSync(process.execPath, [script.pathname, "--database", "/tmp/not-a-target.sqlite"], { encoding: "utf8" });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /不接受数据库/);
});
