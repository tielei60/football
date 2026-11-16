import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createFootballServer } from "./index.mjs";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";
import { createWechatProvider } from "./wechat-provider.mjs";
const appId = "wx0123456789abcdef";
const credentials = {
  username: "test-owner",
  password: "fictional-owner-password",
};
async function fixture(t, { enabled = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "football-wechat-http-"));
  const databasePath = join(dir, "isolated.sqlite");
  let calls = 0,
    waiter;
  const server = createFootballServer({
    databasePath,
    bootstrapAdmin: credentials,
    wechat: {
      enabled,
      appId,
      appSecret: "fictional-test-secret-only",
      fetchImpl: async (url) => {
        calls++;
        const parsed = new URL(url);
        if (parsed.pathname === "/cgi-bin/token") return Response.json({ access_token: "fictional-token" });
        if (parsed.pathname === "/wxa/getwxacode") return new Response(Buffer.from("fictional-image"), { headers: { "content-type": "image/jpeg" } });
        const code = new URL(url).searchParams.get("js_code");
        if (waiter) {
          const w = waiter;
          waiter = null;
          w.started();
          await w.promise;
        }
        return new Response(
          JSON.stringify({
            openid: code,
            session_key: "fictional-session-key",
          }),
        );
      },
    },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const db = new DatabaseSync(databasePath);
  t.after(async () => {
    db.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  const call = (path, method = "GET", body, token, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        `http://127.0.0.1:${server.address().port}/api${path}`,
        {
          method,
          headers: {
            "content-type": "application/json",
            ...(token
              ? { authorization: `Bearer ${token}` }
              : { "x-football-client": "native-v1" }),
            ...headers,
          },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: data ? JSON.parse(data) : null,
              headers: res.headers,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const admin = (await call("/auth/native-login", "POST", credentials)).body
    .token;
  const manage = (path, method = "GET", body) =>
    call(path, method, body, admin);
  const player = async (name = "虚构队员") =>
    (await manage("/players", "POST", { name, number: null })).body;
  let serial = 0;
  const create = async (p) => {
    const r = await manage(`/players/${p.id}/wechat-invites`, "POST", {
      requestId: `test-create-${++serial}`,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const claim = async (inv, code = "fictional-identity") => {
    const r = await call("/auth/wechat/claim", "POST", {
      code,
      credential: inv.credential,
      requestId: `claim-${inv.id}`,
    });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    return r.body;
  };
  const approve = async (p, inv, c) => {
    const r = await manage(
      `/players/${p.id}/wechat-invites/${inv.id}/approve`,
      "POST",
      { revision: c.revision, confirmationCode: c.confirmationCode },
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body;
  };
  const bind = async (p, code = "fictional-identity") => {
    const i = await create(p),
      c = await claim(i, code);
    await approve(p, i, c);
    return { i, c };
  };
  const delay = () => {
    let release, started;
    const promise = new Promise((r) => (release = r)),
      ready = new Promise((r) => (started = r));
    waiter = { promise, started };
    return { release, ready };
  };
  return {
    db,
    call,
    manage,
    admin,
    player,
    create,
    claim,
    approve,
    bind,
    delay,
    calls: () => calls,
    databasePath,
  };
}
test("disabled capabilities are bool-only; exact native origin/body isolation before exchange", async (t) => {
  const f = await fixture(t, { enabled: false });
  assert.deepEqual((await f.call("/auth/capabilities")).body, {
    wechat: false,
    aiPhotos: false,
  });
  assert.equal(
    (await f.call("/auth/wechat/login", "POST", { code: "test" })).status,
    503,
  );
  assert.equal(f.calls(), 0);
  const on = await fixture(t);
  for (const headers of [
    { origin: "https://untrusted.invalid" },
    { cookie: "x=y" },
    { authorization: `Bearer ${on.admin}` },
    { "x-football-client": "wrong" },
    { "sec-fetch-site": "cross-site" },
  ])
    assert.ok(
      [400, 403].includes(
        (
          await on.call(
            "/auth/wechat/login",
            "POST",
            { code: "test" },
            null,
            headers,
          )
        ).status,
      ),
    );
  assert.equal(
    (
      await on.call("/auth/wechat/login", "POST", {
        code: "test",
        openid: "forged",
        role: "admin",
      })
    ).status,
    400,
  );
  assert.equal(
    (await on.call("/auth/wechat/login", "POST", { code: "x".repeat(18000) }))
      .status,
    413,
  );
  assert.equal(on.calls(), 0);
});
test("claim/confirmation/admin approval creates disabled-password player, hash-only native session; no account takeover", async (t) => {
  const f = await fixture(t),
    p = await f.player();
  const inv = await f.create(p),
    c = await f.claim(inv);
  assert.equal(c.token, undefined);
  assert.equal(c.playerId, undefined);
  assert.match(c.confirmationCode, /^[A-Z0-9]{6,12}$/);
  const list = await f.manage(`/players/${p.id}/wechat-invites`);
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].confirmationCode, c.confirmationCode);
  assert.equal(JSON.stringify(list.body).includes("openid"), false);
  assert.equal(JSON.stringify(list.body).includes(inv.credential), false);
  assert.equal(
    (
      await f.call("/auth/wechat/claim-status", "POST", {
        code: "different-person",
        inviteId: inv.id,
      })
    ).status,
    404,
  );
  assert.equal(
    (await f.call("/auth/wechat/login", "POST", { code: "fictional-identity" }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.manage(
        `/players/${p.id}/wechat-invites/${inv.id}/approve`,
        "POST",
        { revision: c.revision, confirmationCode: "WRONG123" },
      )
    ).status,
    409,
  );
  await f.approve(p, inv, c);
  const replay = await f.manage(`/players/${p.id}/wechat-invites`, "POST", {
    requestId: "test-create-1",
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.credentialUnavailable, true);
  assert.equal(replay.body.credential, undefined);
  const auth = await f.call("/auth/wechat/login", "POST", {
    code: "fictional-identity",
  });
  assert.equal(auth.status, 200);
  assert.equal(auth.body.user.role, "player");
  assert.equal(auth.body.user.passwordEnabled, false);
  assert.match(auth.body.token, /^native_[a-f0-9]{64}$/);
  assert.equal(auth.headers["cache-control"], "no-store");
  const u = f.db
    .prepare("SELECT * FROM club_users WHERE player_id=?")
    .get(p.id);
  assert.equal(u.password_enabled, 0);
  assert.notEqual(u.password_hash, "disabled");
  assert.equal(
    (
      await f.call("/auth/native-login", "POST", {
        username: u.username,
        password: u.password_hash,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.manage(`/players/${p.id}/password`, "PUT", {
        newPassword: "fictional-new-password",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call(
        "/auth/password",
        "PUT",
        {
          currentPassword: u.password_hash,
          newPassword: "fictional-new-password",
        },
        auth.body.token,
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.call("/players", "POST", { name: "forbidden" }, auth.body.token))
      .status,
    403,
  );
  assert.equal(
    (
      await f.call(
        `/players/${p.id}/wechat-invites`,
        "GET",
        undefined,
        auth.body.token,
      )
    ).status,
    403,
  );
  const row = f.db
    .prepare("SELECT * FROM club_sessions WHERE user_id=?")
    .get(u.id);
  assert.equal(row.auth_method, "wechat");
  assert.notEqual(row.token_hash, auth.body.token);
});
test("approval reuses password account; reset revokes both transports without changing binding", async (t) => {
  const f = await fixture(t),
    p = await f.player();
  const account = {
    username: "dual-test",
    password: "fictional-dual-password",
  };
  const a = await f.manage(`/players/${p.id}/account`, "POST", account);
  assert.equal(a.status, 201);
  const old = (await f.call("/auth/native-login", "POST", account)).body.token;
  await f.bind(p);
  const auth = await f.call("/auth/wechat/login", "POST", {
    code: "fictional-identity",
  });
  assert.equal(auth.body.user.id, a.body.id);
  assert.equal(
    (
      await f.manage(`/players/${p.id}/password`, "PUT", {
        newPassword: "new-fictional-password",
      })
    ).status,
    204,
  );
  for (const token of [old, auth.body.token])
    assert.equal(
      (await f.call("/auth/me", "GET", undefined, token)).status,
      401,
    );
  assert.equal(
    (await f.call("/auth/wechat/login", "POST", { code: "fictional-identity" }))
      .status,
    200,
  );
});
test("binding version is monotonic across identities and late exchanges reject unbind/rebind ABA", async (t) => {
  const f = await fixture(t),
    p = await f.player();
  await f.bind(p, "identity-a");
  const a = (await f.manage(`/players/${p.id}/wechat-binding`)).body;
  const old = (
    await f.call("/auth/wechat/login", "POST", { code: "identity-a" })
  ).body.token;
  const d = f.delay(),
    late = f.call("/auth/wechat/login", "POST", { code: "identity-a" });
  await d.ready;
  assert.equal(
    (
      await f.manage(`/players/${p.id}/wechat-binding/revoke`, "POST", {
        revision: a.revision,
      })
    ).status,
    200,
  );
  await f.bind(p, "identity-b");
  d.release();
  assert.equal((await late).status, 409);
  const b = (await f.manage(`/players/${p.id}/wechat-binding`)).body;
  assert.equal(b.bound, true);
  assert.ok(b.revision > a.revision);
  assert.equal(
    (
      await f.manage(`/players/${p.id}/wechat-binding/revoke`, "POST", {
        revision: a.revision,
      })
    ).status,
    409,
  );
  assert.equal((await f.call("/auth/me", "GET", undefined, old)).status, 401);
  assert.equal(
    (await f.call("/auth/wechat/login", "POST", { code: "identity-a" })).status,
    403,
  );
  assert.equal(
    (await f.call("/auth/wechat/login", "POST", { code: "identity-b" })).status,
    200,
  );
  const d2 = f.delay(),
    late2 = f.call("/auth/wechat/login", "POST", { code: "identity-b" });
  await d2.ready;
  await f.manage(`/players/${p.id}/wechat-binding/revoke`, "POST", {
    revision: b.revision,
  });
  await f.bind(p, "identity-b");
  d2.release();
  assert.equal((await late2).status, 409);
});
test("archive and restore revoke pending and approved identities permanently, including delayed claim", async (t) => {
  const f = await fixture(t),
    p = await f.player();
  const inv = await f.create(p);
  const d = f.delay(),
    late = f.call("/auth/wechat/claim", "POST", {
      code: "identity-archive",
      credential: inv.credential,
      requestId: "delayed",
    });
  await d.ready;
  let current = (await f.manage(`/players/${p.id}`)).body;
  assert.equal(
    (
      await f.manage(`/players/${p.id}`, "PUT", {
        ...current,
        status: "inactive",
      })
    ).status,
    200,
  );
  current = (await f.manage(`/players/${p.id}`)).body;
  await f.manage(`/players/${p.id}`, "PUT", { ...current, status: "active" });
  d.release();
  assert.equal((await late).status, 409);
  assert.equal(
    f.db
      .prepare("SELECT status FROM wechat_invites_foundation WHERE id=?")
      .get(inv.id).status,
    "revoked",
  );
  assert.equal(
    (
      await f.call("/auth/wechat/claim", "POST", {
        code: "identity-archive",
        credential: inv.credential,
        requestId: "fresh",
      })
    ).status,
    409,
  );
  await f.bind(p);
  const token = (
    await f.call("/auth/wechat/login", "POST", { code: "fictional-identity" })
  ).body.token;
  current = (await f.manage(`/players/${p.id}`)).body;
  await f.manage(`/players/${p.id}`, "PUT", { ...current, status: "inactive" });
  assert.equal((await f.call("/auth/me", "GET", undefined, token)).status, 401);
});
test("native preauth rates are bounded and do not trust forwarded IP or secret identity fields", async (t) => {
  const f = await fixture(t);
  let last;
  for (let i = 0; i < 31; i++)
    last = await f.call(
      "/auth/wechat/login",
      "POST",
      { code: "missing-binding" },
      null,
      { "x-forwarded-for": `10.1.1.${i}` },
    );
  assert.equal(last.status, 429);
  assert.equal(f.calls(), 30);
  assert.equal(JSON.stringify(last.body).includes("missing-binding"), false);
});
test("legacy tactical roster removal revokes invitations and bindings in same transaction", async (t) => {
  const f = await fixture(t);
  const member = (id) => ({
    playerId: id,
    name: "虚构战术球员",
    number: null,
    positions: ["前锋"],
    preferredFoot: "右",
    status: "ok",
    note: "",
    fieldPieceId: null,
  });
  const created = await f.manage("/coaching-desk", "PUT", {
    edition: 0,
    desk: {
      board: { pieces: [], markings: [] },
      players: [member("legacy-a"), member("legacy-b")],
      selectedTacticId: null,
    },
  });
  assert.equal(created.status, 200);
  const p = { id: "legacy-a" },
    b = { id: "legacy-b" };
  await f.bind(p);
  const pending = await f.create(b);
  const token = (
    await f.call("/auth/wechat/login", "POST", { code: "fictional-identity" })
  ).body.token;
  const before = (await f.manage("/coaching-desk")).body;
  const removed = await f.manage("/coaching-desk", "PUT", {
    edition: before.edition,
    desk: { ...before.desk, players: [] },
  });
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(
    f.db
      .prepare("SELECT status FROM wechat_invites_foundation WHERE id=?")
      .get(pending.id).status,
    "revoked",
  );
  assert.equal((await f.call("/auth/me", "GET", undefined, token)).status, 401);
  const restored = await f.manage("/coaching-desk", "PUT", {
    edition: removed.body.edition,
    desk: before.desk,
  });
  assert.equal(restored.status, 200);
  assert.equal(
    (await f.call("/auth/wechat/login", "POST", { code: "fictional-identity" }))
      .status,
    403,
  );
  assert.equal(
    (
      await f.call("/auth/wechat/claim", "POST", {
        code: "other",
        credential: pending.credential,
        requestId: "restore",
      })
    ).status,
    409,
  );
});
test("same identity cannot bind two players; failed approval rolls back user creation, old revision and admin logout rejected", async (t) => {
  const f = await fixture(t),
    a = await f.player("虚构甲"),
    b = await f.player("虚构乙");
  await f.bind(a);
  const i = await f.create(b),
    c = await f.claim(i);
  const approved = await f.manage(
    `/players/${b.id}/wechat-invites/${i.id}/approve`,
    "POST",
    { revision: c.revision, confirmationCode: c.confirmationCode },
  );
  assert.equal(approved.status, 409);
  assert.equal(
    f.db.prepare("SELECT 1 FROM club_users WHERE player_id=?").get(b.id),
    undefined,
  );
  assert.equal(
    f.db
      .prepare("SELECT status FROM wechat_invites_foundation WHERE id=?")
      .get(i.id).status,
    "claimed",
  );
  assert.equal(
    (
      await f.manage(`/players/${a.id}/wechat-invites/${i.id}/reject`, "POST", {
        revision: c.revision,
      })
    ).status,
    404,
  );
  await f.call("/auth/logout", "POST", {}, f.admin);
  assert.equal(
    (
      await f.manage(`/players/${b.id}/wechat-invites/${i.id}/reject`, "POST", {
        revision: c.revision,
      })
    ).status,
    401,
  );
});
test("cross-team admin cannot approve/list/revoke another team invitations", async (t) => {
  const f = await fixture(t),
    p = await f.player(),
    i = await f.create(p),
    c = await f.claim(i);
  f.db.exec("INSERT INTO club_teams(id,name) VALUES(2,'虚构外队')");
  // 仅测试库构建另队管理员；HTTP不允许客户端指定team/role。
  const owner = f.db
    .prepare("SELECT * FROM club_users WHERE username=?")
    .get(credentials.username);
  f.db
    .prepare(
      "INSERT INTO club_users(team_id,username,password_hash,role) VALUES(2,'other-owner',?,'admin')",
    )
    .run(owner.password_hash);
  const token = (
    await f.call("/auth/native-login", "POST", {
      username: "other-owner",
      password: credentials.password,
    })
  ).body.token;
  for (const [path, method, body] of [
    [`/players/${p.id}/wechat-invites`, "GET"],
    [
      `/players/${p.id}/wechat-invites/${i.id}/approve`,
      "POST",
      { revision: c.revision, confirmationCode: c.confirmationCode },
    ],
    [`/players/${p.id}/wechat-binding/revoke`, "POST", { revision: 0 }],
  ])
    assert.equal((await f.call(path, method, body, token)).status, 404);
});

test("disabling or changing configured AppID rejects old wechat sessions but preserves password sessions", async (t) => {
  const f = await fixture(t),
    p = await f.player();
  await f.bind(p);
  const token = (
    await f.call("/auth/wechat/login", "POST", { code: "fictional-identity" })
  ).body.token;
  const legacy = openFootballStore(f.databasePath);
  try {
    let club = createClubStore(legacy.database, legacy);
    assert.throws(
      () => club.authenticate(token, "native"),
      (e) => e.status === 401,
    );
    assert.equal(club.authenticate(f.admin, "native").role, "admin");
    const app2 = "wx1111111111111111";
    const provider = createWechatProvider({
      enabled: true,
      appId: app2,
      appSecret: "test-only-fictional-secret",
      fetchImpl: () => {
        throw Error("must not call");
      },
    });
    club = createClubStore(legacy.database, legacy, {
      wechatProvider: provider,
      wechatAppId: app2,
    });
    assert.throws(
      () => club.authenticate(token, "native"),
      (e) => e.status === 401,
    );
    assert.equal(club.authenticate(f.admin, "native").role, "admin");
    assert.equal(
      club.wechat.list({ token: f.admin, transport: "native" }, p.id, {}).items
        .length,
      0,
    );
  } finally {
    legacy.close();
  }
});
test("HTTP approved invitation recovery after unbind returns history only, no session or binding mutation", async (t) => {
  const f = await fixture(t),
    p = await f.player();
  const { i } = await f.bind(p, "identity-recovery");
  const binding = (await f.manage(`/players/${p.id}/wechat-binding`)).body;
  assert.equal(
    (
      await f.manage(`/players/${p.id}/wechat-binding/revoke`, "POST", {
        revision: binding.revision,
      })
    ).status,
    200,
  );
  const before = {
    invite: f.db
      .prepare("SELECT * FROM wechat_invites_foundation WHERE id=?")
      .get(i.id),
    bindings: f.db.prepare("SELECT * FROM club_wechat_identities").all(),
    epoch: f.db.prepare("SELECT * FROM club_wechat_epoch").all(),
    sessions: f.db.prepare("SELECT * FROM club_sessions").all(),
  };
  const result = await f.call("/auth/wechat/claim", "POST", {
    code: "identity-recovery",
    credential: i.credential,
    requestId: "after-restart-new-request",
  });
  assert.equal(result.status, 202);
  assert.equal(result.body.status, "approved");
  assert.equal(result.body.token, undefined);
  assert.equal(
    (await f.call("/auth/wechat/login", "POST", { code: "identity-recovery" }))
      .status,
    403,
  );
  assert.deepEqual(
    {
      invite: f.db
        .prepare("SELECT * FROM wechat_invites_foundation WHERE id=?")
        .get(i.id),
      bindings: f.db.prepare("SELECT * FROM club_wechat_identities").all(),
      epoch: f.db.prepare("SELECT * FROM club_wechat_epoch").all(),
      sessions: f.db.prepare("SELECT * FROM club_sessions").all(),
    },
    before,
  );
  assert.equal(
    (
      await f.call("/auth/wechat/claim", "POST", {
        code: "other-person",
        credential: i.credential,
        requestId: "other",
      })
    ).status,
    409,
  );
});

test("player password capability follows target same-team account across get/list/save without enabling WeChat passwords", async (t) => {
  const f = await fixture(t);
  const plain = await f.player("无账号模拟队员");
  const password = await f.player("密码模拟队员");
  const wechat = await f.player("微信模拟队员");
  assert.equal(plain.hasAccount, false);
  assert.equal(plain.passwordEnabled, false);
  assert.equal(
    (
      await f.manage(`/players/${password.id}/account`, "POST", {
        username: "fictional-password-player",
        password: "fictional-safe-password",
      })
    ).status,
    201,
  );
  await f.bind(wechat);
  for (const [player, hasAccount, enabled] of [
    [plain, false, false],
    [password, true, true],
    [wechat, true, false],
  ]) {
    const got = await f.manage(`/players/${player.id}`);
    const listed = (await f.manage("/players")).body.find(
      (p) => p.id === player.id,
    );
    const saved = await f.manage(`/players/${player.id}`, "PUT", {
      ...got.body,
      note: "虚构能力回归",
    });
    assert.equal(saved.status, 200);
    for (const view of [got.body, listed, saved.body]) {
      assert.equal(view.hasAccount, hasAccount);
      assert.equal(view.passwordEnabled, enabled);
      assert.equal(view.password_hash, undefined);
      assert.equal(view.username, undefined);
    }
  }
  assert.equal(
    (
      await f.manage(`/players/${wechat.id}/password`, "PUT", {
        newPassword: "fictional-no-implicit-enable",
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.manage(`/players/${wechat.id}`)).body.passwordEnabled,
    false,
  );
  // 仅隔离测试模拟旧资料中的越队引用；正常外键本已拒绝该形态。
  f.db.exec("PRAGMA foreign_keys=OFF");
  const adminRow = f.db
    .prepare("SELECT * FROM club_users WHERE role='admin'")
    .get();
  f.db
    .prepare("INSERT INTO club_teams(id,name) VALUES(?,?)")
    .run(999, "隔离外队");
  f.db
    .prepare(
      "INSERT INTO club_users(team_id,username,password_hash,role,player_id,password_enabled) VALUES(999,?,?, 'player',?,1)",
    )
    .run("foreign-fictional", adminRow.password_hash, plain.id);
  f.db.exec("PRAGMA foreign_keys=ON");
  const isolated = (await f.manage(`/players/${plain.id}`)).body;
  assert.equal(isolated.hasAccount, false);
  assert.equal(isolated.passwordEnabled, false);
});

test('invite card code requires an active matching invitation and administrator', async (t) => {
  const f = await fixture(t);
  const p = await f.player();
  const other = await f.player('另一名虚构球员');
  const inv = await f.create(p);
  const path = `/players/${p.id}/wechat-invites/${inv.id}/code`;
  assert.ok([401, 403].includes((await f.call(path, 'POST', { credential: inv.credential })).status));
  assert.equal((await f.manage(path, 'POST', { credential: 'a'.repeat(64) })).status, 409);
  assert.equal((await f.manage(`/players/${other.id}/wechat-invites/${inv.id}/code`, 'POST', { credential: inv.credential })).status, 404);
  const code = await f.manage(path, 'POST', { credential: inv.credential });
  assert.equal(code.status, 200);
  assert.match(code.body.image, /^data:image\/jpeg;base64,/);
  assert.equal((await f.manage(`/players/${p.id}/wechat-invites/${inv.id}/revoke`, 'POST', { revision: inv.revision })).status, 200);
  assert.equal((await f.manage(path, 'POST', { credential: inv.credential })).status, 409);
});
