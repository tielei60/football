import { createHash } from "node:crypto";
import { FootballError } from "./football-store.mjs";
const fail = (status, message) => {
  throw new FootballError(status, message);
};
const digest = (value) =>
  createHash("sha256").update(String(value)).digest("hex");
export function wechatFields(input, allowed, required = []) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !allowed.includes(k)) ||
    required.some((k) => input[k] === undefined)
  )
    fail(400, "微信请求参数不正确。");
  return input;
}
// 单进程有界防护；不信任 forwarded header，此处 IP 必须由 HTTP 已配置代理规则提供。
export function createWechatAuthService({ provider, club, now = Date.now }) {
  const buckets = new Map();
  let inFlight = 0;
  function limit(namespace, key, max) {
    const time = now();
    for (const [k, v] of buckets) if (v.until <= time) buckets.delete(k);
    const id = namespace + ":" + digest(key);
    let bucket = buckets.get(id);
    if (!bucket) {
      // 不以删除其他活跃计数来给攻击者无限新 key 绕过。
      if (buckets.size >= 10000) fail(429, "请求过多，请稍后再试。");
      bucket = { count: 0, until: time + 60000 };
      buckets.set(id, bucket);
    }
    if (++bucket.count > max) fail(429, "请求过多，请稍后再试。");
  }
  const guard = () => {
    if (!provider.enabled) fail(503, "微信认证尚未启用。");
  };
  return {
    enabled: provider.enabled,
    async inviteCode(actor, playerId, id, input) {
      guard();
      const u = club.authenticate(actor.token, actor.transport);
      if (u.role !== "admin") fail(403, "此操作需要管理员权限。");
      limit("admin", u.id, 60);
      wechatFields(input, ["credential"], ["credential"]);
      club.wechat.verifyCredential(actor, playerId, id, input.credential);
      const image = await provider.inviteCode(input.credential);
      club.wechat.verifyCredential(actor, playerId, id, input.credential);
      return { image };
    },
    async preauth(action, input, ip) {
      guard();
      limit("ip", ip || "unknown", 30);
      const allowed = {
        claim: ["code", "credential", "requestId"],
        "claim-status": ["code", "inviteId"],
        login: ["code"],
      }[action];
      if (!allowed) fail(404, "认证操作不存在。");
      wechatFields(input, allowed, allowed);
      if (
        typeof input.code !== "string" ||
        !input.code ||
        input.code.length > 512 ||
        /[\x00-\x20]/.test(input.code)
      )
        fail(400, "微信登录凭据不正确。");
      if (
        action === "claim" &&
        (typeof input.requestId !== "string" ||
          !input.requestId ||
          input.requestId.length > 128 ||
          /[\x00-\x1f\x7f]/.test(input.requestId))
      )
        fail(400, "请求编号不正确。");
      if (
        action === "claim-status" &&
        (typeof input.inviteId !== "string" ||
          !/^[a-f0-9]{32}$/.test(input.inviteId))
      )
        fail(400, "邀请编号不正确。");
      if (action === "claim") {
        if (
          typeof input.credential !== "string" ||
          !/^[a-f0-9]{64}$/.test(input.credential)
        )
          fail(400, "邀请凭据无效。");
        limit("invite", input.credential, 10);
      }
      if (inFlight >= 16) fail(429, "微信认证繁忙，请稍后再试。");
      const epoch = club.wechat.epoch();
      let identity;
      inFlight++;
      try {
        identity = await provider.exchange(input.code);
      } finally {
        inFlight--;
      }
      club.wechat.checkEpoch(epoch);
      limit("identity", identity.appId + "\0" + identity.openid, 30);
      if (action === "claim")
        return club.wechat.claim(
          identity,
          { credential: input.credential, requestId: input.requestId },
          epoch,
        );
      if (action === "claim-status")
        return club.wechat.status(identity, input.inviteId, epoch);
      return club.wechat.login(identity, epoch);
    },
    manage(actor, playerId, action, input = {}) {
      guard();
      const u = club.authenticate(actor.token, actor.transport);
      if (u.role !== "admin") fail(403, "此操作需要管理员权限。");
      limit("admin", u.id, 60);
      limit("team", u.team_id, 300);
      if (action === "create")
        return club.wechat.create(
          actor,
          playerId,
          wechatFields(input, ["requestId", "ttlMs"], ["requestId"]),
        );
      if (action === "list")
        return club.wechat.list(
          actor,
          playerId,
          wechatFields(input, ["limit", "cursor"]),
        );
      if (action === "binding") return club.wechat.binding(actor, playerId);
      if (action === "unbind")
        return club.wechat.unbind(
          actor,
          playerId,
          wechatFields(input, ["revision"], ["revision"]),
        );
      const { id, ...body } = input;
      if (!["approve", "reject", "revoke"].includes(action))
        fail(404, "邀请操作不存在。");
      wechatFields(
        body,
        action === "approve" ? ["revision", "confirmationCode"] : ["revision"],
        action === "approve" ? ["revision", "confirmationCode"] : ["revision"],
      );
      return club.wechat.decide(actor, playerId, id, body, action);
    },
  };
}
