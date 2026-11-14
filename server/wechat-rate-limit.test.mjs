import test from "node:test";
import assert from "node:assert/strict";
import { createWechatAuthService } from "./wechat-auth-service.mjs";
function fixture() {
  let calls = 0,
    now = 100;
  const identity = { appId: "test-app", openid: "same-test-identity" };
  const service = createWechatAuthService({
    now: () => now,
    provider: {
      enabled: true,
      exchange: async () => {
        calls++;
        return identity;
      },
    },
    club: {
      authenticate: () => ({ id: 1, role: "admin", team_id: 1 }),
      wechat: {
        epoch: () => 1,
        checkEpoch: () => {},
        login: () => ({ ok: true }),
        claim: () => ({ status: "claimed" }),
        create: () => ({}),
        status: () => ({}),
      },
    },
  });
  return { service, calls: () => calls, advance: () => (now += 60001) };
}
test("validated identity and invitation rates apply across distinct IPs; expired window recovers", async () => {
  const f = fixture();
  for (let i = 0; i < 30; i++)
    await f.service.preauth("login", { code: "test-code" }, `ip-${i}`);
  await assert.rejects(
    f.service.preauth("login", { code: "test-code" }, "different-ip"),
    (e) => e.status === 429,
  );
  f.advance();
  assert.deepEqual(
    await f.service.preauth("login", { code: "test-code" }, "different-ip"),
    { ok: true },
  );
  const other = fixture();
  for (let i = 0; i < 10; i++)
    await other.service.preauth(
      "claim",
      { code: "test-code", credential: "a".repeat(64), requestId: "id" },
      `ip-${i}`,
    );
  await assert.rejects(
    other.service.preauth(
      "claim",
      { code: "test-code", credential: "a".repeat(64), requestId: "id" },
      "ip-last",
    ),
    (e) => e.status === 429,
  );
  assert.equal(other.calls(), 10);
});
test("malformed preauth fields fail before one-time code exchange", async () => {
  const f = fixture();
  for (const [action, input] of [
    ["claim", { code: "test-code", credential: "a".repeat(64), requestId: 2 }],
    ["claim-status", { code: "test-code", inviteId: [] }],
    ["login", { code: "x y" }],
    ["login", { code: "good", role: "admin" }],
  ])
    await assert.rejects(
      f.service.preauth(action, input, "ip"),
      (e) => e.status === 400,
    );
  assert.equal(f.calls(), 0);
});
test("admin limits do not evict live keys; global bounded key table fails closed", async () => {
  const f = fixture();
  for (let i = 0; i < 60; i++)
    f.service.manage({}, "p", "create", { requestId: "test" });
  assert.throws(
    () => f.service.manage({}, "p", "create", { requestId: "test" }),
    (e) => e.status === 429,
  );
  const other = fixture();
  // 无效参数也先占受限IP桶，模拟IP轮换；满表后拒绝而不是删活跃桶重置限制。
  for (let i = 0; i < 10000; i++)
    await assert.rejects(
      other.service.preauth("login", {}, `ip-${i}`),
      (e) => e.status === 400,
    );
  await assert.rejects(
    other.service.preauth("login", {}, "extra-ip"),
    (e) => e.status === 429,
  );
  other.advance();
  await assert.rejects(
    other.service.preauth("login", {}, "extra-ip"),
    (e) => e.status === 400,
  );
});
test("bounded concurrent exchanges release capacity after success and failure", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  let fail = false;
  const service = createWechatAuthService({
    provider: {
      enabled: true,
      exchange: async () => {
        await gate;
        if (fail) throw Error("fictional failure");
        return { appId: "test", openid: "test" };
      },
    },
    club: {
      wechat: { epoch: () => 1, checkEpoch: () => {}, login: () => ({}) },
    },
  });
  const requests = Array.from({ length: 16 }, (_, i) =>
    service.preauth("login", { code: "test" }, `ip-${i}`),
  );
  await assert.rejects(
    service.preauth("login", { code: "test" }, "ip-overflow"),
    (e) => e.status === 429,
  );
  release();
  await Promise.all(requests);
  fail = true;
  await assert.rejects(service.preauth("login", { code: "test" }, "ip-error"));
  fail = false;
  assert.deepEqual(
    await service.preauth("login", { code: "test" }, "ip-after"),
    {},
  );
});
