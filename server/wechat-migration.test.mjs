import { DatabaseSync } from "node:sqlite";
import { migrateWechatIdentity } from "./wechat-identity-store.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("old user/session columns migrate transactionally and retain original password sessions on repeat startup", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wechat-migration-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "test.sqlite");
  let legacy = openFootballStore(path);
  let club = createClubStore(legacy.database, legacy, {
    bootstrapAdmin: {
      username: "old-owner",
      password: "fictional-old-password",
    },
  });
  const native = club.login(
    { username: "old-owner", password: "fictional-old-password" },
    "test",
    "native",
  );
  const cookie = club.login(
    { username: "old-owner", password: "fictional-old-password" },
    "test",
  );
  // 重建旧版真实列集合，保留原密码哈希与两种会话。并不触碰用户数据库。
  legacy.database.exec(
    `ALTER TABLE club_sessions DROP COLUMN auth_method;ALTER TABLE club_sessions DROP COLUMN wechat_identity_id;ALTER TABLE club_sessions DROP COLUMN wechat_revision;ALTER TABLE club_users DROP COLUMN password_enabled;DROP TABLE club_wechat_identities;DROP TABLE club_wechat_epoch;DELETE FROM app_migrations WHERE migration_name='club-wechat-identity-v1';`,
  );
  legacy.close();
  for (let i = 0; i < 2; i++) {
    legacy = openFootballStore(path);
    club = createClubStore(legacy.database, legacy);
    assert.equal(club.authenticate(native.token, "native").role, "admin");
    assert.equal(club.authenticate(cookie.token).role, "admin");
    assert.equal(
      legacy.database.prepare("SELECT password_enabled FROM club_users").get()
        .password_enabled,
      1,
    );
    assert.equal(
      legacy.database
        .prepare(
          "SELECT count(*) n FROM club_sessions WHERE auth_method='password'",
        )
        .get().n,
      2,
    );
    assert.equal(club.wechat.enabled, false);
    legacy.close();
  }
});

test("identity schema migration interruption rolls back every added column and table", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      `CREATE TABLE club_users(id INTEGER PRIMARY KEY);CREATE TABLE club_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER,expires_at INTEGER);CREATE TABLE app_migrations(migration_name TEXT PRIMARY KEY,applied_at INTEGER);CREATE TRIGGER fail_auth_migration BEFORE INSERT ON app_migrations BEGIN SELECT RAISE(ABORT,'fictional migration failure');END;`,
    );
    assert.throws(
      () => migrateWechatIdentity(db),
      /fictional migration failure/,
    );
    assert.equal(
      db
        .prepare("PRAGMA table_info(club_users)")
        .all()
        .some((c) => c.name === "password_enabled"),
      false,
    );
    assert.equal(
      db
        .prepare("SELECT 1 FROM sqlite_master WHERE name='club_wechat_epoch'")
        .get(),
      undefined,
    );
    db.exec("DROP TRIGGER fail_auth_migration");
    migrateWechatIdentity(db);
    assert.equal(
      db
        .prepare("PRAGMA table_info(club_users)")
        .all()
        .some((c) => c.name === "password_enabled"),
      true,
    );
  } finally {
    db.close();
  }
});
