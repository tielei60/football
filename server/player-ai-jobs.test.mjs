import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createPlayerAiJobs } from "./player-ai-jobs.mjs";
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const consent = {
    active: true,
    expiresAt: 9999,
    teamId: 1,
    playerId: "fictional-player",
    requesterId: 7,
    sourceId: "synthetic-source",
    purpose: "portrait",
    styleId: "test-style",
    providerId: "test-adapter",
    termsVersion: "test-v1",
    currency: "XXX",
    maxAmountMinor: 60,
  };
  const options = {
    enabled: true,
    now: () => 100,
    policy: {
      currency: "XXX",
      budgetMinor: 100,
      maxJobMinor: 60,
      maxActive: 3,
      maxCandidates: 2,
    },
    authorize: (actor, target) =>
      actor === 7 && target.teamId === 1 && target.requesterId === 7
        ? { ...target, role: "admin", active: true }
        : null,
    resolveConsent: (ref) => (ref === "test-consent" ? consent : null),
  };
  const store = createPlayerAiJobs(db, options);
  store.initialize();
  const input = {
    teamId: 1,
    playerId: "fictional-player",
    requesterId: 7,
    requestId: "request-1",
    consentId: "test-consent",
    sourceId: "synthetic-source",
    purpose: "portrait",
    styleId: "test-style",
    providerId: "test-adapter",
    termsVersion: "test-v1",
    amountMinor: 60,
  };
  return {
    db,
    store,
    options,
    consent,
    input,
    create: (extra) => store.create(7, { ...input, ...extra }),
  };
}
const candidate = {
  id: "candidate-1",
  objectId: "private-object-1",
  width: 100,
  height: 100,
  mimeType: "image/jpeg",
};
test("默认关闭不建表，缺预算/授权依赖拒绝", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(
      () => createPlayerAiJobs(db).initialize(),
      (e) => e.status === 503,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master").get().n, 0);
    assert.throws(
      () => createPlayerAiJobs(db, { enabled: true }).initialize(),
      (e) => e.status === 503,
    );
  } finally {
    db.close();
  }
});
test("幂等绑定完整用途、原图授权及预算；跨用户无私有任务读取", (t) => {
  const h = fixture(t),
    j = h.create();
  assert.deepEqual(h.create(), j);
  assert.throws(
    () => h.create({ amountMinor: 59 }),
    (e) => e.status === 409,
  );
  assert.throws(
    () => h.store.get(8, j.id),
    (e) => e.status === 403,
  );
  assert.throws(
    () => h.create({ sourceId: "another-source" }),
    (e) => e.status === 403,
  );
  assert.throws(
    () => h.create({ amountMinor: 1.5 }),
    (e) => e.status === 400,
  );
  assert.throws(
    () => h.create({ url: "https://example.invalid" }),
    (e) => e.status === 400,
  );
  assert.throws(
    () => h.create({ requestId: "second" }),
    (e) => e.status === 409,
  );
  const restarted = createPlayerAiJobs(h.db, h.options);
  restarted.initialize();
  assert.deepEqual(restarted.get(7, j.id), j);
});
test("未知受理不可重发，版本保护及成功只保存私有候选元数据", (t) => {
  const h = fixture(t);
  let j = h.create();
  j = h.store.transition(7, j.id, j.revision, "submit");
  assert.throws(
    () => h.store.transition(7, j.id, 1, "unknown"),
    (e) => e.status === 409,
  );
  j = h.store.transition(7, j.id, j.revision, "unknown");
  assert.throws(
    () => h.store.transition(7, j.id, j.revision, "submit"),
    (e) => e.status === 409,
  );
  j = h.store.transition(7, j.id, j.revision, "submitted", {
    externalRef: "verified-provider-job",
  });
  j = h.store.transition(7, j.id, j.revision, "running");
  assert.throws(
    () =>
      h.store.transition(7, j.id, j.revision, "succeed", {
        candidates: [{ ...candidate, url: "https://invalid" }],
      }),
    (e) => e.status === 400,
  );
  j = h.store.transition(7, j.id, j.revision, "succeed", {
    candidates: [candidate],
  });
  assert.equal(j.candidates[0].aiGenerated, true);
  assert.deepEqual(
    h.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((x) => x.name),
    ["player_ai_jobs"],
  );
  assert.throws(
    () => h.store.transition(7, j.id, j.revision, "running"),
    (e) => e.status === 409,
  );
});
test("受理前取消释放预算，受理后取消/失败不能自动返还，迟到成功不复活", (t) => {
  const h = fixture(t);
  let j = h.create();
  j = h.store.cancel(7, j.id, j.revision);
  assert.equal(j.chargedMinor, 0);
  let second = h.create({ requestId: "second" });
  second = h.store.transition(7, second.id, second.revision, "submit");
  second = h.store.cancel(7, second.id, second.revision);
  assert.equal(second.chargedMinor, null);
  assert.throws(
    () => h.create({ requestId: "third" }),
    (e) => e.status === 409,
  );
  assert.throws(
    () =>
      h.store.transition(7, second.id, second.revision, "succeed", {
        candidates: [candidate],
      }),
    (e) => e.status === 409,
  );
  second = h.store.settle(7, second.id, second.revision, {
    amountMinor: 20,
    settlementRef: "verified-charge-1",
  });
  assert.equal(second.chargedMinor, 20);
  assert.equal(h.create({ requestId: "third" }).status, "queued");
  assert.throws(
    () =>
      h.store.settle(7, second.id, second.revision, {
        amountMinor: 0,
        settlementRef: "change-charge",
      }),
    (e) => e.status === 409,
  );
});
test("授权撤回后候选不可读或推进，可取消且只依可信费用结果结算", (t) => {
  const h = fixture(t);
  let j = h.create();
  j = h.store.transition(7, j.id, j.revision, "submit");
  j = h.store.transition(7, j.id, j.revision, "submitted", {
    externalRef: "remote-job",
  });
  j = h.store.transition(7, j.id, j.revision, "succeed", {
    candidates: [candidate],
  });
  h.consent.active = false;
  assert.throws(
    () => h.store.get(7, j.id),
    (e) => e.status === 403,
  );
  assert.throws(
    () => h.store.transition(7, j.id, j.revision, "running"),
    (e) => e.status === 403,
  );
  j = h.store.cancel(7, j.id, j.revision);
  assert.deepEqual(j.candidates, []);
  assert.equal(
    h.store.settle(7, j.id, j.revision, {
      amountMinor: 30,
      settlementRef: "verified-charge",
    }).chargedMinor,
    30,
  );
});
test("失败保留费用占额、超授权结算拒绝、异步授权依赖失败关闭", (t) => {
  const h = fixture(t);
  let j = h.create();
  j = h.store.transition(7, j.id, j.revision, "submit");
  j = h.store.transition(7, j.id, j.revision, "fail");
  assert.equal(j.chargedMinor, null);
  assert.throws(
    () =>
      h.store.settle(7, j.id, j.revision, {
        amountMinor: 61,
        settlementRef: "charge",
      }),
    (e) => e.status === 409,
  );
  const bad = createPlayerAiJobs(h.db, {
    ...h.options,
    authorize: async () => true,
  });
  assert.throws(
    () => bad.get(7, j.id),
    (e) => e.status === 500,
  );
});

test("授权撤回后直接结算不披露候选；错误授权归属与异步同意拒绝", (t) => {
  const h = fixture(t);
  let j = h.create();
  j = h.store.transition(7, j.id, j.revision, "submit");
  j = h.store.transition(7, j.id, j.revision, "submitted", {
    externalRef: "remote-job",
  });
  j = h.store.transition(7, j.id, j.revision, "succeed", {
    candidates: [candidate],
  });
  h.consent.active = false;
  assert.deepEqual(
    h.store.settle(7, j.id, j.revision, {
      amountMinor: 30,
      settlementRef: "verified-charge",
    }).candidates,
    [],
  );
  const wrong = createPlayerAiJobs(h.db, {
    ...h.options,
    authorize: () => ({
      teamId: 1,
      playerId: "other",
      requesterId: 7,
      role: "admin",
      active: true,
    }),
  });
  assert.throws(
    () => wrong.get(7, j.id),
    (e) => e.status === 403,
  );
  const asyncConsent = createPlayerAiJobs(h.db, {
    ...h.options,
    resolveConsent: async () => h.consent,
  });
  assert.throws(
    () => asyncConsent.get(7, j.id),
    (e) => e.status === 500,
  );
});

test("活跃任务上限429，取消释放任务槽位但保留受理费用占额", (t) => {
  const h = fixture(t);
  const store = createPlayerAiJobs(h.db, {
    ...h.options,
    policy: { ...h.options.policy, maxActive: 1 },
  });
  let first = store.create(7, { ...h.input, amountMinor: 30 });
  assert.throws(
    () => store.create(7, { ...h.input, requestId: "second", amountMinor: 30 }),
    (e) => e.status === 429,
  );
  first = store.transition(7, first.id, first.revision, "submit");
  first = store.transition(7, first.id, first.revision, "unknown");
  first = store.cancel(7, first.id, first.revision);
  assert.equal(first.chargedMinor, null);
  const second = store.create(7, {
    ...h.input,
    requestId: "second",
    amountMinor: 60,
  });
  assert.equal(second.status, "queued");
  assert.throws(
    () => store.create(7, { ...h.input, requestId: "third", amountMinor: 20 }),
    (e) => e.status === 409,
  );
});
test("提交结果未知仍占预算且不能再次提交，授权到期边界拒绝", (t) => {
  const h = fixture(t);
  let j = h.create();
  j = h.store.transition(7, j.id, j.revision, "submit");
  j = h.store.transition(7, j.id, j.revision, "unknown");
  assert.throws(
    () => h.create({ requestId: "second" }),
    (e) => e.status === 409,
  );
  assert.throws(
    () => h.store.transition(7, j.id, j.revision, "submit"),
    (e) => e.status === 409,
  );
  h.consent.expiresAt = 100;
  assert.throws(
    () => h.store.get(7, j.id),
    (e) => e.status === 403,
  );
  assert.throws(
    () => h.create({ requestId: "expired", amountMinor: 1 }),
    (e) => e.status === 403,
  );
  assert.equal(h.store.cancel(7, j.id, j.revision).status, "cancelled");
});
test("费用结算当前revision重放幂等，旧revision及不同结算引用冲突", (t) => {
  const h = fixture(t);
  let j = h.create();
  j = h.store.transition(7, j.id, j.revision, "submit");
  j = h.store.transition(7, j.id, j.revision, "fail");
  const oldRevision = j.revision;
  const settled = h.store.settle(7, j.id, j.revision, {
    amountMinor: 12,
    settlementRef: "verified-ref",
  });
  assert.deepEqual(
    h.store.settle(7, j.id, settled.revision, {
      amountMinor: 12,
      settlementRef: "verified-ref",
    }),
    settled,
  );
  assert.throws(
    () =>
      h.store.settle(7, j.id, oldRevision, {
        amountMinor: 12,
        settlementRef: "verified-ref",
      }),
    (e) => e.status === 409,
  );
  assert.throws(
    () =>
      h.store.settle(7, j.id, settled.revision, {
        amountMinor: 12,
        settlementRef: "different-ref",
      }),
    (e) => e.status === 409,
  );
});
test("策略收紧不改变旧任务币种/预留；新币种预算独立且原授权不能复用", (t) => {
  const h = fixture(t);
  let j = h.create();
  j = h.store.transition(7, j.id, j.revision, "submit");
  j = h.store.transition(7, j.id, j.revision, "fail");
  const stricter = createPlayerAiJobs(h.db, {
    ...h.options,
    policy: { ...h.options.policy, budgetMinor: 10, maxJobMinor: 10 },
  });
  assert.throws(
    () =>
      stricter.create(7, {
        ...h.input,
        requestId: "tightened",
        amountMinor: 1,
      }),
    (e) => e.status === 409,
  );
  const otherCurrency = createPlayerAiJobs(h.db, {
    ...h.options,
    policy: { ...h.options.policy, currency: "YYY" },
  });
  assert.throws(
    () => otherCurrency.create(7, { ...h.input, requestId: "wrong-consent" }),
    (e) => e.status === 403,
  );
  const settled = otherCurrency.settle(7, j.id, j.revision, {
    amountMinor: 55,
    settlementRef: "original-currency-receipt",
  });
  assert.equal(settled.currency, "XXX");
  assert.equal(settled.reservedMinor, 60);
  assert.equal(settled.chargedMinor, 55);
  h.consent.currency = "YYY";
  const fresh = otherCurrency.create(7, {
    ...h.input,
    requestId: "new-currency",
  });
  assert.equal(fresh.currency, "YYY");
  assert.equal(fresh.reservedMinor, 60);
  assert.throws(
    () =>
      otherCurrency.create(7, {
        ...h.input,
        requestId: "new-currency-overflow",
      }),
    (e) => e.status === 409,
  );
});
