import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createWechatProvider } from "./wechat-provider.mjs";
import { createWechatInviteStore } from "./wechat-invite-store.mjs";
const appId = "wx0123456789abcdef";
function provider(data = { openid: "fictional-wechat" }) {
  return createWechatProvider({
    enabled: true,
    appId,
    appSecret: "fictional-secret-not-production",
    fetchImpl: async () =>
      new Response(JSON.stringify({ session_key: "fictional-key", ...data })),
  });
}
async function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE club_players(id TEXT,team_id INTEGER,status TEXT,PRIMARY KEY(team_id,id));
 CREATE TABLE club_users(id INTEGER PRIMARY KEY,team_id INTEGER,role TEXT);
 INSERT INTO club_players VALUES('p1',1,'active'),('p2',2,'active');INSERT INTO club_users VALUES(1,1,'admin'),(2,1,'player'),(3,2,'admin');
 CREATE TABLE test_bindings(app TEXT,openid TEXT,user_id INTEGER,UNIQUE(app,openid));`);
  const p = provider(),
    identity = await p.exchange("fictional-code");
  let clock = 10000,
    bindingFails = false;
  const options = {
    enabled: true,
    now: () => clock,
    isVerifiedIdentity: p.isVerifiedIdentity,
    authorize: ({ actor, teamId, playerId }) => {
      const user = db.prepare("SELECT * FROM club_users WHERE id=?").get(actor);
      const target = db
        .prepare("SELECT * FROM club_players WHERE id=? AND team_id=?")
        .get(playerId, teamId);
      return (
        user && {
          actorId: user.id,
          teamId: user.team_id,
          playerId,
          role: user.role,
          active: target?.status === "active",
        }
      );
    },
    bindIdentity: ({ db: connection, appId, openid }) => {
      assert.equal(connection, db);
      connection
        .prepare("INSERT INTO test_bindings VALUES(?,?,?)")
        .run(appId, openid, 7);
      if (bindingFails) throw Error("binding rejected");
      return { userId: 7 };
    },
  };
  const store = createWechatInviteStore(db, options);
  store.initialize();
  const create = (extra = {}) =>
    store.create(1, {
      teamId: 1,
      playerId: "p1",
      appId,
      requestId: "create-1",
      ...extra,
    });
  return {
    db,
    p,
    identity,
    store,
    options,
    create,
    setTime: (v) => (clock = v),
    failBinding: () => (bindingFails = true),
  };
}
test("disabled provider never fetches; disabled store never migrates", () => {
  let calls = 0;
  const p = createWechatProvider({ fetchImpl: () => calls++ });
  return assert
    .rejects(p.exchange("x"), (e) => e.status === 503)
    .then(() => {
      assert.equal(calls, 0);
      const db = new DatabaseSync(":memory:");
      try {
        assert.throws(
          () => createWechatInviteStore(db).initialize(),
          (e) => e.status === 503,
        );
        assert.equal(
          db
            .prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'")
            .get().n,
          0,
        );
      } finally {
        db.close();
      }
    });
});
test("exchange uses fixed HTTPS endpoint, denies redirect and excludes secrets from identity", async () => {
  let request;
  const p = createWechatProvider({
    enabled: true,
    appId,
    appSecret: "fictional-private-secret",
    fetchImpl: async (url, opts) => {
      request = { url, opts };
      return new Response(
        JSON.stringify({ openid: "abc_-123", session_key: "secret-response" }),
      );
    },
  });
  const id = await p.exchange("fake-code");
  assert.equal(request.url.origin, "https://api.weixin.qq.com");
  assert.equal(request.url.pathname, "/sns/jscode2session");
  assert.equal(request.opts.redirect, "error");
  assert.deepEqual(id, { appId, openid: "abc_-123" });
  assert.equal(p.isVerifiedIdentity({ ...id }), false);
  assert.equal(p.isVerifiedIdentity(id), true);
  assert.ok(Object.isFrozen(id));
});
test("provider sanitizes upstream exceptions, invalid identities, oversize and nonzero errors", async () => {
  for (const fetchImpl of [
    async () => {
      throw Error("SECRET_CODE_URL");
    },
    async () => new Response("not json"),
    async () =>
      new Response(
        JSON.stringify({ errcode: 40029, errmsg: "SECRET_CODE", openid: "a" }),
      ),
    async () =>
      new Response(JSON.stringify({ openid: "a", extra: "x".repeat(17000) })),
  ]) {
    const p = createWechatProvider({
      enabled: true,
      appId,
      appSecret: "fictional-private-secret",
      fetchImpl,
    });
    await assert.rejects(
      p.exchange("fake-code"),
      (e) => !e.message.includes("SECRET") && e.status >= 400,
    );
  }
});
test("timeout aborts bounded exchange without exposing request", async () => {
  const p = createWechatProvider({
    enabled: true,
    appId,
    appSecret: "fictional-private-secret",
    timeoutMs: 5,
    fetchImpl: (_, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(Error("SECRET"))),
      ),
  });
  await assert.rejects(
    p.exchange("fake-code"),
    (e) => e.status === 502 && !e.message.includes("SECRET"),
  );
});
test("creation hashes credential; replay cannot recover; same id different input conflicts", async (t) => {
  const h = await fixture(t),
    a = h.create(),
    row = h.db.prepare("SELECT * FROM wechat_invites_foundation").get();
  assert.match(a.credential, /^[a-f0-9]{64}$/);
  assert.notEqual(row.token_hash, a.credential);
  assert.ok(!JSON.stringify(row).includes(a.credential));
  const replay = h.create();
  assert.equal(replay.credentialUnavailable, true);
  assert.equal(replay.credential, undefined);
  assert.throws(
    () => h.create({ ttlMs: 1000 }),
    (e) => e.status === 409,
  );
  assert.throws(
    () => h.create({ requestId: "other" }),
    (e) => e.status === 409,
  );
});
test("fresh authority rejects nonadmin/cross-team/archived and missing or async dependencies", async (t) => {
  const h = await fixture(t);
  for (const actor of [2, 3])
    assert.throws(
      () =>
        h.store.create(actor, {
          teamId: 1,
          playerId: "p1",
          appId,
          requestId: "x",
        }),
      (e) => e.status === 403,
    );
  assert.throws(
    () => createWechatInviteStore(h.db, { enabled: true }),
    (e) => e.status === 503,
  );
  assert.throws(
    () =>
      createWechatInviteStore(h.db, {
        ...h.options,
        authorize: async () => true,
      }),
    (e) => e.status === 503,
  );
  h.db.exec("UPDATE club_players SET status='inactive' WHERE id='p1'");
  assert.throws(
    () => h.create(),
    (e) => e.status === 403,
  );
});
test("claim requires branded verified identity and pending claim grants no session/data", async (t) => {
  const h = await fixture(t),
    a = h.create();
  assert.throws(
    () =>
      h.store.claim(
        { ...h.identity },
        { credential: a.credential, requestId: "claim1" },
      ),
    (e) => e.status === 401,
  );
  const claim = h.store.claim(h.identity, {
    credential: a.credential,
    requestId: "claim1",
  });
  assert.deepEqual(Object.keys(claim).sort(), [
    "confirmationCode",
    "id",
    "revision",
    "status",
  ]);
  assert.deepEqual(
    h.store.claim(h.identity, {
      credential: a.credential,
      requestId: "claim1",
    }),
    claim,
  );
  assert.deepEqual(
    h.store.claim(h.identity, {
      credential: a.credential,
      requestId: "different",
    }),
    claim,
  );
  const approved = h.store.decide(1, {
    id: a.id,
    revision: claim.revision,
    confirmationCode: claim.confirmationCode,
    action: "approve",
  });
  assert.equal(approved.status, "approved");
  assert.equal(h.db.prepare("SELECT count(*) n FROM test_bindings").get().n, 1);
  assert.throws(
    () =>
      h.store.decide(1, {
        id: a.id,
        revision: claim.revision,
        confirmationCode: claim.confirmationCode,
        action: "approve",
      }),
    (e) => e.status === 409,
  );
});
test("approval binder failure rolls back binding and invitation atomically", async (t) => {
  const h = await fixture(t),
    a = h.create(),
    c = h.store.claim(h.identity, {
      credential: a.credential,
      requestId: "claim",
    });
  h.failBinding();
  assert.throws(() =>
    h.store.decide(1, {
      id: a.id,
      revision: c.revision,
      confirmationCode: c.confirmationCode,
      action: "approve",
    }),
  );
  assert.equal(h.db.prepare("SELECT count(*) n FROM test_bindings").get().n, 0);
  assert.equal(h.store.inspect(1, a.id).status, "claimed");
});
test("expiry, revocation, archival and current role are rechecked", async (t) => {
  const h = await fixture(t),
    a = h.create({ ttlMs: 1000 });
  h.setTime(11000);
  assert.throws(
    () =>
      h.store.claim(h.identity, { credential: a.credential, requestId: "x" }),
    (e) => e.status === 409,
  );
  const b = h.create({ requestId: "b" });
  h.db.exec("UPDATE club_players SET status='inactive' WHERE id='p1'");
  assert.throws(
    () =>
      h.store.claim(h.identity, { credential: b.credential, requestId: "x" }),
    (e) => e.status === 409,
  );
  h.db.exec("UPDATE club_players SET status='active' WHERE id='p1'");
  assert.throws(
    () =>
      h.store.claim(h.identity, { credential: b.credential, requestId: "x" }),
    (e) => e.status === 409,
  );
  const fresh = h.create({ requestId: "after-reactivation" });
  const c = h.store.claim(h.identity, {
    credential: fresh.credential,
    requestId: "x",
  });
  h.db.exec("UPDATE club_users SET role='player' WHERE id=1");
  assert.throws(
    () =>
      h.store.decide(1, {
        id: fresh.id,
        revision: c.revision,
        action: "approve",
      }),
    (e) => e.status === 403,
  );
  h.db.exec("UPDATE club_users SET role='admin' WHERE id=1");
  h.store.decide(1, { id: fresh.id, revision: c.revision, action: "revoke" });
  assert.throws(
    () =>
      h.store.claim(h.identity, { credential: b.credential, requestId: "x" }),
    (e) => e.status === 409,
  );
});
test("schema initialization repeatable and no existing auth schema mutation", async (t) => {
  const h = await fixture(t);
  const before = h.db
    .prepare("SELECT sql FROM sqlite_master WHERE name='club_users'")
    .get().sql;
  h.store.initialize();
  assert.equal(
    h.db.prepare("SELECT sql FROM sqlite_master WHERE name='club_users'").get()
      .sql,
    before,
  );
  assert.equal(
    h.db
      .prepare(
        "SELECT count(*) n FROM sqlite_master WHERE name='club_sessions'",
      )
      .get().n,
    0,
  );
});

test("same player id in different teams does not block invitation creation", async (t) => {
  const h = await fixture(t);
  h.db.exec("INSERT INTO club_players VALUES('p1',2,'active')");
  const a = h.create();
  const b = h.store.create(3, {
    teamId: 2,
    playerId: "p1",
    appId,
    requestId: "team2",
  });
  assert.notEqual(a.id, b.id);
  assert.equal(b.teamId, 2);
});
test("missing session key cannot establish verified identity", async () => {
  const p = createWechatProvider({
    enabled: true,
    appId,
    appSecret: "fictional-private-secret",
    fetchImpl: async () => new Response(JSON.stringify({ openid: "a" })),
  });
  await assert.rejects(p.exchange("fake-code"), (e) => e.status === 401);
});

test("核对码非凭据，错误核对拒绝且不绑定；仅申请本人及授权管理员可读", async (t) => {
  const h = await fixture(t),
    a = h.create();
  const c = h.store.claim(h.identity, {
    credential: a.credential,
    requestId: "claim",
  });
  assert.match(c.confirmationCode, /^[A-F0-9]{8}$/);
  assert.equal(h.store.inspect(1, a.id).confirmationCode, c.confirmationCode);
  assert.deepEqual(h.store.claimStatus(h.identity, a.id), c);
  for (const confirmationCode of [undefined, "0000000Z"]) {
    assert.throws(
      () =>
        h.store.decide(1, {
          id: a.id,
          revision: c.revision,
          action: "approve",
          confirmationCode,
        }),
      (e) => e.status === 409,
    );
  }
  assert.equal(h.db.prepare("SELECT count(*) n FROM test_bindings").get().n, 0);
  assert.throws(
    () =>
      h.store.claim(h.identity, {
        credential: c.confirmationCode,
        requestId: "guess",
      }),
    (e) => e.status === 400,
  );
  const other = provider({ openid: "other" });
  const otherIdentity = await other.exchange("other-code");
  const alternateStore = createWechatInviteStore(h.db, {
    ...h.options,
    isVerifiedIdentity: other.isVerifiedIdentity,
  });
  assert.throws(
    () => alternateStore.claimStatus(otherIdentity, a.id),
    (e) => e.status === 404,
  );
  const otherAppStore = createWechatInviteStore(h.db, {
    ...h.options,
    isVerifiedIdentity: () => true,
  });
  assert.throws(
    () =>
      otherAppStore.claimStatus(
        { appId: "wx1111111111111111", openid: h.identity.openid },
        a.id,
      ),
    (e) => e.status === 404,
  );
  assert.throws(
    () => h.store.list(3, { appId, teamId: 1, playerId: "p1" }),
    (e) => e.status === 403,
  );
  assert.throws(
    () => h.store.list(2, { appId, teamId: 1, playerId: "p1" }),
    (e) => e.status === 403,
  );
  const list = h.store.list(1, { appId, teamId: 1, playerId: "p1", limit: 1 });
  assert.equal(list.items[0].confirmationCode, c.confirmationCode);
  assert.equal(list.nextCursor, null);
  assert.equal(JSON.stringify(list).includes(a.credential), false);
  for (const input of [
    { teamId: 1, playerId: "p1", limit: 51 },
    { teamId: 1, playerId: "p1", cursor: "sql" },
    { teamId: 1, playerId: "p1", role: "admin" },
  ])
    assert.throws(
      () => h.store.list(1, input),
      (e) => e.status === 400,
    );
});
test("分页不重复、过期状态可见且不发业务会话", async (t) => {
  const h = await fixture(t);
  for (let i = 0; i < 3; i++) {
    const a = h.create({ requestId: "page-" + i });
    h.store.decide(1, { id: a.id, revision: a.revision, action: "revoke" });
  }
  const first = h.store.list(1, { appId, teamId: 1, playerId: "p1", limit: 2 });
  const second = h.store.list(1, {
    appId,
    teamId: 1,
    playerId: "p1",
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.equal(
    new Set([...first.items, ...second.items].map((x) => x.id)).size,
    3,
  );
  assert.equal(second.nextCursor, null);
  const a = h.create({ requestId: "expiry", ttlMs: 1000 });
  h.store.claim(h.identity, { credential: a.credential, requestId: "claim" });
  h.setTime(11000);
  assert.equal(h.store.claimStatus(h.identity, a.id).status, "expired");
});
test("旧表增加确认码列，旧待审批安全撤销；重复初始化稳定", async (t) => {
  const h = await fixture(t),
    a = h.create();
  h.store.claim(h.identity, { credential: a.credential, requestId: "old" });
  h.db.exec(
    "ALTER TABLE wechat_invites_foundation DROP COLUMN claim_confirmation_code",
  );
  h.store.initialize();
  assert.equal(h.store.inspect(1, a.id).status, "revoked");
  assert.equal(h.store.inspect(1, a.id).confirmationCode, null);
  h.store.initialize();
  assert.equal(h.store.inspect(1, a.id).status, "revoked");
});
test("待处理容量上限拒绝新增但允许查询和同请求重放", async (t) => {
  const h = await fixture(t),
    a = h.create();
  const insert = h.db.prepare(
    `INSERT INTO wechat_invites_foundation(id,team_id,player_id,app_id,actor_id,request_id,request_hash,token_hash,expires_at,status) VALUES(?,1,?,?,1,?,'hash',?,999999,'pending')`,
  );
  for (let i = 0; i < 999; i++) {
    const id = "capacity-" + i;
    h.db.prepare("INSERT INTO club_players VALUES(?,1,'active')").run(id);
    insert.run(id, id, appId, id, id);
  }
  assert.equal(h.create().credentialUnavailable, true);
  h.db.prepare("INSERT INTO club_players VALUES('extra',1,'active')").run();
  assert.throws(
    () => h.create({ playerId: "extra", requestId: "extra" }),
    (e) => e.status === 429,
  );
  assert.equal(h.store.inspect(1, a.id).status, "pending");
});

test("邀请列表及cursor严格隔离AppID", async (t) => {
  const h = await fixture(t),
    a = h.create();
  h.store.claim(h.identity, { credential: a.credential, requestId: "claim" });
  const otherApp = "wx1111111111111111";
  const b = h.create({ appId: otherApp, requestId: "other-app" });
  const result = h.store.list(1, {
    teamId: 1,
    playerId: "p1",
    appId: otherApp,
  });
  assert.deepEqual(
    result.items.map((x) => x.id),
    [b.id],
  );
  assert.equal(result.items[0].confirmationCode, null);
  assert.throws(
    () =>
      h.store.list(1, {
        teamId: 1,
        playerId: "p1",
        appId: otherApp,
        cursor: a.id,
      }),
    (e) => e.status === 400,
  );
  assert.throws(
    () => h.store.list(1, { teamId: 1, playerId: "p1" }),
    (e) => e.status === 400,
  );
});
test("旧表迁移失败回滚新增列，后续可安全重试", async (t) => {
  const h = await fixture(t),
    a = h.create();
  h.store.claim(h.identity, { credential: a.credential, requestId: "claim" });
  h.db
    .exec(`ALTER TABLE wechat_invites_foundation DROP COLUMN claim_confirmation_code;
    CREATE TRIGGER reject_migration BEFORE UPDATE ON wechat_invites_foundation BEGIN SELECT RAISE(ABORT,'test migration failure'); END;`);
  assert.throws(() => h.store.initialize());
  assert.equal(
    h.db
      .prepare("PRAGMA table_info(wechat_invites_foundation)")
      .all()
      .some((x) => x.name === "claim_confirmation_code"),
    false,
  );
  assert.equal(
    h.db.prepare("SELECT status FROM wechat_invites_foundation").get().status,
    "claimed",
  );
  h.db.exec("DROP TRIGGER reject_migration");
  h.store.initialize();
  assert.equal(h.store.inspect(1, a.id).status, "revoked");
});

test("待处理邀请独立于历史分页返回，过期后为空", async (t) => {
  const h = await fixture(t);
  for (let i = 0; i < 4; i++) {
    const old = h.create({ requestId: "history-" + i });
    h.store.decide(1, { id: old.id, revision: old.revision, action: "revoke" });
  }
  const current = h.create({ requestId: "active", ttlMs: 1000 });
  const claim = h.store.claim(h.identity, {
    credential: current.credential,
    requestId: "claim",
  });
  let cursor = null,
    count = 0;
  do {
    const page = h.store.list(1, {
      appId,
      teamId: 1,
      playerId: "p1",
      limit: 1,
      cursor,
    });
    assert.equal(page.activeInvite.id, current.id);
    assert.equal(page.activeInvite.confirmationCode, claim.confirmationCode);
    count += page.items.length;
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(count, 5);
  h.setTime(11000);
  assert.equal(
    h.store.list(1, { appId, teamId: 1, playerId: "p1" }).activeInvite,
    null,
  );
  assert.equal(
    h.store.list(1, { appId: "wx1111111111111111", teamId: 1, playerId: "p1" })
      .activeInvite,
    null,
  );
});

test("认领丢响应后新requestId恢复同一申请，不改初次请求/版本且不授权其他身份", async (t) => {
  const h = await fixture(t),
    a = h.create();
  const original = h.store.claim(h.identity, {
    credential: a.credential,
    requestId: "first-attempt",
  });
  const restarted = createWechatInviteStore(h.db, h.options);
  restarted.initialize();
  const newVerifiedIdentity = await h.p.exchange("fictional-new-login-code");
  assert.deepEqual(
    restarted.claim(newVerifiedIdentity, {
      credential: a.credential,
      requestId: "after-restart",
    }),
    original,
  );
  const row = h.db
    .prepare("SELECT * FROM wechat_invites_foundation WHERE id=?")
    .get(a.id);
  assert.equal(row.claim_request_id, "first-attempt");
  assert.equal(row.revision, original.revision);
  assert.equal(h.db.prepare("SELECT count(*) n FROM test_bindings").get().n, 0);
  const p = provider({ openid: "other-person" }),
    other = await p.exchange("other-code");
  const otherStore = createWechatInviteStore(h.db, {
    ...h.options,
    isVerifiedIdentity: p.isVerifiedIdentity,
  });
  assert.throws(
    () =>
      otherStore.claim(other, {
        credential: a.credential,
        requestId: "after-restart",
      }),
    (e) => e.status === 409,
  );
  assert.throws(
    () =>
      restarted.claim(
        { ...newVerifiedIdentity },
        { credential: a.credential, requestId: "copy" },
      ),
    (e) => e.status === 401,
  );
  restarted.decide(1, {
    id: a.id,
    revision: original.revision,
    action: "approve",
    confirmationCode: original.confirmationCode,
  });
  assert.equal(
    restarted.claim(newVerifiedIdentity, {
      credential: a.credential,
      requestId: "after-approved",
    }).status,
    "approved",
  );
});

for (const terminal of [
  "approved",
  "rejected",
  "revoked",
  "expired",
  "derived-expired",
]) {
  test(`本人${terminal}终态恢复只读，重开及新请求不复活申请或授权他人`, async (t) => {
    const h = await fixture(t),
      a = h.create({ ttlMs: 1000 });
    const c = h.store.claim(h.identity, {
      credential: a.credential,
      requestId: "original",
    });
    if (terminal === "derived-expired") h.setTime(11000);
    else if (terminal === "expired") {
      h.setTime(11000);
      h.store.claimStatus(h.identity, a.id);
    } else
      h.store.decide(1, {
        id: a.id,
        revision: c.revision,
        action: { approved: "approve", rejected: "reject", revoked: "revoke" }[
          terminal
        ],
        confirmationCode: c.confirmationCode,
      });
    const before = h.db
      .prepare("SELECT * FROM wechat_invites_foundation WHERE id=?")
      .get(a.id);
    const bindings = h.db.prepare("SELECT * FROM test_bindings").all();
    const restarted = createWechatInviteStore(h.db, h.options);
    restarted.initialize();
    const identity = await h.p.exchange("new-verified-code");
    const recovered = restarted.claim(identity, {
      credential: a.credential,
      requestId: "new-after-restart",
    });
    assert.equal(
      recovered.status,
      terminal === "derived-expired" ? "expired" : terminal,
    );
    assert.equal(recovered.revision, before.revision);
    assert.equal(recovered.confirmationCode, c.confirmationCode);
    assert.equal(recovered.token, undefined);
    assert.equal(recovered.playerId, undefined);
    assert.deepEqual(
      h.db
        .prepare("SELECT * FROM wechat_invites_foundation WHERE id=?")
        .get(a.id),
      before,
    );
    assert.deepEqual(
      h.db.prepare("SELECT * FROM test_bindings").all(),
      bindings,
    );
    const otherProvider = provider({ openid: "different-person" });
    const foreignProvider = createWechatProvider({
      enabled: true,
      appId: "wx1111111111111111",
      appSecret: "fictional-secret-for-tests",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ openid: identity.openid, session_key: "fictional" }),
        ),
    });
    for (const p of [otherProvider, foreignProvider]) {
      const other = await p.exchange("another-code");
      const store = createWechatInviteStore(h.db, {
        ...h.options,
        isVerifiedIdentity: p.isVerifiedIdentity,
      });
      assert.throws(
        () =>
          store.claim(other, { credential: a.credential, requestId: "other" }),
        (e) => e.status === 409,
      );
    }
    assert.throws(
      () =>
        restarted.claim(
          { ...identity },
          { credential: a.credential, requestId: "forged" },
        ),
      (e) => e.status === 401,
    );
    assert.throws(
      () =>
        restarted.claim(identity, {
          credential: "f".repeat(64),
          requestId: "wrong-secret",
        }),
      (e) => e.status === 409,
    );
    assert.deepEqual(
      h.db
        .prepare("SELECT * FROM wechat_invites_foundation WHERE id=?")
        .get(a.id),
      before,
    );
  });
}
