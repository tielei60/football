import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openFootballStore } from "./football-store.mjs";

const board = { pieces: [{ pieceId: "p", x: 1, y: 2 }], markings: [],
  trainingPlan: { objective: "配合", instructions: "先传后跑", durationMinutes: 10 } };
const collection = () => ({ collectionName: "isolated-import", exportedAt: 10,
  tactics: [{ title: "隔离战术", tags: [], favorite: false, formationName: null,
    thumbnail: null, board: structuredClone(board) }],
  versions: [{ tacticNumber: 0, note: "历史", createdAt: 1, board: structuredClone(board) }] });
function store(t) { const s = openFootballStore(":memory:"); t.after(() => s.close()); return s; }
const rows = (s) => JSON.stringify(["tactics", "tactic_versions", "tactic_collections"].map(
  (name) => s.database.prepare("SELECT * FROM " + name).all()));
const reverseKeys = (v) => Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === "object"
  ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)])) : v;

test("命名导入哈希忽略对象键顺序与导出时间，重试不重复", (t) => {
  const s = store(t), input = collection(), first = s.importCollection(input), before = rows(s);
  const repeated = s.importCollection({ ...reverseKeys(input), exportedAt: 999 });
  assert.equal(repeated.receiptVerification, "verified");
  assert.equal(repeated.repeated, true); assert.equal(repeated.importedCount, 0);
  assert.deepEqual(repeated.tacticIds, first.tacticIds); assert.equal(rows(s), before);
  assert.match(s.database.prepare("SELECT payload_hash FROM tactic_collections").get().payload_hash, /^[a-f0-9]{64}$/);
});

for (const field of ["title", "board", "history", "historyOrder"]) test("同名异内容拒绝并零写入：" + field, (t) => {
  const s = store(t), input = collection();
  input.versions.push({ ...structuredClone(input.versions[0]), createdAt: 2, note: "第二版" });
  s.importCollection(input); const before = rows(s), changed = structuredClone(input);
  if (field === "title") changed.tactics[0].title = "不同内容";
  if (field === "board") changed.tactics[0].board.pieces[0].x++;
  if (field === "history") changed.versions[0].board.trainingPlan.objective = "不同训练";
  if (field === "historyOrder") changed.versions.reverse();
  assert.throws(() => s.importCollection(changed), { status: 409 }); assert.equal(rows(s), before);
});

test("导入后编辑或删除目标也不会重建，冲突仍根据原请求判断", (t) => {
  const s = store(t), input = collection(), first = s.importCollection(input), id = first.tacticIds[0];
  s.saveTactic(id, { tactic: { ...s.getTactic(id), title: "后来编辑" } });
  assert.equal(s.importCollection(input).importedCount, 0); assert.equal(s.getTactic(id).title, "后来编辑");
  s.deleteTactic(id); const before = rows(s);
  assert.deepEqual(s.importCollection(input).tacticIds, [id]); assert.equal(rows(s), before);
  const different = structuredClone(input); different.tactics[0].title = "再建";
  assert.throws(() => s.importCollection(different), { status: 409 }); assert.equal(rows(s), before);
});

test("非法版本事务回滚，无战术或哈希收据残留，可修正原请求", (t) => {
  const s = store(t), bad = collection(), before = rows(s); bad.versions[0].tacticNumber = 5;
  assert.throws(() => s.importCollection(bad), { status: 400 }); assert.equal(rows(s), before);
  assert.equal(s.importCollection(collection()).importedCount, 1);
});

test("旧NULL收据迁移幂等，重试仅标未核验而不回填或重复导入", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "football-receipt-migration-")), file = join(dir, "isolated.sqlite");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const seeded = openFootballStore(file);
  seeded.saveTactic(null, { tactic: collection().tactics[0], note: "迁移前版本" });
  const protectedData = JSON.stringify([seeded.listTactics(), seeded.exportCollection().versions]);
  seeded.close();
  const old = new DatabaseSync(file);
  old.exec("DROP TABLE tactic_collections; CREATE TABLE tactic_collections (collection_name TEXT PRIMARY KEY, tactic_ids TEXT NOT NULL, imported_at INTEGER NOT NULL) STRICT");
  old.prepare("INSERT INTO tactic_collections VALUES (?, ?, ?)").run("isolated-import", "[41]", 123); old.close();
  for (let turn = 0; turn < 2; turn++) {
    const s = openFootballStore(file);
    try {
      assert.equal(s.database.prepare("PRAGMA table_info(tactic_collections)").all().filter(c => c.name === "payload_hash").length, 1);
      assert.equal(JSON.stringify([s.listTactics(), s.exportCollection().versions]), protectedData);
      const before = rows(s), input = collection(); input.tactics[0].title += turn;
      const result = s.importCollection(input);
      assert.equal(result.receiptVerification, "legacy-unverified"); assert.equal(result.importedCount, 0);
      assert.deepEqual(result.tacticIds, [41]); assert.equal(rows(s), before);
      assert.deepEqual({ ...s.database.prepare("SELECT * FROM tactic_collections").get() },
        { collection_name: "isolated-import", tactic_ids: "[41]", imported_at: 123, payload_hash: null });
    } finally { s.close(); }
  }
});

test("不带请求名的传统追加导入保留原响应和语义", (t) => {
  const s = store(t), input = collection(); delete input.collectionName;
  const first = s.importCollection(input), second = s.importCollection(input);
  assert.equal(first.receiptVerification, undefined); assert.equal(second.importedCount, 1);
  assert.notDeepEqual(first.tacticIds, second.tacticIds);
  assert.equal(s.database.prepare("SELECT count(*) n FROM tactic_collections").get().n, 0);
});

for (const invalid of ["deep", "circular", "bigint"]) test("命名导入不可序列化内容返回400且零写入：" + invalid, (t) => {
  const s = store(t), input = collection(), before = rows(s);
  if (invalid === "deep") {
    let cursor = input.tactics[0].extra = {};
    for (let i = 0; i < 15000; i++) cursor = cursor.next = {};
  } else if (invalid === "circular") input.tactics[0].extra = input;
  else input.tactics[0].extra = 1n;
  assert.throws(() => s.importCollection(input), { status: 400 });
  assert.equal(rows(s), before);
  assert.equal(s.importCollection(collection()).importedCount, 1);
});
