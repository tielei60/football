import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFootballServer } from "./index.mjs";
import { createLocalPlayerAiProvider } from "./player-ai-local-provider.mjs";
async function fixture(t, enabled = true, aiOverride = {}) {
  const directory = await mkdtemp(join(tmpdir(), "ai-http-isolated-"));
  const credentials = {
    username: "fixture-admin",
    password: "fixture-password-not-real",
  };
  const server = createFootballServer({
    databasePath: join(directory, "isolated.sqlite"),
    bootstrapAdmin: credentials,
    publicOrigin: "",
    secureCookies: false,
    trustedProxyAddresses: [],
    wechat: { enabled: false },
    aiPhotos: enabled
      ? {
          enabled: true,
          provider: createLocalPlayerAiProvider(),
          policy: {
            mode: "local-simulation",
            currency: "XXX",
            amountMinor: 0,
            version: "simulation-v1",
            lifetimeMs: 3600000,
          },
          ...aiOverride,
        }
      : undefined,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(directory, { recursive: true, force: true });
  });
  const call = (path, method = "GET", body, token, extra = {}) =>
    new Promise((resolve, reject) => {
      const req = request(
        `http://127.0.0.1:${server.address().port}/api${path}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(body !== undefined
              ? { "Content-Length": Buffer.byteLength(JSON.stringify(body)) }
              : {}),
            "X-Football-Client": "native-v1",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...extra,
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              body: raw ? JSON.parse(raw) : null,
              headers: res.headers,
            }),
          );
        },
      );
      req.on("error", reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  const token = (await call("/auth/native-login", "POST", credentials)).body
    .token;
  const admin = (path, method = "GET", body) => call(path, method, body, token);
  const player = (
    await admin("/players", "POST", { name: "匿名合成目标", number: null })
  ).body;
  const prefix = `/players/${player.id}/ai`;
  const ai = (path, method = "GET", body) => admin(prefix + path, method, body);
  return {
    call,
    admin,
    ai,
    player,
    prefix,
    token,
    databasePath: join(directory, "isolated.sqlite"),
  };
}
async function prepare(f, purpose = "portrait") {
  const sourceConsent = await f.ai("/consents", "POST", {
    requestId: randomUUID(),
    purpose: "private-ai-source",
    styleId: "source",
    maxAmountMinor: 0,
    policyVersion: "simulation-v1",
    confirmed: true,
  });
  assert.equal(sourceConsent.status, 201, JSON.stringify(sourceConsent.body));
  const source = await f.ai("/sources", "POST", {
    requestId: randomUUID(),
    consentId: sourceConsent.body.id,
    sampleId: "purple-square",
  });
  assert.equal(source.status, 201, JSON.stringify(source.body));
  const consent = await f.ai("/consents", "POST", {
    requestId: randomUUID(),
    purpose,
    styleId: "purple-card",
    maxAmountMinor: 0,
    policyVersion: "simulation-v1",
    confirmed: true,
    sourceId: source.body.id,
    sourceRevision: source.body.revision,
  });
  assert.equal(consent.status, 201, JSON.stringify(consent.body));
  const job = await f.ai("/jobs", "POST", {
    requestId: randomUUID(),
    consentId: consent.body.id,
    sourceId: source.body.id,
    sourceRevision: source.body.revision,
    purpose,
    styleId: "purple-card",
  });
  assert.equal(job.status, 202, JSON.stringify(job.body));
  let result;
  for (let i = 0; i < 30; i++) {
    result = await f.ai(`/jobs/${job.body.id}`);
    if (result.body.status === "succeeded") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(result.body.status, "succeeded", JSON.stringify(result.body));
  return {
    source: source.body,
    sourceConsent: sourceConsent.body,
    consent: consent.body,
    job: result.body,
    candidate: result.body.candidates[0],
  };
}
test("AI HTTP默认关闭，来源保护与未登录/非管理员拒绝", async (t) => {
  const f = await fixture(t, false);
  assert.equal((await f.ai("/capabilities")).body.enabled, false);
  assert.equal(
    (await f.ai("/sources", "POST", { dataUrl: "not-an-image" })).status,
    503,
  );
  assert.equal((await f.call(f.prefix + "/capabilities")).status, 401);
  await f.admin(`/players/${f.player.id}/account`, "POST", {
    username: "fixture-player",
    password: "fixture-player-password",
  });
  const member = (
    await f.call("/auth/native-login", "POST", {
      username: "fixture-player",
      password: "fixture-player-password",
    })
  ).body.token;
  assert.equal(
    (await f.call(f.prefix + "/capabilities", "GET", undefined, member)).status,
    403,
  );
  assert.equal(
    (
      await f.call(f.prefix + "/consents", "POST", {}, f.token, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
});
test("模拟候选私有预览及明确cover采用、收据重放不重复，来源删除后仅保留历史收据", async (t) => {
  const f = await fixture(t);
  const p = await prepare(f);
  const preview = await f.ai(`/candidates/${p.candidate.id}`);
  assert.equal(preview.status, 200);
  assert.match(preview.body.dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(preview.body.aiGenerated, false);
  assert.equal(preview.body.originKind, "local-simulation");
  assert.equal(preview.headers["cache-control"], "no-store");
  const body = {
    requestId: randomUUID(),
    candidateId: p.candidate.id,
    candidateRevision: p.candidate.revision,
    target: "cover",
    targetRevision: 1,
    confirmed: true,
  };
  assert.equal(
    (await f.ai("/adoptions", "POST", { ...body, confirmed: false })).status,
    400,
  );
  const adopted = await f.ai("/adoptions", "POST", body);
  assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
  const album = (await f.admin(`/players/${f.player.id}/photos`)).body;
  assert.equal(album.photos.length, 1);
  assert.equal(album.photos[0].simulation, true);
  assert.equal(album.coverPhotoId, album.photos[0].id);
  assert.equal((await f.ai("/adoptions", "POST", body)).status, 200);
  assert.equal(
    (await f.admin(`/players/${f.player.id}/photos`)).body.photos.length,
    1,
  );
  assert.equal(
    (
      await f.ai(`/sources/${p.source.id}`, "DELETE", {
        revision: p.source.revision,
      })
    ).status,
    200,
  );
  assert.notEqual((await f.ai(`/candidates/${p.candidate.id}`)).status, 200);
  const receipt = await f.ai(`/adoptions?requestId=${body.requestId}`);
  assert.equal(receipt.status, 200);
  assert.equal(JSON.stringify(receipt.body).includes("data:image"), false);
});
test("用途不可跨采用，头像来源标记与注销后候选访问拒绝", async (t) => {
  const f = await fixture(t);
  const p = await prepare(f, "avatar");
  const b = {
    requestId: randomUUID(),
    candidateId: p.candidate.id,
    candidateRevision: p.candidate.revision,
    target: "cover",
    targetRevision: 1,
    confirmed: true,
  };
  assert.notEqual((await f.ai("/adoptions", "POST", b)).status, 200);
  const applied = await f.ai("/adoptions", "POST", {
    ...b,
    requestId: randomUUID(),
    target: "avatar",
    targetRevision: f.player.revision,
  });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const player = (await f.admin(`/players/${f.player.id}`)).body;
  assert.equal(player.avatarSimulation, true);
  assert.equal(player.avatarAiGenerated, false);
  await f.admin("/auth/logout", "POST", {});
  assert.equal((await f.ai(`/candidates/${p.candidate.id}`)).status, 401);
});

test("模拟仅接样本，拒URL/原图及伪scope，HTTP不开放状态迁移或计费", async (t) => {
  const f = await fixture(t);
  const cap = await f.ai("/capabilities");
  assert.equal(cap.body.uploadMode, "sample");
  assert.equal(cap.body.mode, "local-simulation");
  const publicCap = await f.call("/auth/capabilities");
  assert.equal(publicCap.body.aiPhotos, true);
  const c = await f.ai("/consents", "POST", {
    requestId: randomUUID(),
    purpose: "private-ai-source",
    styleId: "source",
    maxAmountMinor: 0,
    policyVersion: "simulation-v1",
    confirmed: true,
  });
  for (const extra of [
    { dataUrl: "data:image/png;base64,AAAA" },
    { url: "https://example.com/photo.png" },
    { teamId: 999 },
    { role: "admin" },
  ]) {
    const r = await f.ai("/sources", "POST", {
      requestId: randomUUID(),
      consentId: c.body.id,
      sampleId: "purple-square",
      ...extra,
    });
    assert.equal(r.status, 400);
    assert.equal(r.headers["cache-control"], "no-store");
  }
  for (const path of ["/jobs/unknown/transition", "/jobs/unknown/settle"])
    assert.notEqual(
      (await f.ai(path, "POST", { amountMinor: 0, status: "succeeded" }))
        .status,
      200,
    );
  assert.equal((await f.ai("/sources?requestId=x&requestId=y")).status, 400);
});
test("生成同意撤回后候选拒绝，普通改头像清来源且不能伪造", async (t) => {
  const f = await fixture(t);
  const p = await prepare(f, "avatar");
  const adopt = await f.ai("/adoptions", "POST", {
    requestId: randomUUID(),
    candidateId: p.candidate.id,
    candidateRevision: p.candidate.revision,
    target: "avatar",
    targetRevision: f.player.revision,
    confirmed: true,
  });
  assert.equal(adopt.status, 200);
  const current = (await f.admin(`/players/${f.player.id}`)).body;
  const cleared = await f.admin(`/players/${f.player.id}`, "PUT", {
    ...current,
    avatar: null,
    avatarOriginKind: "ai-generated",
    avatarAiGenerated: true,
  });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.avatarGenerated, false);
  const revoked = await f.ai(`/consents/${p.consent.id}/revoke`, "POST", {
    revision: p.consent.revision,
  });
  assert.equal(revoked.status, 200);
  assert.equal((await f.ai(`/candidates/${p.candidate.id}`)).status, 403);
});
test("同队另一管理员不能访问私有任务或候选，HTTP独立读限流有界", async (t) => {
  const f = await fixture(t);
  const p = await prepare(f);
  // 新管理员使用隔离fixture可信初始化，不从客户端任意授予角色。
  const { DatabaseSync } = await import("node:sqlite");
  // fixture仅返回测试数据库路径，不涉及实际服务库。
  const db = new DatabaseSync(f.databasePath);
  const root = db.prepare("SELECT * FROM club_users WHERE role='admin'").get();
  db.prepare(
    "INSERT INTO club_users(team_id,username,password_hash,role) VALUES(?,?,?,'admin')",
  ).run(root.team_id, "second-fixture-admin", root.password_hash);
  db.close();
  const second = (
    await f.call("/auth/native-login", "POST", {
      username: "second-fixture-admin",
      password: "fixture-password-not-real",
    })
  ).body.token;
  assert.equal(
    (await f.call(f.prefix + `/jobs/${p.job.id}`, "GET", undefined, second))
      .status,
    403,
  );
  assert.equal(
    (
      await f.call(
        f.prefix + `/candidates/${p.candidate.id}`,
        "GET",
        undefined,
        second,
      )
    ).status,
    403,
  );
  let last;
  for (let i = 0; i < 121; i++)
    last = await f.call(f.prefix + "/capabilities", "GET", undefined, second);
  assert.equal(last.status, 429);
});

test("采用收据仅原管理员同目标可恢复，重登不复活私有候选且外队拒绝", async (t) => {
  const f = await fixture(t);
  const p = await prepare(f, "avatar");
  const requestId = randomUUID();
  const adopted = await f.ai("/adoptions", "POST", {
    requestId,
    candidateId: p.candidate.id,
    candidateRevision: p.candidate.revision,
    target: "avatar",
    targetRevision: f.player.revision,
    confirmed: true,
  });
  assert.equal(adopted.status, 200);
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(f.databasePath);
  const root = db.prepare("SELECT * FROM club_users WHERE role='admin'").get();
  db.prepare(
    "INSERT INTO club_users(team_id,username,password_hash,role) VALUES(?,?,?,'admin')",
  ).run(root.team_id, "other-admin-receipt", root.password_hash);
  db.prepare(
    "INSERT INTO club_teams(id,name) VALUES(999,'外队合成夹具')",
  ).run();
  db.prepare(
    "INSERT INTO club_users(team_id,username,password_hash,role) VALUES(999,?,?,'admin')",
  ).run("foreign-admin-receipt", root.password_hash);
  db.close();
  for (const username of ["other-admin-receipt", "foreign-admin-receipt"]) {
    const token = (
      await f.call("/auth/native-login", "POST", {
        username,
        password: "fixture-password-not-real",
      })
    ).body.token;
    for (const path of [
      `/adoptions?requestId=${requestId}`,
      `/candidates/${p.candidate.id}`,
      `/jobs/${p.job.id}`,
    ])
      assert.ok(
        [403, 404].includes(
          (await f.call(f.prefix + path, "GET", undefined, token)).status,
        ),
      );
  }
  await f.admin("/auth/logout", "POST", {});
  const token = (
    await f.call("/auth/native-login", "POST", {
      username: "fixture-admin",
      password: "fixture-password-not-real",
    })
  ).body.token;
  const receipt = await f.call(
    f.prefix + `/adoptions?requestId=${requestId}`,
    "GET",
    undefined,
    token,
  );
  assert.equal(receipt.status, 200, JSON.stringify(receipt.body));
  assert.equal(JSON.stringify(receipt.body).includes("data:image"), false);
  assert.equal(
    (
      await f.call(
        f.prefix + `/candidates/${p.candidate.id}`,
        "GET",
        undefined,
        token,
      )
    ).status,
    403,
  );
});

test("封面HTTP采用严格目标CAS和9张容量，失败不新增采用记录", async (t) => {
  const f = await fixture(t);
  const p = await prepare(f);
  const base = {
    candidateId: p.candidate.id,
    candidateRevision: p.candidate.revision,
    target: "cover",
    confirmed: true,
  };
  let revision = 1;
  for (let i = 0; i < 9; i++) {
    const r = await f.ai("/adoptions", "POST", {
      ...base,
      requestId: randomUUID(),
      targetRevision: revision,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    revision = (await f.admin(`/players/${f.player.id}/photos`)).body.revision;
  }
  const staleRequest = randomUUID();
  assert.equal(
    (
      await f.ai("/adoptions", "POST", {
        ...base,
        requestId: staleRequest,
        targetRevision: 1,
      })
    ).status,
    409,
  );
  const fullRequest = randomUUID();
  assert.equal(
    (
      await f.ai("/adoptions", "POST", {
        ...base,
        requestId: fullRequest,
        targetRevision: revision,
      })
    ).status,
    409,
  );
  assert.equal((await f.ai(`/adoptions?requestId=${fullRequest}`)).status, 404);
  const album = (await f.admin(`/players/${f.player.id}/photos`)).body;
  assert.equal(album.photos.length, 9);
  assert.equal(album.revision, revision);
});

test("可信file分支使用合成文件走真实上传API，缺逐球员策略关闭、撤权拒绝旧图", async (t) => {
  const local = createLocalPlayerAiProvider();
  const provider = {
    ...local,
    mode: "configured-provider",
    uploadMode: "file",
    id: "synthetic-file-http-only",
  };
  const policy = {
    mode: "configured-provider",
    approved: true,
    providerId: provider.id,
    termsVersion: provider.termsVersion,
    version: "file-http-v1",
    currency: "XXX",
    amountMinor: 0,
    budgetMinor: 0,
    lifetimeMs: 3600000,
    disclosures: {
      processor: "合成测试适配",
      destination: "本进程",
      retention: "本测试",
      training: "不训练",
      cancellation: "无费用",
    },
  };
  const off = await fixture(t, true, { provider, policy });
  assert.equal((await off.ai("/capabilities")).body.enabled, false);
  let active = true;
  const f = await fixture(t, true, {
    provider,
    policy,
    authorizeProcessing: (scope) => ({ ...scope, active, revision: 1 }),
  });
  assert.equal((await f.ai("/capabilities")).body.uploadMode, "file");
  const c = await f.ai("/consents", "POST", {
    requestId: randomUUID(),
    purpose: "private-ai-source",
    styleId: "source",
    maxAmountMinor: 0,
    policyVersion: policy.version,
    confirmed: true,
  });
  assert.equal(c.status, 201);
  const sample = await local.sample("white-square");
  const requestId = randomUUID();
  const source = await f.ai("/sources", "POST", {
    requestId,
    consentId: c.body.id,
    dataUrl: "data:image/png;base64," + sample.bytes.toString("base64"),
  });
  assert.equal(source.status, 201, JSON.stringify(source.body));
  assert.equal((await f.ai(`/sources?requestId=${requestId}`)).status, 200);
  active = false;
  const rejected = await f.ai("/consents", "POST", {
    requestId: randomUUID(),
    purpose: "avatar",
    styleId: "purple-card",
    maxAmountMinor: 0,
    policyVersion: policy.version,
    confirmed: true,
    sourceId: source.body.id,
    sourceRevision: source.body.revision,
  });
  assert.equal(rejected.status, 403);
});
