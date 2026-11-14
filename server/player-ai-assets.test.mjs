import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { createPlayerAiAssets } from "./player-ai-assets.mjs";
const sharp = createRequire(new URL("../app/package.json", import.meta.url))(
  "sharp",
);
async function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  let clock = 100,
    authRevision = 1,
    active = true;
  const consent = {
    active: true,
    revision: 1,
    expiresAt: 2000,
    teamId: 1,
    playerId: "fictional",
    requesterId: 7,
    purpose: "private-ai-source",
  };
  const options = {
    enabled: true,
    maxLifetimeMs: 1000,
    maxObjectsPerUploader: 10,
    maxStoredBytes: 10 * 2097152,
    now: () => clock,
    authorize: (actor, s) =>
      actor === 7 &&
      active &&
      s.teamId === 1 &&
      s.playerId === "fictional" &&
      s.requesterId === 7
        ? { ...s, role: "admin", active: true, revision: authRevision }
        : null,
    resolveConsent: (id) => (id === "consent" ? consent : null),
  };
  const store = createPlayerAiAssets(db, options);
  store.initialize();
  const bytes = await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 4,
      background: { r: 120, g: 60, b: 170, alpha: 0.5 },
    },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "synthetic-private-metadata" } } })
    .toBuffer();
  const input = {
    teamId: 1,
    playerId: "fictional",
    requesterId: 7,
    requestId: "request",
    consentId: "consent",
    expiresAt: 1000,
    dataUrl: "data:image/jpeg;base64," + bytes.toString("base64"),
  };
  return {
    db,
    store,
    options,
    input,
    consent,
    setTime: (v) => (clock = v),
    revoke: () => (active = false),
    advanceAuthority: () => authRevision++,
  };
}
test("默认禁用不建表，缺授权/保留策略拒绝", () => {
  const db = new DatabaseSync(":memory:");
  try {
    assert.throws(
      () => createPlayerAiAssets(db).initialize(),
      (e) => e.status === 503,
    );
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master").get().n, 0);
    assert.throws(
      () => createPlayerAiAssets(db, { enabled: true }).initialize(),
      (e) => e.status === 503,
    );
  } finally {
    db.close();
  }
});
test("真实解码清除EXIF，私有逐对象读取，只有元数据幂等不公开URL", async (t) => {
  const h = await fixture(t),
    r = await h.store.upload(7, h.input);
  assert.equal(r.status, "ready");
  assert.equal(r.dataUrl, undefined);
  assert.equal(r.consentId, undefined);
  assert.deepEqual(await h.store.upload(7, h.input), r);
  const read = h.store.read(7, r.id, r.revision);
  const bytes = Buffer.from(read.dataUrl.split(",")[1], "base64");
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.icc, undefined);
  assert.equal(meta.width, 12);
  assert.throws(
    () => h.store.read(8, r.id, r.revision),
    (e) => e.status === 403,
  );
  assert.throws(
    () => h.store.reference(7, r.id, r.revision - 1),
    (e) => e.status === 409,
  );
  assert.deepEqual(h.store.reference(7, r.id, r.revision), {
    id: r.id,
    revision: r.revision,
    teamId: 1,
    playerId: "fictional",
    requesterId: 7,
  });
  assert.deepEqual(
    h.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((x) => x.name),
    ["player_ai_sources"],
  );
});
test("解码在途删除墓碑阻止迟到写入及同请求复活", async (t) => {
  const h = await fixture(t);
  const pending = h.store.upload(7, h.input);
  const processing = h.store.inspectRequest(7, h.input);
  assert.equal(processing.status, "processing");
  const deleted = h.store.remove(7, processing.id, processing.revision);
  await assert.rejects(pending, (e) => e.status === 409);
  assert.equal(
    h.db.prepare("SELECT data_url FROM player_ai_sources").get().data_url,
    null,
  );
  assert.equal(h.store.inspectRequest(7, h.input).revision, deleted.revision);
  await assert.rejects(h.store.upload(7, h.input), (e) => e.status === 409);
  assert.throws(
    () => h.store.read(7, deleted.id, deleted.revision),
    (e) => e.status === 409,
  );
});
test("解码在途撤权、授权ABA、到期均拒绝完成", async (t) => {
  for (const change of [
    (h) => h.revoke(),
    (h) => h.advanceAuthority(),
    (h) => h.consent.revision++,
    (h) => h.setTime(1000),
  ]) {
    const h = await fixture(t);
    const pending = h.store.upload(7, h.input);
    change(h);
    await assert.rejects(pending, (e) => [403, 409].includes(e.status));
    assert.equal(
      h.db.prepare("SELECT status FROM player_ai_sources").get().status,
      "failed",
    );
    assert.equal(
      h.db.prepare("SELECT data_url FROM player_ai_sources").get().data_url,
      null,
    );
  }
});
test("撤回后无图片访问但可清理，到期不返回引用，删除清除图像/摘要", async (t) => {
  const h = await fixture(t),
    r = await h.store.upload(7, h.input);
  h.consent.active = false;
  assert.throws(
    () => h.store.read(7, r.id, r.revision),
    (e) => e.status === 403,
  );
  assert.throws(
    () => h.store.reference(7, r.id, r.revision),
    (e) => e.status === 403,
  );
  const deleted = h.store.remove(7, r.id, r.revision);
  assert.equal(deleted.status, "deleted");
  const row = h.db.prepare("SELECT * FROM player_ai_sources").get();
  assert.equal(row.payload_hash, "");
  assert.equal(row.data_url, null);
  const other = await fixture(t),
    asset = await other.store.upload(7, other.input);
  other.setTime(1000);
  assert.throws(
    () => other.store.reference(7, asset.id, asset.revision),
    (e) => e.status === 409,
  );
});
test("参数/远程链接/过大/异步授权拒绝，错误解码不留原图", async (t) => {
  const h = await fixture(t);
  await assert.rejects(
    h.store.upload(7, { ...h.input, dataUrl: "https://example.invalid/photo" }),
    (e) => e.status === 400,
  );
  assert.equal(
    h.db.prepare("SELECT data_url FROM player_ai_sources").get().data_url,
    null,
  );
  await assert.rejects(
    h.store.upload(7, {
      ...h.input,
      requestId: "large",
      dataUrl: "x".repeat(2800001),
    }),
    (e) => e.status === 400,
  );
  await assert.rejects(
    h.store.upload(7, { ...h.input, requestId: "expiry", expiresAt: 2100 }),
    (e) => e.status === 400,
  );
  const bad = createPlayerAiAssets(h.db, {
    ...h.options,
    authorize: async () => true,
  });
  await assert.rejects(
    bad.upload(7, { ...h.input, requestId: "bad" }),
    (e) => e.status === 500,
  );
});

test("在途同request拒绝重复解码/记录，失败可删后用新请求重建", async (t) => {
  const h = await fixture(t),
    pending = h.store.upload(7, h.input);
  await assert.rejects(h.store.upload(7, h.input), (e) => e.status === 409);
  assert.equal(
    h.db.prepare("SELECT count(*) n FROM player_ai_sources").get().n,
    1,
  );
  const state = h.store.inspectRequest(7, h.input);
  assert.deepEqual(Object.keys(state).sort(), ["id", "revision", "status"]);
  await pending;
  await assert.rejects(
    h.store.upload(7, { ...h.input, requestId: "bad", dataUrl: "invalid" }),
    (e) => e.status === 400,
  );
  const failed = h.store.inspectRequest(7, { ...h.input, requestId: "bad" });
  assert.equal(
    h.db
      .prepare("SELECT payload_hash FROM player_ai_sources WHERE id=?")
      .get(failed.id).payload_hash,
    "",
  );
  h.store.remove(7, failed.id, failed.revision);
  assert.equal(
    (await h.store.upload(7, { ...h.input, requestId: "new-after-failure" }))
      .status,
    "ready",
  );
});

test("就绪素材授权撤回恢复后旧版本仍拒绝读取/引用/重放但可清理", async (t) => {
  for (const advance of [
    (h) => h.advanceAuthority(),
    (h) => h.consent.revision++,
  ]) {
    const h = await fixture(t),
      r = await h.store.upload(7, h.input);
    advance(h);
    assert.throws(
      () => h.store.read(7, r.id, r.revision),
      (e) => e.status === 409,
    );
    assert.throws(
      () => h.store.reference(7, r.id, r.revision),
      (e) => e.status === 409,
    );
    await assert.rejects(h.store.upload(7, h.input), (e) => e.status === 409);
    assert.equal(h.store.remove(7, r.id, r.revision).status, "deleted");
  }
});
test("事务预留覆盖processing，数量/字节配额拒绝并可删除释放", async (t) => {
  const h = await fixture(t);
  const bytesStore = createPlayerAiAssets(h.db, {
    ...h.options,
    maxStoredBytes: 2097152,
  });
  const pending = bytesStore.upload(7, h.input);
  await assert.rejects(
    bytesStore.upload(7, { ...h.input, requestId: "second" }),
    (e) => e.status === 429,
  );
  const ready = await pending;
  await assert.rejects(
    bytesStore.upload(7, { ...h.input, requestId: "second" }),
    (e) => e.status === 429,
  );
  bytesStore.remove(7, ready.id, ready.revision);
  assert.equal(
    (await bytesStore.upload(7, { ...h.input, requestId: "second" })).status,
    "ready",
  );
  const countStore = createPlayerAiAssets(h.db, {
    ...h.options,
    maxObjectsPerUploader: 1,
  });
  await assert.rejects(
    countStore.upload(7, { ...h.input, requestId: "third" }),
    (e) => e.status === 429,
  );
});

test("错误同意归属/用途及异步resolver均不能登记素材", async (t) => {
  for (const patch of [
    { teamId: 2 },
    { playerId: "other" },
    { requesterId: 8 },
    { purpose: "public-photo" },
  ]) {
    const h = await fixture(t);
    Object.assign(h.consent, patch);
    await assert.rejects(h.store.upload(7, h.input), (e) => e.status === 403);
    assert.equal(
      h.db.prepare("SELECT count(*) n FROM player_ai_sources").get().n,
      0,
    );
  }
  const h = await fixture(t),
    bad = createPlayerAiAssets(h.db, {
      ...h.options,
      resolveConsent: async () => h.consent,
    });
  await assert.rejects(bad.upload(7, h.input), (e) => e.status === 500);
  assert.equal(
    h.db.prepare("SELECT count(*) n FROM player_ai_sources").get().n,
    0,
  );
});
