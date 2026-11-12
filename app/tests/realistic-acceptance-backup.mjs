import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { testDatabaseDirectory } from "./test-database.mjs";

export function assertPrivateRowsEqual(actual, expected) {
  assert.ok(isDeepStrictEqual(actual, expected), "Restored persisted rows differ (values omitted).");
}

export function verifyAcceptanceBackup(source) {
  const owned = testDatabaseDirectory(source);
  const stat = lstatSync(source);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    realpathSync(source) !== source ||
    dirname(realpathSync(source)) !== owned
  ) {
    throw new Error("Refusing to open a non-regular or redirected Playwright database.");
  }
  const directory = mkdtempSync(join(tmpdir(), "football-acceptance-restore-"));
  try {
    const backup = join(directory, "backup.sqlite");
    const restored = join(directory, "restored.sqlite");
    execFileSync(process.execPath, [fileURLToPath(new URL("../../scripts/backup.mjs", import.meta.url)), backup], {
      env: { ...process.env, FOOTBALL_DB_PATH: source },
      encoding: "utf8",
    });
    copyFileSync(backup, restored); // Offline new destination, never replace a running database.
    const original = new DatabaseSync(source, { readOnly: true });
    const copy = new DatabaseSync(restored, { readOnly: true });
    try {
      assert.equal(copy.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.equal(copy.prepare("PRAGMA foreign_key_check").all().length, 0, "Restored foreign key check failed.");
      const tables = original
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all();
      tables.forEach(({ name }) => {
        const quoted = `"${name.replaceAll('"', '""')}"`;
        // Never pass private rows into an AssertionError, which would dump hashes/tokens on failure.
        assertPrivateRowsEqual(
          copy.prepare(`SELECT * FROM ${quoted} ORDER BY rowid`).all(),
          original.prepare(`SELECT * FROM ${quoted} ORDER BY rowid`).all()
        );
      });
      assert.ok(copy.prepare("SELECT count(*) AS count FROM club_matches").get().count >= 2);
      // eslint-disable-next-line no-console -- CLI summary intentionally excludes row values.
      console.log(`restored database verified: ${tables.length} tables, integrity and exact persisted rows match`);
    } finally {
      copy.close();
      original.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  verifyAcceptanceBackup(process.argv[2]);
