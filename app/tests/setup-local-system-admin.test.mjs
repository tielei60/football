import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeLocalSystemAdmin, parseLocalSetupArguments, main } from "../../scripts/setup-local-system-admin.mjs";
import { openFootballStore } from "../../server/football-store.mjs";
import { createClubStore } from "../../server/club-store.mjs";
test("本机setup不接受参数/管道凭据", async () => {
  assert.throws(() => parseLocalSetupArguments(["--password", "anonymous"]));
  assert.throws(() => parseLocalSetupArguments(["--db", "anything"]));
  if (!process.stdin.isTTY) await assert.rejects(main([]), /交互终端/);
});
test("短初始密码只哈希且强制改密、重复或重名不覆盖、异常回滚", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "football-setup-test-"));
  fs.chmodSync(dir, 0o700);
  const store = openFootballStore(join(dir, "db.sqlite"));
  try {
    const club = createClubStore(store.database, store, {
      bootstrapAdmin: { username: "existing-local", password: "anonymous-existing-password" },
    });
    const before = store.database.prepare("SELECT * FROM club_users").all();
    assert.throws(
      () => initializeLocalSystemAdmin(store.database, { username: "existing-local", initialPassword: "temp-a" }),
      /禁止覆盖/
    );
    assert.deepEqual(store.database.prepare("SELECT * FROM club_users").all(), before);
    assert.throws(
      () => initializeLocalSystemAdmin(store.database, { username: "new-local", initialPassword: "x" }),
      /临时密码/
    );
    assert.throws(
      () =>
        initializeLocalSystemAdmin(store.database, { username: "new-local", initialPassword: "temp-a", teamId: 999 }),
      /球队不存在/
    );
    const r = initializeLocalSystemAdmin(store.database, { username: "new-local", initialPassword: "temp-a" });
    assert.equal(r.mustChangePassword, true);
    const row = store.database.prepare("SELECT * FROM club_users WHERE id=?").get(r.id);
    assert.match(row.password_hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
    assert.ok(!JSON.stringify(row).includes("temp-a"));
    assert.equal(row.player_id, null);
    assert.equal(row.is_system_admin, 1);
    assert.throws(
      () => initializeLocalSystemAdmin(store.database, { username: "another-local", initialPassword: "temp-b" }),
      /禁止重复/
    );
    assert.equal(store.database.prepare("SELECT count(*) n FROM club_users").get().n, 2);
    const login = club.login({ username: "new-local", password: "temp-a" }, "test", "native");
    assert.equal(login.user.mustChangePassword, true);
    createClubStore(store.database, store, {
      bootstrapAdmin: { username: "unexpected-bootstrap", password: "anonymous-extra-password" },
    });
    assert.equal(
      store.database.prepare("SELECT count(*) n FROM club_users WHERE username='unexpected-bootstrap'").get().n,
      0
    );
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
