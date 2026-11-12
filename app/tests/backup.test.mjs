import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const script = fileURLToPath(new URL("../../scripts/backup.mjs", import.meta.url));
test("backup captures a live WAL database with private file permissions", () => {
  const directory = mkdtempSync(join(tmpdir(), "football-backup-test-"));
  const source = join(directory, "live.sqlite");
  const target = join(directory, "private", "backup.sqlite");
  const database = new DatabaseSync(source);
  try {
    database.exec("PRAGMA journal_mode=WAL; CREATE TABLE records(value TEXT); INSERT INTO records VALUES ('committed WAL record')");
    const result = spawnSync(process.execPath, [script, target], {
      env: { ...process.env, FOOTBALL_DB_PATH: source }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.equal(copy.prepare("SELECT value FROM records").get().value, "committed WAL record");
    } finally { copy.close(); }
    if (process.platform !== "win32") {
      assert.equal(statSync(target).mode & 0o777, 0o600);
      assert.equal(statSync(join(directory, "private")).mode & 0o777, 0o700);
    }
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});
test("backup refuses missing sources and never overwrites existing destinations", () => {
  const directory = mkdtempSync(join(tmpdir(), "football-backup-test-"));
  const source = join(directory, "live.sqlite");
  const target = join(directory, "keep.sqlite");
  try {
    writeFileSync(target, "do not overwrite");
    let result = spawnSync(process.execPath, [script, target], {
      env: { ...process.env, FOOTBALL_DB_PATH: source }, encoding: "utf8",
    });
    assert.equal(result.status, 1);
    const database = new DatabaseSync(source);
    database.exec("CREATE TABLE records(value TEXT)");
    database.close();
    result = spawnSync(process.execPath, [script, target], {
      env: { ...process.env, FOOTBALL_DB_PATH: source }, encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(target, "utf8"), "do not overwrite");
    result = spawnSync(process.execPath, [script, source], {
      env: { ...process.env, FOOTBALL_DB_PATH: source }, encoding: "utf8",
    });
    assert.equal(result.status, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
