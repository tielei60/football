import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";
import { createPlayerMediaStore } from "./player-media-store.mjs";
import { applyPlayerAiAdoption } from "./player-ai-adoption.mjs";
import { createPlayerAiService } from "./player-ai-service.mjs";
import { createLocalPlayerAiProvider } from "./player-ai-local-provider.mjs";
async function fixture(t, override = {}) {
  const store = openFootballStore(":memory:");
  const club = createClubStore(store.database, store, {
    bootstrapAdmin: { username: "test-admin", password: "fictional-password" },
  });
  const media = createPlayerMediaStore(store.database);
  const login = () => ({
    token: club.login(
      { username: "test-admin", password: "fictional-password" },
      "test",
      "native",
    ).token,
    transport: "native",
  });
  const actor = login(),
    user = club.authenticate(actor.token, "native"),
    player = club.savePlayer(user.team_id, null, {
      name: "合成队员",
      number: null,
    });
  const provider = override.provider ?? createLocalPlayerAiProvider();
  const policy = override.policy ?? {
    mode: "local-simulation",
    currency: "XXX",
    amountMinor: 0,
    version: "simulation-v1",
    lifetimeMs: 3600000,
  };
  const service = createPlayerAiService(store.database, {
    enabled: true,
    provider,
    policy,
    authenticate: club.authenticate,
    getPlayer: club.getPlayer,
    getAlbumRevision: (team, id) => media.list(user, id).revision,
    applyAdoption: override.applyAdoption ?? applyPlayerAiAdoption,
    authorizeProcessing: override.authorizeProcessing,
  });
  t.after(async () => {
    service.close();
    await service.drain();
    store.close();
  });
  const consent = (purpose, extra = {}) =>
    service.createConsent(actor, player.id, {
      purpose,
      styleId: purpose === "private-ai-source" ? "source" : "purple-card",
      maxAmountMinor: 0,
      policyVersion: policy.version,
      confirmed: true,
      requestId: randomUUID(),
      ...extra,
    });
  const source = async () => {
    const c = consent("private-ai-source");
    return service.uploadSource(actor, player.id, {
      consentId: c.id,
      requestId: randomUUID(),
      sampleId: "purple-square",
    });
  };
  const job = async (purpose = "portrait") => {
    const src = await source(),
      c = consent(purpose, { sourceId: src.id, sourceRevision: src.revision }),
      j = service.createJob(actor, player.id, {
        consentId: c.id,
        sourceId: src.id,
        sourceRevision: src.revision,
        purpose,
        styleId: "purple-card",
        requestId: randomUUID(),
      });
    return { src, c, j };
  };
  return {
    store,
    club,
    media,
    actor,
    user,
    player,
    service,
    provider,
    policy,
    login,
    consent,
    source,
    job,
  };
}
test("默认关闭无AI表，模拟拒真实文件入口", async (t) => {
  const store = openFootballStore(":memory:");
  try {
    const service = createPlayerAiService(store.database);
    assert.equal(service.enabled, false);
    assert.equal(
      store.database
        .prepare(
          "SELECT count(*) n FROM sqlite_master WHERE name LIKE 'player_ai_%'",
        )
        .get().n,
      0,
    );
  } finally {
    store.close();
  }
  const f = await fixture(t),
    c = f.consent("private-ai-source");
  await assert.rejects(
    f.service.uploadSource(f.actor, f.player.id, {
      consentId: c.id,
      requestId: randomUUID(),
      dataUrl: "fake",
    }),
    (e) => e.status === 400,
  );
  assert.equal(
    f.service.capabilities(f.actor, f.player.id).uploadMode,
    "sample",
  );
});
test("完整模拟source/job/candidate/cover采用与receipt，头像统计不变", async (t) => {
  const f = await fixture(t),
    { j, src } = await f.job();
  await f.service.drain();
  const done = f.service.getJob(f.actor, f.player.id, j.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.candidates.length, 1);
  const c = done.candidates[0];
  assert.equal(c.originKind, "local-simulation");
  assert.equal(c.aiGenerated, false);
  assert.equal(c.simulation, true);
  const image = f.service.getCandidate(f.actor, f.player.id, c.id);
  assert.match(image.dataUrl, /^data:image\/jpeg;base64,/);
  const input = {
    candidateId: c.id,
    candidateRevision: c.revision,
    target: "cover",
    targetRevision: 1,
    requestId: randomUUID(),
    confirmed: true,
  };
  const receipt = f.service.adopt(f.actor, f.player.id, input);
  assert.equal(receipt.target, "cover");
  assert.deepEqual(f.service.adopt(f.actor, f.player.id, input), receipt);
  assert.equal(f.media.list(f.user, f.player.id).photos.length, 1);
  assert.equal(f.club.getPlayer(f.user.team_id, f.player.id).avatar, null);
  assert.equal(
    f.store.database.prepare("SELECT count(*) n FROM club_matches").get().n,
    0,
  );
  f.service.deleteSource(f.actor, f.player.id, {
    id: src.id,
    revision: src.revision,
  });
  assert.throws(
    () => f.service.getCandidate(f.actor, f.player.id, c.id),
    (e) => e.status === 409,
  );
  const newActor = f.login();
  assert.deepEqual(
    f.service.getAdoptionByRequest(newActor, f.player.id, input.requestId),
    receipt,
  );
});
test("用途与目标独立，采用callback失败回滚业务与收据", async (t) => {
  const f = await fixture(t, {
      applyAdoption: (args) => {
        applyPlayerAiAdoption(args);
        throw Error("synthetic rollback");
      },
    }),
    { j } = await f.job("avatar");
  await f.service.drain();
  const c = f.service.getJob(f.actor, f.player.id, j.id).candidates[0];
  assert.throws(
    () =>
      f.service.adopt(f.actor, f.player.id, {
        candidateId: c.id,
        candidateRevision: c.revision,
        target: "cover",
        targetRevision: 1,
        requestId: randomUUID(),
        confirmed: true,
      }),
    (e) => e.status === 403,
  );
  assert.throws(
    () =>
      f.service.adopt(f.actor, f.player.id, {
        candidateId: c.id,
        candidateRevision: c.revision,
        target: "avatar",
        targetRevision: 1,
        requestId: randomUUID(),
        confirmed: true,
      }),
    /synthetic rollback/,
  );
  assert.equal(f.club.getPlayer(f.user.team_id, f.player.id).avatar, null);
  assert.equal(
    f.store.database.prepare("SELECT count(*) n FROM player_ai_adoptions").get()
      .n,
    0,
  );
});
test("取消/删除在途provider结果不复活，新会话可取消旧任务但不读旧素材", async (t) => {
  const provider = createLocalPlayerAiProvider();
  let release;
  const gate = new Promise((r) => (release = r)),
    submit = provider.submit;
  provider.submit = async (input) => {
    await gate;
    return submit(input);
  };
  const f = await fixture(t, { provider }),
    { j } = await f.job();
  f.club.logout(f.actor.token);
  const next = f.login();
  const pending = f.service.getJob(next, f.player.id, j.id);
  assert.equal(pending.restricted, true);
  f.service.cancelJob(next, f.player.id, j.id, { revision: pending.revision });
  release();
  await f.service.drain();
  assert.equal(
    f.store.database
      .prepare("SELECT status FROM player_ai_jobs WHERE id=?")
      .get(j.id).status,
    "cancelled",
  );
  assert.equal(
    f.store.database
      .prepare("SELECT count(*) n FROM player_ai_candidates WHERE deleted=0")
      .get().n,
    0,
  );
});
test("unknown只提交一次，轮询不能再次submit", async (t) => {
  const provider = createLocalPlayerAiProvider();
  let calls = 0;
  provider.submit = async () => {
    calls++;
    return { state: "unknown" };
  };
  const f = await fixture(t, { provider }),
    { j } = await f.job();
  await f.service.drain();
  for (let i = 0; i < 3; i++) f.service.getJob(f.actor, f.player.id, j.id);
  await f.service.drain();
  assert.equal(calls, 1);
  assert.equal(
    f.service.getJob(f.actor, f.player.id, j.id).status,
    "submission_unknown",
  );
});
test("配置式文件链路只使用合成文件且逐用途授权版本不可ABA恢复", async (t) => {
  const local = createLocalPlayerAiProvider();
  let revision = 1,
    active = true;
  const provider = {
    ...local,
    mode: "configured-provider",
    uploadMode: "file",
    id: "synthetic-file-test",
  };
  const policy = {
    mode: "configured-provider",
    approved: true,
    providerId: provider.id,
    termsVersion: provider.termsVersion,
    version: "file-test-v1",
    currency: "XXX",
    amountMinor: 0,
    budgetMinor: 0,
    lifetimeMs: 3600000,
    disclosures: {
      processor: "仅测试替身",
      destination: "进程内",
      retention: "本测试",
      training: "无",
      cancellation: "无收费",
    },
  };
  const f = await fixture(t, {
    provider,
    policy,
    authorizeProcessing: (scope) => ({ ...scope, active, revision }),
  });
  assert.equal(f.service.capabilities(f.actor, f.player.id).uploadMode, "file");
  const c = f.consent("private-ai-source"),
    image = await local.sample("purple-square");
  const src = await f.service.uploadSource(f.actor, f.player.id, {
    consentId: c.id,
    requestId: randomUUID(),
    dataUrl: "data:image/png;base64," + image.bytes.toString("base64"),
  });
  const g = f.consent("avatar", {
    sourceId: src.id,
    sourceRevision: src.revision,
  });
  const j = f.service.createJob(f.actor, f.player.id, {
    consentId: g.id,
    sourceId: src.id,
    sourceRevision: src.revision,
    purpose: "avatar",
    styleId: "purple-card",
    requestId: randomUUID(),
  });
  await f.service.drain();
  const view = f.service.getJob(f.actor, f.player.id, j.id);
  assert.equal(view.status, "succeeded");
  active = false;
  assert.throws(
    () => f.service.getCandidate(f.actor, f.player.id, view.candidates[0].id),
    { status: 403 },
  );
  active = true;
  revision++;
  assert.throws(
    () => f.service.getCandidate(f.actor, f.player.id, view.candidates[0].id),
    { status: 403 },
  );
});
test("连续确定失败及删除来源释放候选预留，不保留可复活图", async (t) => {
  const local = createLocalPlayerAiProvider();
  const f = await fixture(t, {
    provider: {
      ...local,
      submit: async () => ({ state: "failed", externalRef: randomUUID() }),
    },
  });
  for (let i = 0; i < 11; i++) {
    const { src, j } = await f.job();
    await f.service.drain();
    assert.equal(f.service.getJob(f.actor, f.player.id, j.id).status, "failed");
    f.service.deleteSource(f.actor, f.player.id, {
      id: src.id,
      revision: src.revision,
    });
  }
  assert.equal(
    f.store.database
      .prepare("SELECT count(*) n FROM player_ai_result_reservations")
      .get().n,
    0,
  );
});
test("关闭时等待在途来源，迟到适配回包不再写入任务结果", async (t) => {
  const local = createLocalPlayerAiProvider();
  let release;
  const f = await fixture(t, {
    provider: {
      ...local,
      sample: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    },
  });
  const c = f.consent("private-ai-source");
  const p = f.service.uploadSource(f.actor, f.player.id, {
    consentId: c.id,
    requestId: randomUUID(),
    sampleId: "purple-square",
  });
  await new Promise((resolve) => setImmediate(resolve));
  f.service.close();
  await assert.rejects(p);
  await f.service.drain();
  release(await local.sample("purple-square"));
  assert.equal(
    f.store.database.prepare("SELECT count(*) n FROM player_ai_jobs").get().n,
    0,
  );
});
test("私有候选满额拒绝新任务，删除候选释放名额且不自动采用", async (t) => {
  const f = await fixture(t),
    src = await f.source(),
    c = f.consent("portrait", {
      sourceId: src.id,
      sourceRevision: src.revision,
    });
  const create = () =>
    f.service.createJob(f.actor, f.player.id, {
      consentId: c.id,
      sourceId: src.id,
      sourceRevision: src.revision,
      purpose: "portrait",
      styleId: "purple-card",
      requestId: randomUUID(),
    });
  let first;
  for (let i = 0; i < 9; i++) {
    const j = create();
    await f.service.drain();
    const v = f.service.getJob(f.actor, f.player.id, j.id);
    assert.equal(v.status, "succeeded");
    first ??= v.candidates[0];
  }
  assert.throws(create, (e) => e.status === 429);
  f.service.deleteCandidate(f.actor, f.player.id, first.id, {
    revision: first.revision,
  });
  const j = create();
  await f.service.drain();
  assert.equal(
    f.service.getJob(f.actor, f.player.id, j.id).status,
    "succeeded",
  );
  assert.equal(f.media.list(f.user, f.player.id).photos.length, 0);
});
test("缺逐球员可信策略file能力关闭，异步授权不能truthy绕过", async (t) => {
  const local = createLocalPlayerAiProvider(),
    provider = { ...local, mode: "configured-provider", uploadMode: "file" };
  const policy = {
    mode: "configured-provider",
    approved: true,
    providerId: provider.id,
    termsVersion: provider.termsVersion,
    version: "file-test-v1",
    currency: "XXX",
    amountMinor: 0,
    budgetMinor: 0,
    lifetimeMs: 3600000,
    disclosures: {
      processor: "test",
      destination: "test",
      retention: "test",
      training: "test",
      cancellation: "test",
    },
  };
  const a = await fixture(t, { provider, policy });
  assert.equal(a.service.enabled, false);
  const b = await fixture(t, {
    provider,
    policy,
    authorizeProcessing: async (scope) => ({
      ...scope,
      active: true,
      revision: 1,
    }),
  });
  assert.throws(
    () => b.consent("private-ai-source"),
    (e) => e.status === 403,
  );
});
