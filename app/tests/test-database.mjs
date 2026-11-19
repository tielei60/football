import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

const markerName = ".football-playwright-owned";
const markerContent = "Disposable football Playwright database\n";

export function createTestDatabase() {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "football-playwright-"));
  writeFileSync(join(directory, markerName), markerContent, { flag: "wx", mode: 0o600 });
  return join(directory, "test.sqlite");
}

export function testDatabaseDirectory(databasePath) {
  if (typeof databasePath !== "string" || !databasePath) throw new Error("Missing isolated Playwright database path.");
  const path = resolve(databasePath);
  const directory = dirname(path);
  if (
    path !== databasePath ||
    basename(path) !== "test.sqlite" ||
    !/^football-playwright-[a-zA-Z0-9]+$/.test(basename(directory)) ||
    dirname(directory) !== realpathSync(tmpdir()) ||
    lstatSync(directory).isSymbolicLink() ||
    realpathSync(directory) !== directory ||
    lstatSync(join(directory, markerName)).isSymbolicLink() ||
    readFileSync(join(directory, markerName), "utf8") !== markerContent
  )
    throw new Error("Refusing to alter a database outside an owned Playwright temporary directory.");
  return directory;
}

function resetClubTestDataAttempt(databasePath) {
  testDatabaseDirectory(databasePath);
  if (!lstatSync(databasePath).isFile() || lstatSync(databasePath).isSymbolicLink()) {
    throw new Error("Refusing to open a non-regular Playwright database.");
  }
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;");
    try {
      database.exec(`
        DELETE FROM club_guest_registration;
        DELETE FROM club_guest_match_access;
        DELETE FROM club_match_shares;
        DELETE FROM club_match_tactics;
        DELETE FROM club_match_tactic_snapshots;
        DELETE FROM club_season_roster;
        DELETE FROM club_rsvps;
        DELETE FROM club_roster;
        DELETE FROM club_matches;
        DELETE FROM club_seasons;
        DELETE FROM club_sessions;
        DELETE FROM club_wechat_identities WHERE user_id IN (SELECT id FROM club_users WHERE role = 'player');
        DELETE FROM club_users WHERE role = 'player';
        DELETE FROM club_players;
        UPDATE club_teams SET name='我的球队',crest=NULL,revision=1 WHERE id=1;
        DELETE FROM tactic_collections;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

// Never block Playwright's event loop while a preceding HTTP request is finishing.
// Each attempt closes its connection; permanent errors and persistent locks fail visibly.
export async function resetClubTestData(databasePath, { timeoutMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      resetClubTestDataAttempt(databasePath);
      return;
    } catch (error) {
      if (error.errcode !== 5 && error.errcode !== 6) throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          "Playwright database stayed locked after prior contexts closed; investigate an outstanding server transaction.",
          { cause: error }
        );
      }
      // Each SQLite lock retry must wait for the previous attempt to finish.
      // eslint-disable-next-line no-await-in-loop
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }
}

export function removeTestDatabase(databasePath) {
  rmSync(testDatabaseDirectory(databasePath), { recursive: true, force: true });
}
