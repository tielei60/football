import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { createFootballServer } from "./index.mjs";
const sharp = createRequire(new URL("../app/package.json", import.meta.url))("sharp");
const credentials = { username: "fictional-guest-admin", password: "fictional-isolated-password" };
async function fixture(t, { enabled = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "football-guest-flow-")),
    path = join(dir, "isolated.sqlite");
  let server,
    base,
    appId = "wx0123456789abcdef";
  const exchanges = [];
  const start = async () => {
    server = createFootballServer({
      databasePath: path,
      bootstrapAdmin: credentials,
      wechat: {
        enabled,
        appId,
        appSecret: "fictional-local-secret",
        fetchImpl: async (url) => {
          assert.equal(new URL(url).hostname, "api.weixin.qq.com");
          assert.equal(new URL(url).pathname, "/sns/jscode2session");
          const code = new URL(url).searchParams.get("js_code");
          exchanges.push(code);
          return Response.json({ openid: code, session_key: "fictional-not-used" });
        },
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = "http://127.0.0.1:" + server.address().port;
  };
  const stop = async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  };
  await start();
  const db = new DatabaseSync(path);
  t.after(async () => {
    db.close();
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  const call = (route, { method = "GET", body, token, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        base + "/api" + route,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Football-Client": "native-v1",
            ...(token ? { Authorization: "Bearer " + token } : {}),
            ...headers,
          },
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (data += c));
          res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
        }
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const login = async () => {
    const r = await call("/auth/native-login", { method: "POST", body: credentials });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.token;
  };
  const admin = await login(),
    avatar =
      "data:image/png;base64," +
      (
        await sharp({ create: { width: 20, height: 20, channels: 3, background: "#8844aa" } })
          .png()
          .toBuffer()
      ).toString("base64");
  const post = (route, body, token = admin) => call(route, { method: "POST", body, token });
  const match = async (extra = {}) => {
    const r = await post("/matches", {
      opponent: "虚构测试对手",
      date: "2099-12-31",
      kickoff: "20:00",
      status: "published",
      ...extra,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const entry = async (m, code = "fictional-openid") =>
    call("/auth/wechat/match-entry", { method: "POST", body: { code, shareToken: m.shareToken } });
  const register = (ticket, extra = {}) =>
    call("/auth/wechat/match-register", {
      method: "POST",
      body: {
        registrationToken: ticket,
        requestId: "fictional-onboarding",
        realName: "虚构参加人",
        nickname: "虚构昵称",
        avatar,
        response: "yes",
        ...extra,
      },
    });
  return {
    db,
    path,
    dir,
    call,
    post,
    admin,
    avatar,
    match,
    entry,
    register,
    exchanges,
    restart: async (newAppId) => {
      await stop();
      if (newAppId) appId = newAppId;
      await start();
    },
    legacyReset: async (work) => {
      await stop();
      work(db);
      await start();
    },
  };
}
const counts = (db) =>
  Object.fromEntries(
    ["club_players", "club_users", "club_wechat_identities", "club_guest_match_access", "club_rsvps"].map((name) => [
      name,
      db.prepare("SELECT count(*) n FROM " + name).get().n,
    ])
  );

test("first-time guest requires all profile fields, atomically joins once, and has only narrow own access", async (t) => {
  const h = await fixture(t),
    m = await h.match(),
    before = counts(h.db);
  assert.match(m.shareToken, /^[a-f0-9]{64}$/);
  assert.equal((await h.post("/matches/" + m.id + "/share-link", {})).body.shareToken, m.shareToken);
  const e = await h.entry(m);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.needsProfile, true);
  assert.equal(e.body.token, undefined);
  const ticket = e.body.registrationToken;
  for (const extra of [
    { realName: "" },
    { nickname: "" },
    { avatar: "" },
    { avatar: "https://example.invalid/avatar.png" },
    { avatar: "data:image/svg+xml;base64,PHN2Zy8+" },
    { avatar: "data:image/png;base64,aW52YWxpZA==" },
    { response: "maybe" },
    { role: "admin" },
    { playerId: "forged" },
  ]) {
    const r = await h.register(ticket, extra);
    assert.equal(r.status, 400, JSON.stringify(r.body));
    assert.deepEqual(counts(h.db), before);
  }
  const r = await h.register(ticket);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.membershipKind, "guest");
  assert.equal(r.body.user.role, "player");
  assert.equal(r.body.user.passwordEnabled, false);
  assert.equal(r.body.match.myResponse, "yes");
  assert.doesNotMatch(JSON.stringify(r.body), /openid|session_key|fictional-openid|password_hash/);
  const after = counts(h.db);
  assert.deepEqual(after, Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v + 1])));
  const p = (await h.call("/players/" + r.body.user.playerId, { token: h.admin })).body;
  assert.equal(p.nickname, "虚构昵称");
  assert.equal(p.name, "虚构参加人");
  assert.equal(p.membershipKind, "guest");
  assert.match(p.avatar, /^data:image\/jpeg;base64,/);
  const replay = await h.register(ticket);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.token, r.body.token);
  assert.deepEqual(counts(h.db), after);
  const changed = await h.register(ticket, { realName: "不允许改写" });
  assert.equal(changed.status, 409);
  assert.deepEqual(counts(h.db), after);
  const own = await h.call("/guest-matches/" + m.shareToken, { token: r.body.token });
  assert.equal(own.status, 200);
  assert.equal(own.body.myResponse, "yes");
  const denied = [
    "/team",
    "/players",
    "/players/" + p.id,
    "/matches",
    "/matches/" + m.id,
    "/matches/" + m.id + "/photos",
    "/statistics",
    "/seasons",
    "/venues",
    "/tactics",
    "/coaching-desk",
    "/auth/password",
  ];
  for (const route of denied) {
    const got = await h.call(route, { token: r.body.token });
    assert.equal(got.status, 403, route + JSON.stringify(got.body));
  }
  for (const response of ["no", "maybe", "yes"])
    assert.equal(
      (
        await h.call("/guest-matches/" + m.shareToken + "/rsvp", {
          method: "PUT",
          token: r.body.token,
          body: { response },
        })
      ).body.myResponse,
      response
    );
  assert.equal(
    (
      await h.call("/guest-matches/" + m.shareToken + "/rsvp", {
        method: "PUT",
        token: r.body.token,
        body: { response: "yes", playerId: "forged" },
      })
    ).status,
    400
  );
  assert.equal(
    (
      await h.call("/players/" + p.id + "/password", {
        method: "PUT",
        token: h.admin,
        body: { newPassword: "fictional-new-password" },
      })
    ).status,
    409
  );
  assert.equal(
    (await h.post("/players/" + p.id + "/account", { username: "fictional-duplicate", password: credentials.password }))
      .status,
    409
  );
  assert.equal(h.db.prepare("SELECT password_enabled FROM club_users WHERE player_id=?").get(p.id).password_enabled, 0);
  const normal = await h.call("/auth/wechat/login", { method: "POST", body: { code: "fictional-openid" } });
  assert.equal(normal.status, 403);
  const memberView = await h.call("/matches/" + m.id, { token: h.admin });
  assert.equal(memberView.body.rsvps[0].membershipKind, "guest");
});

test("same identity survives restart, duplicate names do not merge, promotion retains history and revokes replay/session authority", async (t) => {
  const h = await fixture(t),
    m = await h.match();
  const named = await h.post("/players", { name: "虚构参加人" });
  assert.equal(named.status, 201);
  const e = await h.entry(m),
    signed = await h.register(e.body.registrationToken);
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const id = signed.body.user.playerId,
    uid = signed.body.user.id;
  assert.notEqual(id, named.body.id);
  const profile = (await h.call("/players/" + id, { token: h.admin })).body;
  const roster = await h.call("/matches/" + m.id + "/roster", {
    method: "PUT",
    token: h.admin,
    body: {
      revision: m.revision,
      roster: [{ playerId: id, selection: "starter", position: "前锋", appeared: true, goals: 1, assists: 0 }],
    },
  });
  assert.equal(roster.status, 200, JSON.stringify(roster.body));
  const savedRoster = roster.body.roster;
  await h.restart();
  const resumed = await h.entry(m);
  assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
  assert.equal(resumed.body.needsProfile, false);
  assert.equal(resumed.body.user.playerId, id);
  assert.equal(resumed.body.user.id, uid);
  assert.equal(resumed.body.match.myResponse, "yes");
  assert.equal(
    (await h.register(e.body.registrationToken)).status,
    409,
    "after restart recover by fresh wx identity, never mint from old receipt"
  );
  const bad = await h.call("/players/" + id, {
    method: "PUT",
    token: h.admin,
    body: { revision: profile.revision, membershipKind: "member" },
  });
  assert.equal(bad.status, 400);
  assert.equal((await h.post("/players/" + id + "/promote", {})).status, 428);
  assert.equal((await h.post("/players/" + id + "/promote", { revision: 0 })).status, 428);
  assert.equal((await h.post("/players/" + id + "/promote", { revision: profile.revision + 10 })).status, 409);
  assert.equal(
    (await h.post("/players/" + id + "/promote", { revision: profile.revision }, resumed.body.token)).status,
    403
  );
  const promoted = await h.post("/players/" + id + "/promote", { revision: profile.revision });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.equal(promoted.body.id, id);
  assert.equal(promoted.body.membershipKind, "member");
  assert.equal(promoted.body.nickname, profile.nickname);
  for (const token of [signed.body.token, resumed.body.token])
    assert.equal((await h.call("/auth/me", { token })).status, 401);
  assert.equal(h.db.prepare("SELECT id FROM club_users WHERE player_id=?").get(id).id, uid);
  assert.equal(h.db.prepare("SELECT count(*) n FROM club_wechat_identities WHERE user_id=?").get(uid).n, 1);
  assert.equal(
    (await h.post("/players/" + id + "/promote", { revision: promoted.body.revision })).body.revision,
    promoted.body.revision,
    "fresh replay does not promote twice"
  );
  const normal = await h.call("/auth/wechat/login", { method: "POST", body: { code: "fictional-openid" } });
  assert.equal(normal.status, 200, JSON.stringify(normal.body));
  assert.equal(normal.body.user.membershipKind, "member");
  const detail = await h.call("/matches/" + m.id, { token: normal.body.token });
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.roster, savedRoster);
  assert.equal(detail.body.rsvps[0].playerId, id);
  assert.equal(detail.body.rsvps[0].membershipKind, "member");
});

test("logout and archival cannot be bypassed by onboarding receipts or fresh entry", async (t) => {
  const h = await fixture(t),
    m = await h.match(),
    e = await h.entry(m),
    signed = await h.register(e.body.registrationToken);
  assert.equal(signed.status, 200);
  await h.call("/auth/logout", { method: "POST", token: signed.body.token, body: {} });
  assert.equal((await h.register(e.body.registrationToken)).status, 409);
  const again = await h.entry(m);
  assert.equal(again.status, 200);
  const id = again.body.user.playerId;
  let p = (await h.call("/players/" + id, { token: h.admin })).body;
  const archived = await h.call("/players/" + id, {
    method: "PUT",
    token: h.admin,
    body: { revision: p.revision, status: "inactive" },
  });
  assert.equal(archived.status, 200);
  assert.equal((await h.entry(m)).status, 403);
  assert.equal((await h.call("/auth/me", { token: again.body.token })).status, 401);
  assert.equal((await h.register(e.body.registrationToken)).status, 409);
  const restored = await h.call("/players/" + id, {
    method: "PUT",
    token: h.admin,
    body: { revision: archived.body.revision, status: "active" },
  });
  assert.equal(restored.status, 200);
  assert.equal((await h.entry(m)).status, 403, "restoring profile does not silently restore revoked binding");
  const pending = await h.entry(m, "fictional-pending");
  assert.equal(pending.status, 200);
  h.db.prepare("UPDATE club_wechat_epoch SET revision=revision+1 WHERE id=1").run();
  const before = counts(h.db);
  assert.equal((await h.register(pending.body.registrationToken)).status, 409);
  assert.deepEqual(counts(h.db), before);
});

test("China-time guest cutoff is explicit while regular-member past-match RSVP behavior remains unchanged", async (t) => {
  const h = await fixture(t),
    m = await h.match();
  assert.equal((await h.call("/public/matches/" + m.shareToken)).body.signupClosesAt, "2099-12-31T12:00:00.000Z");
  const noTime = await h.match({ kickoff: "" });
  assert.equal((await h.call("/public/matches/" + noTime.shareToken)).body.signupClosesAt, "2099-12-31T15:59:59.999Z");
  const old = await h.match({ date: "2000-01-01" });
  assert.equal((await h.entry(old, "fictional-too-late")).status, 409);
  const e = await h.entry(m),
    signed = await h.register(e.body.registrationToken);
  assert.equal(signed.status, 200);
  const edited = await h.call("/matches/" + m.id, {
    method: "PUT",
    token: h.admin,
    body: { revision: m.revision, date: "2000-01-01" },
  });
  assert.equal(edited.status, 200);
  assert.equal(
    (
      await h.call("/guest-matches/" + m.shareToken + "/rsvp", {
        method: "PUT",
        token: signed.body.token,
        body: { response: "no" },
      })
    ).status,
    200
  );
  assert.equal(
    (
      await h.call("/guest-matches/" + m.shareToken + "/rsvp", {
        method: "PUT",
        token: signed.body.token,
        body: { response: "yes" },
      })
    ).status,
    409
  );
  const p = (await h.call("/players/" + signed.body.user.playerId, { token: h.admin })).body;
  await h.post("/players/" + p.id + "/promote", { revision: p.revision });
  const member = await h.entry(m);
  assert.equal(member.status, 200);
  assert.equal(
    (
      await h.call("/guest-matches/" + m.shareToken + "/rsvp", {
        method: "PUT",
        token: member.body.token,
        body: { response: "yes" },
      })
    ).status,
    200
  );
  assert.equal(
    (
      await h.call("/matches/" + old.id + "/rsvp", {
        method: "PUT",
        token: member.body.token,
        body: { response: "yes" },
      })
    ).status,
    200
  );
  const latest = (await h.call("/matches/" + m.id, { token: h.admin })).body;
  await h.call("/matches/" + m.id, {
    method: "PUT",
    token: h.admin,
    body: { revision: latest.revision, status: "draft" },
  });
  assert.equal((await h.call("/public/matches/" + m.shareToken)).status, 404);
});

test("strict unauthenticated transport and expired credentials do not create identities", async (t) => {
  const h = await fixture(t),
    m = await h.match(),
    before = counts(h.db);
  for (const headers of [
    { Origin: "https://example.invalid" },
    { Cookie: "football_session=fake" },
    { "Sec-Fetch-Mode": "cors" },
  ])
    assert.equal(
      (
        await h.call("/auth/wechat/match-entry", {
          method: "POST",
          body: { code: "fictional-code", shareToken: m.shareToken },
          headers,
        })
      ).status,
      403
    );
  assert.equal(
    (
      await h.call("/auth/wechat/match-entry", {
        method: "POST",
        body: { code: "fictional-code", shareToken: m.shareToken },
        token: h.admin,
      })
    ).status,
    400
  );
  assert.equal((await h.call("/public/matches/" + "0".repeat(64))).status, 404);
  const e = await h.entry(m);
  h.db.prepare("UPDATE club_guest_registration SET expires_at=0").run();
  assert.equal((await h.register(e.body.registrationToken)).status, 401);
  assert.deepEqual(counts(h.db), before);
});

test("legacy players remain members and repeated migrations do not infer or overwrite guest status or history", async (t) => {
  const h = await fixture(t),
    p = (await h.post("/players", { name: "虚构原有队员", number: 8 })).body;
  await h.legacyReset((db) => {
    db.exec(
      "DROP TABLE club_guest_registration; DROP TABLE club_guest_match_access; DROP TABLE club_match_shares; ALTER TABLE club_players DROP COLUMN membership_kind; ALTER TABLE club_players DROP COLUMN nickname; DELETE FROM app_migrations WHERE migration_name='club-guest-matches-v1'"
    );
  });
  const restored = (await h.call("/players/" + p.id, { token: h.admin })).body;
  assert.equal(restored.membershipKind, "member");
  assert.equal(restored.nickname, "");
  assert.equal(restored.name, p.name);
  assert.equal(restored.number, 8);
  assert.equal(restored.revision, p.revision);
  const m = await h.match(),
    e = await h.entry(m),
    r = await h.register(e.body.registrationToken);
  assert.equal(r.status, 200);
  const before = h.db.prepare("SELECT * FROM club_players ORDER BY id").all();
  const links = h.db.prepare("SELECT * FROM club_guest_match_access").all();
  await h.restart();
  await h.restart();
  assert.deepEqual(h.db.prepare("SELECT * FROM club_players ORDER BY id").all(), before);
  assert.deepEqual(h.db.prepare("SELECT * FROM club_guest_match_access").all(), links);
});

test("concurrent same identity tickets create only one player, and existing authorizations are not rebound across teams", async (t) => {
  const h = await fixture(t),
    m = await h.match();
  const entries = await Promise.all([h.entry(m, "fictional-one-person"), h.entry(m, "fictional-one-person")]);
  const before = counts(h.db);
  const results = await Promise.all(
    entries.map((r, i) => h.register(r.body.registrationToken, { requestId: "fictional-duplicate-" + i }))
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.deepEqual(counts(h.db), Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v + 1])));
  const success = results.find((r) => r.status === 200);
  h.db.prepare("UPDATE club_users SET account_enabled=0 WHERE id=?").run(success.body.user.id);
  assert.equal((await h.entry(m, "fictional-one-person")).status, 403);
  assert.equal((await h.call("/auth/me", { token: success.body.token })).status, 401);
  h.db.prepare("UPDATE club_users SET account_enabled=1 WHERE id=?").run(success.body.user.id);
  h.db.exec(
    "INSERT INTO club_teams(id,name) VALUES(2,'虚构其他球队'); INSERT INTO club_players(id,team_id,name,positions) VALUES('foreign-member',2,'虚构其他成员','[]'); INSERT INTO club_users(team_id,username,password_hash,password_enabled,role,player_id) VALUES(2,'foreign-account','disabled',0,'player','foreign-member')"
  );
  const otherUser = h.db.prepare("SELECT id FROM club_users WHERE username='foreign-account'").get().id;
  h.db
    .prepare(
      "INSERT INTO club_wechat_identities(app_id,openid,user_id,created_at) VALUES('wx0123456789abcdef','fictional-other-team',?,?)"
    )
    .run(otherUser, Date.now());
  const stable = counts(h.db);
  assert.equal((await h.entry(m, "fictional-other-team")).status, 403);
  assert.deepEqual(counts(h.db), stable);
});

test("disabled WeChat rejects public enrollment without exchanging or creating any identity", async (t) => {
  const h = await fixture(t, { enabled: false }),
    m = await h.match(),
    before = counts(h.db);
  assert.equal((await h.call("/public/matches/" + m.shareToken)).status, 200);
  assert.equal((await h.entry(m)).status, 503);
  assert.equal((await h.register("a".repeat(64))).status, 503);
  assert.equal(h.exchanges.length, 0);
  assert.deepEqual(counts(h.db), before);
});

test("an outstanding named-player WeChat claim cannot be silently replaced by a duplicate guest profile", async (t) => {
  const h = await fixture(t),
    m = await h.match(),
    p = (await h.post("/players", { name: "虚构已有档案" })).body;
  const pending = await h.entry(m, "fictional-claimed-person");
  assert.equal(pending.status, 200);
  const invite = await h.post("/players/" + p.id + "/wechat-invites", { requestId: "fictional-existing-invite" });
  assert.equal(invite.status, 201, JSON.stringify(invite.body));
  const claim = await h.call("/auth/wechat/claim", {
    method: "POST",
    body: {
      code: "fictional-claimed-person",
      credential: invite.body.credential,
      requestId: "fictional-existing-claim",
    },
  });
  assert.equal(claim.status, 202, JSON.stringify(claim.body));
  const before = counts(h.db),
    savedClaim = h.db.prepare("SELECT * FROM wechat_invites_foundation WHERE id=?").get(invite.body.id);
  assert.equal((await h.entry(m, "fictional-claimed-person")).status, 409);
  assert.equal((await h.register(pending.body.registrationToken)).status, 409);
  assert.deepEqual(counts(h.db), before);
  assert.deepEqual(h.db.prepare("SELECT * FROM wechat_invites_foundation WHERE id=?").get(invite.body.id), savedClaim);
});

test("a pending ticket issued by a previous AppID cannot create an identity after configuration changes", async (t) => {
  const h = await fixture(t),
    m = await h.match(),
    old = await h.entry(m, "fictional-app-isolation");
  assert.equal(old.status, 200);
  const before = counts(h.db);
  await h.restart("wxfedcba9876543210");
  const rejected = await h.register(old.body.registrationToken);
  assert.equal(rejected.status, 401);
  assert.deepEqual(counts(h.db), before);
  const current = await h.entry(m, "fictional-app-isolation");
  assert.equal(current.status, 200);
  const signed = await h.register(current.body.registrationToken);
  assert.equal(signed.status, 200);
  assert.equal(
    h.db.prepare("SELECT app_id FROM club_wechat_identities WHERE user_id=?").get(signed.body.user.id).app_id,
    "wxfedcba9876543210"
  );
});
