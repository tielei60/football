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
const credentials = {
  username: "fictional-guest-safety-admin",
  password: "fictional-isolated-password",
};

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "football-guest-safety-"));
  const databasePath = join(dir, "anonymous.sqlite");
  let hold;
  const server = createFootballServer({
    databasePath,
    bootstrapAdmin: credentials,
    wechat: {
      enabled: true,
      appId: "wx0123456789abcdef",
      appSecret: "fake-guest-test-secret",
      async fetchImpl(url) {
        const code = new URL(url).searchParams.get("js_code");
        assert.ok(code, "test must only call the synthetic WeChat code exchange");
        if (hold && code === hold.code) {
          hold.started();
          await hold.wait;
        }
        return Response.json({ openid: code, session_key: "not-a-real-key" });
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const db = new DatabaseSync(databasePath, { readOnly: true });
  t.after(async () => {
    hold?.finish();
    db.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + server.address().port + "/api";
  function call(route, { method = "GET", data, token, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(base + route, {
        method,
        headers: {
          "content-type": "application/json",
          "x-football-client": "native-v1",
          ...(token ? { authorization: "Bearer " + token } : {}),
          ...headers,
        },
      }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (part) => { body += part; });
        response.on("error", reject);
        response.on("end", () => {
          try { resolve({ status: response.statusCode, body: JSON.parse(body) }); }
          catch (error) { reject(error); }
        });
      });
      req.on("error", reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
  }
  const login = await call("/auth/native-login", { method: "POST", data: credentials });
  assert.equal(login.status, 200);
  const token = login.body.token;
  const avatar = "data:image/png;base64," + (await sharp({
    create: { width: 28, height: 28, channels: 4, background: "#341a6c" },
  }).png().toBuffer()).toString("base64");
  function pauseProvider(code) {
    let started, finish;
    const seen = new Promise((resolve) => { started = resolve; });
    const wait = new Promise((resolve) => { finish = resolve; });
    hold = { code, started, wait, finish };
    return { seen, finish };
  }
  function seedLegacyOpponentSnapshot(matchId) {
    const fixtureDb = new DatabaseSync(databasePath);
    try {
      fixtureDb.prepare("UPDATE club_matches SET opponent_snapshot=? WHERE id=?").run(JSON.stringify({
        name: "虚构历史对手", logo: null,
        playerSummary: "LEGACY_OPPONENT_PRIVATE_SUMMARY", introduction: "LEGACY_OPPONENT_INTERNAL_NOTE",
      }), matchId);
    } finally { fixtureDb.close(); }
  }
  return { call, token, db, avatar, pauseProvider, seedLegacyOpponentSnapshot };
}

async function matchAndLink(h, opponent, more = {}) {
  const saved = await h.call("/matches", {
    method: "POST",
    token: h.token,
    data: { opponent, status: "published", date: "2099-11-18", kickoff: "19:30", ...more },
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const route = "/matches/" + saved.body.id;
  const share = await h.call(route + "/share-link", { method: "POST", token: h.token, data: {} });
  assert.equal(share.status, 200, JSON.stringify(share.body));
  assert.match(share.body.shareToken, /^[a-f0-9]{64}$/);
  return { route, ...saved.body, shareToken: share.body.shareToken };
}
const entry = (h, match, code) => h.call("/auth/wechat/match-entry", {
  method: "POST", data: { code, shareToken: match.shareToken },
});
function register(h, registrationToken, n) {
  return h.call("/auth/wechat/match-register", {
    method: "POST",
    data: {
      registrationToken, response: "yes", requestId: "fictional-request-" + n,
      realName: "虚构访客" + n, nickname: "隔离测试" + n, avatar: h.avatar,
    },
  });
}
function counters(db) {
  return Object.fromEntries(["club_players", "club_users", "club_wechat_identities", "club_rsvps"].map(
    (table) => [table, db.prepare("SELECT count(*) AS n FROM " + table).get().n],
  ));
}

test("two first-time guest submissions compete atomically for the final spot", { timeout: 15000 }, async (t) => {
  const h = await setup(t);
  const match = await matchAndLink(h, "虚构末位比赛", { maxParticipants: 1 });
  const before = counters(h.db);
  const entries = await Promise.all([entry(h, match, "fictional-cap-a"), entry(h, match, "fictional-cap-b")]);
  for (const e of entries) {
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.equal(e.body.needsProfile, true);
  }
  const registrations = await Promise.all(entries.map((e, i) => register(h, e.body.registrationToken, i + 1)));
  const allowed = registrations.findIndex((result) => result.status >= 200 && result.status < 300);
  assert.ok(allowed >= 0, JSON.stringify(registrations));
  assert.equal(registrations[1 - allowed].status, 409, JSON.stringify(registrations[1 - allowed].body));
  const expected = Object.fromEntries(Object.entries(before).map(([k, n]) => [k, n + 1]));
  assert.deepEqual(counters(h.db), expected, "loser must not leave a member, account, identity or RSVP");
  assert.equal(h.db.prepare("SELECT count(*) AS n FROM club_rsvps WHERE match_id=? AND response='yes'").get(match.id).n, 1);

  const replay = await register(h, entries[allowed].body.registrationToken, allowed + 1);
  assert.ok(replay.status >= 200 && replay.status < 300, JSON.stringify(replay.body));
  assert.equal(replay.body.user.playerId, registrations[allowed].body.user.playerId);
  assert.deepEqual(counters(h.db), expected, "the same receipt must not create a duplicate");
});

test("closing a match while WeChat is exchanging its code invalidates the pending public entry", { timeout: 15000 }, async (t) => {
  const h = await setup(t);
  const match = await matchAndLink(h, "虚构关闭比赛");
  const before = counters(h.db);
  const barrier = h.pauseProvider("fictional-delayed-entry");
  const waiting = entry(h, match, "fictional-delayed-entry");
  await Promise.race([barrier.seen, waiting.then((r) => assert.fail("exchange did not start: " + JSON.stringify(r)))]);
  try {
    const closed = await h.call(match.route, {
      method: "PUT", token: h.token, data: { revision: match.revision, status: "cancelled" },
    });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
  } finally {
    barrier.finish();
  }
  const result = await waiting;
  assert.ok([404, 409, 410].includes(result.status), JSON.stringify(result));
  assert.equal(result.body.registrationToken, undefined);
  assert.equal(result.body.token, undefined);
  assert.deepEqual(counters(h.db), before);
});

test("an admitted guest sees only their own scoped RSVP, never full team resources", { timeout: 15000 }, async (t) => {
  const h = await setup(t);
  const first = await matchAndLink(h, "虚构许可比赛");
  const unrelated = await matchAndLink(h, "虚构不相关比赛");
  h.seedLegacyOpponentSnapshot(first.id);
  const e = await entry(h, first, "fictional-scoped-person");
  assert.equal(e.status, 200, JSON.stringify(e.body));
  const signed = await register(h, e.body.registrationToken, 3);
  assert.ok(signed.status >= 200 && signed.status < 300, JSON.stringify(signed.body));
  const token = signed.body.token;
  const readOwn = await h.call("/guest-matches/" + first.shareToken, { token });
  assert.equal(readOwn.status, 200, JSON.stringify(readOwn.body));
  assert.doesNotMatch(JSON.stringify(readOwn.body), /roster|rsvps|openid|fictional-scoped-person|LEGACY_OPPONENT/);
  for (const route of [
    "/matches", first.route, unrelated.route, "/players", "/statistics?year=2099",
    "/seasons", "/venues", "/desk", "/system/accounts",
    "/guest-matches/" + unrelated.shareToken,
  ]) {
    const denied = await h.call(route, { token });
    assert.ok([401, 403, 404].includes(denied.status), route + " returned " + denied.status);
    assert.doesNotMatch(JSON.stringify(denied.body), /虚构许可比赛|虚构不相关比赛|虚构访客3/);
  }
  const foreignWrite = await h.call("/guest-matches/" + unrelated.shareToken + "/rsvp", {
    method: "PUT", token, data: { response: "yes" },
  });
  assert.ok([401, 403, 404].includes(foreignWrite.status), JSON.stringify(foreignWrite));
  const publicView = await h.call("/public/matches/" + first.shareToken);
  assert.equal(publicView.status, 200);
  assert.doesNotMatch(JSON.stringify(publicView.body), /fictional-scoped-person|虚构访客3|隔离测试3|roster|rsvps|LEGACY_OPPONENT/);
});
