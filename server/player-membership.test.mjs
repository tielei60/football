import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";
import { createFootballServer } from "./index.mjs";
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "membership-test-")),
    path = join(dir, "test.sqlite");
  let store = openFootballStore(path),
    club = createClubStore(store.database, store);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    get club() {
      return club;
    },
    reopen() {
      store.close();
      store = openFootballStore(path);
      club = createClubStore(store.database, store);
    },
  };
}
test("兼容迁移默认确认、幂等重开与缺字段保存不改变未知状态", (t) => {
  const f = fixture(t);
  let p = f.club.savePlayer(1, null, { name: "匿名资料" });
  assert.equal(p.membershipConfirmed, true);
  p = f.club.savePlayer(1, p.id, {
    revision: p.revision,
    membershipConfirmed: false,
  });
  assert.equal(p.status, "active");
  assert.equal(p.membershipConfirmed, false);
  p = f.club.savePlayer(1, p.id, {
    revision: p.revision,
    note: "仅备注",
    status: "inactive",
  });
  assert.equal(p.membershipConfirmed, false);
  assert.equal(f.club.listPlayers(1)[0].membershipConfirmed, false);
  f.reopen();
  assert.equal(f.club.getPlayer(1, p.id).membershipConfirmed, false);
  f.store.database.exec(
    "ALTER TABLE club_players DROP COLUMN membership_confirmed",
  );
  f.reopen();
  assert.equal(f.club.getPlayer(1, p.id).membershipConfirmed, true);
  assert.equal(f.club.getPlayer(1, p.id).status, "inactive");
});
test("确认字段严格布尔、同队CAS与显式确认不改变其他字段", (t) => {
  const f = fixture(t),
    p = f.club.savePlayer(1, null, {
      name: "匿名资料",
      membershipConfirmed: false,
    });
  for (const value of [null, 0, 1, "true", {}, []])
    assert.throws(
      () =>
        f.club.savePlayer(1, p.id, {
          revision: p.revision,
          membershipConfirmed: value,
        }),
      (e) => e.status === 400,
    );
  assert.throws(
    () =>
      f.club.savePlayer(1, p.id, {
        revision: p.revision + 1,
        membershipConfirmed: true,
      }),
    (e) => e.status === 409,
  );
  assert.throws(
    () =>
      f.club.savePlayer(2, p.id, {
        revision: p.revision,
        membershipConfirmed: true,
      }),
    (e) => e.status === 404,
  );
  const next = f.club.savePlayer(1, p.id, {
    revision: p.revision,
    membershipConfirmed: true,
  });
  assert.equal(next.membershipConfirmed, true);
  assert.equal(next.status, p.status);
  assert.equal(next.name, p.name);
  assert.equal(next.revision, p.revision + 1);
});
test("确认写入异常回滚整条资料和revision", (t) => {
  const f = fixture(t),
    p = f.club.savePlayer(1, null, {
      name: "匿名资料",
      membershipConfirmed: false,
    });
  f.store.database.exec(
    "CREATE TRIGGER reject_membership BEFORE UPDATE OF membership_confirmed ON club_players BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  assert.throws(() =>
    f.club.savePlayer(1, p.id, {
      revision: p.revision,
      name: "不应保留",
      membershipConfirmed: true,
    }),
  );
  assert.deepEqual(f.club.getPlayer(1, p.id), p);
});
test("HTTP仅管理员可以确认，玩家读得到未知状态但不能自证", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "membership-http-")),
    server = createFootballServer({
      databasePath: join(dir, "test.sqlite"),
      bootstrapAdmin: {
        username: "test-admin",
        password: "fictional-password",
      },
    });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await server.drained;
    rmSync(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port;
  async function call(path, method = "GET", body, cookie) {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const login = await call("/auth/login", "POST", {
    username: "test-admin",
    password: "fictional-password",
  });
  assert.equal(login.status, 200);
  const admin = login.cookie,
    created = await call(
      "/players",
      "POST",
      { name: "匿名球员", membershipConfirmed: false },
      admin,
    );
  assert.equal(created.status, 201);
  const p = created.body;
  assert.equal(p.membershipConfirmed, false);
  assert.equal(
    (await call("/players/" + p.id, "GET", undefined, admin)).body
      .membershipConfirmed,
    false,
  );
  assert.equal(
    (await call("/players", "GET", undefined, admin)).body[0]
      .membershipConfirmed,
    false,
  );
  const account = await call(
    "/players/" + p.id + "/account",
    "POST",
    { username: "test-player", password: "fictional-player-password" },
    admin,
  );
  assert.equal(account.status, 201);
  const member = await call("/auth/login", "POST", {
    username: "test-player",
    password: "fictional-player-password",
  });
  assert.equal(member.status, 200);
  assert.equal(
    (await call("/players/" + p.id, "GET", undefined, member.cookie)).body
      .membershipConfirmed,
    false,
  );
  assert.equal(
    (
      await call(
        "/players/" + p.id,
        "PUT",
        { revision: p.revision, membershipConfirmed: true },
        member.cookie,
      )
    ).status,
    403,
  );
  const saved = await call(
    "/players/" + p.id,
    "PUT",
    { revision: p.revision, membershipConfirmed: true },
    admin,
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.membershipConfirmed, true);
});

test("只改确认元数据不改历史名单、比赛统计和原操作status", (t) => {
  const f = fixture(t),
    u = { team_id: 1, role: "admin" },
    p = f.club.savePlayer(1, null, { name: "匿名历史球员", number: 8 }),
    season = f.club.saveSeason(1, null, {
      name: "匿名赛季",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
  f.club.saveSeasonRoster(1, season.id, {
    revision: season.revision,
    roster: [{ playerId: p.id }],
  });
  const match = f.club.saveMatch(u, null, {
    opponent: "匿名对手",
    date: "2026-02-01",
    seasonId: season.id,
    status: "completed",
    homeScore: 2,
    awayScore: 1,
  });
  f.club.saveRoster(u, match.id, {
    revision: match.revision,
    roster: [{ playerId: p.id, appeared: true, goals: 2, assists: 1 }],
  });
  const rows = () =>
      ["club_roster", "club_season_roster", "club_matches"].map((table) =>
        f.store.database.prepare(`SELECT * FROM ${table}`).all(),
      ),
    before = rows(),
    stats = f.club.statistics(u, new URLSearchParams("year=2026"));
  const saved = f.club.savePlayer(1, p.id, {
    revision: p.revision,
    membershipConfirmed: false,
  });
  assert.equal(saved.status, "active");
  assert.deepEqual(rows(), before);
  const after = f.club.statistics(u, new URLSearchParams("year=2026"));
  assert.deepEqual(after.team, stats.team);
  assert.equal(after.players[0].appearances, stats.players[0].appearances);
  assert.equal(after.players[0].goals, stats.players[0].goals);
  assert.equal(after.players[0].assists, stats.players[0].assists);
});

test("inactive资料仅改确认字段仍执行原归档撤权，不绕过会话和绑定撤销", (t) => {
  const f = fixture(t),
    db = f.store.database;
  let p = f.club.savePlayer(1, null, {
    name: "匿名撤权资料",
    status: "inactive",
  });
  // 隔离库模拟待清理的遗留绑定/会话，不创建可登录凭据。
  db.prepare(
    "INSERT INTO club_users(team_id,username,password_hash,role,player_id) VALUES(1,'synthetic-inactive','unusable','player',?)",
  ).run(p.id);
  const userId = db
    .prepare("SELECT id FROM club_users WHERE player_id=?")
    .get(p.id).id;
  db.prepare(
    "INSERT INTO club_sessions(token_hash,user_id,expires_at) VALUES('synthetic-unusable-session',?,?)",
  ).run(userId, Date.now() + 60000);
  db.prepare(
    "INSERT INTO club_wechat_identities(app_id,openid,user_id,created_at) VALUES('synthetic-app','synthetic-openid',?,?)",
  ).run(userId, Date.now());
  const epoch = db
    .prepare("SELECT revision FROM club_wechat_epoch WHERE id=1")
    .get().revision;
  p = f.club.savePlayer(1, p.id, {
    revision: p.revision,
    membershipConfirmed: false,
  });
  assert.equal(p.status, "inactive");
  assert.equal(p.membershipConfirmed, false);
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM club_sessions WHERE user_id=?")
      .get(userId).n,
    0,
  );
  const identity = db
    .prepare(
      "SELECT revision,revoked_at FROM club_wechat_identities WHERE user_id=?",
    )
    .get(userId);
  assert.equal(identity.revision, 2);
  assert.ok(identity.revoked_at);
  assert.equal(
    db.prepare("SELECT revision FROM club_wechat_epoch WHERE id=1").get()
      .revision,
    epoch + 1,
  );
});
