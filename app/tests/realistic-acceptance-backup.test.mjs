import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createTestDatabase, testDatabaseDirectory } from "./test-database.mjs";
import { assertPrivateRowsEqual } from "./realistic-acceptance-backup.mjs";

const script = fileURLToPath(new URL("./realistic-acceptance-backup.mjs", import.meta.url));
const secret = "sentinel-private-password-hash-and-session-token";
const run = (source) => spawnSync(process.execPath, [script, source], { encoding: "utf8" });
function populate(path) {
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE club_matches(id INTEGER PRIMARY KEY); INSERT INTO club_matches VALUES(1),(2); CREATE TABLE accounts(password_hash TEXT,session_token TEXT)"
  );
  db.prepare("INSERT INTO accounts VALUES(?,?)").run(secret, secret);
  db.close();
}

test("acceptance backup rejects a source symlink within a marked directory", () => {
  const source = createTestDatabase();
  const directory = testDatabaseDirectory(source);
  const outside = mkdtempSync(join(tmpdir(), "football-unowned-test-"));
  try {
    const target = join(outside, "private.sqlite");
    populate(target);
    symlinkSync(target, source);
    const result = run(source);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to open a non-regular or redirected/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("acceptance backup verifies regular owned database without logging sensitive rows", () => {
  const source = createTestDatabase();
  const directory = testDatabaseDirectory(source);
  try {
    populate(source);
    const result = run(source);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /restored database verified/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mismatched row diagnostics never contain password hashes or session tokens", () => {
  let caught;
  try {
    assertPrivateRowsEqual([{ password_hash: secret, session_token: secret }], [{ password_hash: "different" }]);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught);
  assert.match(caught.message, /values omitted/);
  assert.ok(!inspect(caught).includes(secret));
  assert.ok(!String(caught.stack).includes(secret));
  assert.equal(caught.actual, false);
  assert.equal(caught.expected, true);
});
