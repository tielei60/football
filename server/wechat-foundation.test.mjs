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
  assert.deepEqual(Object.keys(claim).sort(), ["id", "revision", "status"]);
  assert.deepEqual(
    h.store.claim(h.identity, {
      credential: a.credential,
      requestId: "claim1",
    }),
    claim,
  );
  assert.throws(
    () =>
      h.store.claim(h.identity, {
        credential: a.credential,
        requestId: "different",
      }),
    (e) => e.status === 409,
  );
  const approved = h.store.decide(1, {
    id: a.id,
    revision: claim.revision,
    action: "approve",
  });
  assert.equal(approved.status, "approved");
  assert.equal(h.db.prepare("SELECT count(*) n FROM test_bindings").get().n, 1);
  assert.throws(
    () =>
      h.store.decide(1, {
        id: a.id,
        revision: claim.revision,
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
    h.store.decide(1, { id: a.id, revision: c.revision, action: "approve" }),
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
