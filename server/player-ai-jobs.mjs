import { createHash, randomUUID } from "node:crypto";
import { FootballError } from "./football-store.mjs";
const fail = (status, message) => {
  throw new FootballError(status, message);
};
const id = (value) => {
  if (typeof value !== "string" || !/^[-A-Za-z0-9_]{1,128}$/.test(value))
    fail(400, "任务引用无效。");
  return value;
};
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const sync = (fn, ...args) => {
  const result = fn(...args);
  if (result?.then) fail(500, "领域授权依赖必须同步。");
  return result;
};
const fields = (v, keys) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail(400, "任务参数无效。");
};

// 未接HTTP/worker/provider。所有依赖只允许可信服务端装配，不能由请求体配置。
export function createPlayerAiJobs(
  db,
  { enabled = false, authorize, resolveConsent, policy, now = Date.now } = {},
) {
  const guard = () => {
    if (enabled !== true) fail(503, "AI照片任务尚未启用。");
    if (
      typeof authorize !== "function" ||
      typeof resolveConsent !== "function" ||
      !policy ||
      !/^[A-Z]{3}$/.test(policy.currency || "") ||
      !integer(policy.budgetMinor) ||
      !integer(policy.maxJobMinor) ||
      policy.maxJobMinor > policy.budgetMinor ||
      !Number.isSafeInteger(policy.maxActive) ||
      policy.maxActive < 1 ||
      policy.maxActive > 100 ||
      !Number.isSafeInteger(policy.maxCandidates) ||
      policy.maxCandidates < 1 ||
      policy.maxCandidates > 9
    )
      fail(503, "任务授权或预算策略未配置。");
  };
  const q = (sql) => db.prepare(sql);
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const auth = (actor, j) => {
    const a = sync(authorize, actor, {
      teamId: j.team_id,
      playerId: j.player_id,
      requesterId: j.requester_id,
    });
    if (
      !a ||
      a.role !== "admin" ||
      a.active !== true ||
      a.teamId !== j.team_id ||
      a.playerId !== j.player_id ||
      a.requesterId !== j.requester_id
    )
      fail(403, "没有访问该私有任务的权限。");
  };
  const consent = (j) => {
    const c = sync(resolveConsent, j.consent_id);
    if (
      !c ||
      c.active !== true ||
      !Number.isSafeInteger(c.expiresAt) ||
      c.expiresAt <= now() ||
      c.teamId !== j.team_id ||
      c.playerId !== j.player_id ||
      c.requesterId !== j.requester_id ||
      c.sourceId !== j.source_id ||
      c.purpose !== j.purpose ||
      c.styleId !== j.style_id ||
      c.providerId !== j.provider_id ||
      c.termsVersion !== j.terms_version ||
      c.currency !== j.currency ||
      !integer(c.maxAmountMinor) ||
      c.maxAmountMinor < j.reserved_minor
    )
      fail(403, "该次照片处理授权无效或已撤回。");
  };
  const getRow = (jobId) => {
    const r = q("SELECT * FROM player_ai_jobs WHERE id=?").get(id(jobId));
    if (!r) fail(404, "任务不存在。");
    return r;
  };
  const view = (r) => ({
    id: r.id,
    teamId: r.team_id,
    playerId: r.player_id,
    requesterId: r.requester_id,
    status: r.status,
    revision: r.revision,
    currency: r.currency,
    reservedMinor: r.reserved_minor,
    chargedMinor: r.charged_minor,
    candidates: JSON.parse(r.candidates),
    createdAt: r.created_at,
  });
  const check = (actor, jobId, revision, needConsent = true) => {
    const r = getRow(jobId);
    auth(actor, r);
    if (needConsent) consent(r);
    if (r.revision !== revision) fail(409, "任务已变化，请重新读取。");
    return r;
  };
  return {
    initialize() {
      guard();
      db.exec(`CREATE TABLE IF NOT EXISTS player_ai_jobs (
      id TEXT PRIMARY KEY,team_id INTEGER NOT NULL,player_id TEXT NOT NULL,requester_id INTEGER NOT NULL,
      request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,consent_id TEXT NOT NULL,source_id TEXT NOT NULL,
      purpose TEXT NOT NULL,style_id TEXT NOT NULL,provider_id TEXT NOT NULL,terms_version TEXT NOT NULL,
      currency TEXT NOT NULL,reserved_minor INTEGER NOT NULL,charged_minor INTEGER,settlement_ref TEXT,
      status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,candidates TEXT NOT NULL DEFAULT '[]',
      external_ref TEXT,created_at INTEGER NOT NULL,UNIQUE(team_id,requester_id,request_id)
    ) STRICT;`);
    },
    create(actor, input) {
      guard();
      fields(input, [
        "teamId",
        "playerId",
        "requesterId",
        "requestId",
        "consentId",
        "sourceId",
        "purpose",
        "styleId",
        "providerId",
        "termsVersion",
        "amountMinor",
      ]);
      if (
        !Number.isSafeInteger(input.teamId) ||
        input.teamId < 1 ||
        !Number.isSafeInteger(input.requesterId) ||
        input.requesterId < 1 ||
        !integer(input.amountMinor) ||
        input.amountMinor > policy.maxJobMinor ||
        !["avatar", "portrait"].includes(input.purpose)
      )
        fail(400, "任务用途或预算无效。");
      for (const k of [
        "playerId",
        "requestId",
        "consentId",
        "sourceId",
        "styleId",
        "providerId",
        "termsVersion",
      ])
        id(input[k]);
      const j = {
        team_id: input.teamId,
        player_id: input.playerId,
        requester_id: input.requesterId,
        consent_id: input.consentId,
        source_id: input.sourceId,
        purpose: input.purpose,
        style_id: input.styleId,
        provider_id: input.providerId,
        terms_version: input.termsVersion,
        currency: policy.currency,
        reserved_minor: input.amountMinor,
      };
      const hash = createHash("sha256").update(JSON.stringify(j)).digest("hex");
      return tx(() => {
        auth(actor, j);
        consent(j);
        const old = q(
          "SELECT * FROM player_ai_jobs WHERE team_id=? AND requester_id=? AND request_id=?",
        ).get(j.team_id, j.requester_id, input.requestId);
        if (old) {
          if (old.payload_hash !== hash) fail(409, "请求编号已用于不同任务。");
          return view(old);
        }
        const used = q(
          "SELECT COALESCE(SUM(COALESCE(charged_minor,reserved_minor)),0) n FROM player_ai_jobs WHERE team_id=? AND currency=?",
        ).get(j.team_id, j.currency).n;
        if (!integer(used) || input.amountMinor > policy.budgetMinor - used)
          fail(409, "球队预算不足。");
        const active = q(
          "SELECT count(*) n FROM player_ai_jobs WHERE team_id=? AND status IN ('queued','submitting','submission_unknown','submitted','running')",
        ).get(j.team_id).n;
        if (active >= policy.maxActive) fail(429, "球队待处理任务过多。");
        const jobId = randomUUID();
        q(
          `INSERT INTO player_ai_jobs(id,team_id,player_id,requester_id,request_id,payload_hash,consent_id,source_id,purpose,style_id,provider_id,terms_version,currency,reserved_minor,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'queued',?)`,
        ).run(
          jobId,
          j.team_id,
          j.player_id,
          j.requester_id,
          input.requestId,
          hash,
          j.consent_id,
          j.source_id,
          j.purpose,
          j.style_id,
          j.provider_id,
          j.terms_version,
          j.currency,
          j.reserved_minor,
          now(),
        );
        return view(getRow(jobId));
      });
    },
    get(actor, jobId) {
      guard();
      const r = getRow(jobId);
      auth(actor, r);
      consent(r);
      return view(r);
    },
    transition(actor, jobId, revision, event, payload = {}) {
      guard();
      fields(payload, ["externalRef", "candidates"]);
      return tx(() => {
        const r = check(actor, jobId, revision),
          transitions = {
            submit: { queued: "submitting" },
            submitted: {
              submitting: "submitted",
              submission_unknown: "submitted",
            },
            unknown: { submitting: "submission_unknown" },
            running: { submitted: "running" },
            succeed: { submitted: "succeeded", running: "succeeded" },
            fail: {
              submitting: "failed",
              submitted: "failed",
              running: "failed",
            },
          };
        const next = transitions[event]?.[r.status];
        if (!next) fail(409, "任务状态不允许该操作，未知提交不得自动重试。");
        let candidates = [];
        if (event === "succeed") {
          if (
            !Array.isArray(payload.candidates) ||
            !payload.candidates.length ||
            payload.candidates.length > policy.maxCandidates
          )
            fail(400, "候选数量无效。");
          candidates = payload.candidates.map((c) => {
            fields(c, ["id", "objectId", "width", "height", "mimeType"]);
            id(c.id);
            id(c.objectId);
            if (
              !Number.isSafeInteger(c.width) ||
              !Number.isSafeInteger(c.height) ||
              c.width < 1 ||
              c.height < 1 ||
              c.width > 8192 ||
              c.height > 8192 ||
              !["image/jpeg", "image/png"].includes(c.mimeType)
            )
              fail(400, "私有候选元数据无效。");
            return { ...c, aiGenerated: true };
          });
          if (new Set(candidates.map((c) => c.id)).size !== candidates.length)
            fail(400, "候选编号重复。");
        } else if (payload.candidates !== undefined)
          fail(400, "此状态不能写候选。");
        const external =
          payload.externalRef === undefined
            ? r.external_ref
            : id(payload.externalRef);
        if (event === "submitted" && !external)
          fail(400, "缺少已受理任务引用。");
        if (payload.externalRef !== undefined && event !== "submitted")
          fail(400, "此状态不能更新受理引用。");
        if (r.external_ref && external !== r.external_ref)
          fail(409, "受理任务引用不一致。");
        q(
          "UPDATE player_ai_jobs SET status=?,revision=revision+1,external_ref=?,candidates=? WHERE id=?",
        ).run(next, external, JSON.stringify(candidates), r.id);
        return view(getRow(r.id));
      });
    },
    cancel(actor, jobId, revision) {
      guard();
      return tx(() => {
        const r = check(actor, jobId, revision, false);
        if (r.status === "cancelled") return view(r);
        // 本地取消仅禁止继续和采用，不代表提供方已取消或免收费。
        q(
          "UPDATE player_ai_jobs SET status='cancelled',candidates='[]',revision=revision+1,charged_minor=CASE WHEN status='queued' THEN 0 ELSE charged_minor END WHERE id=?",
        ).run(r.id);
        return view(getRow(r.id));
      });
    },
    settle(actor, jobId, revision, input) {
      fields(input, ["amountMinor", "settlementRef"]);
      const { amountMinor, settlementRef } = input;
      guard();
      id(settlementRef);
      if (!integer(amountMinor)) fail(400, "费用必须是最小货币单位整数。");
      return tx(() => {
        const r = check(actor, jobId, revision, false);
        if (
          !["succeeded", "failed", "cancelled"].includes(r.status) ||
          amountMinor > r.reserved_minor
        )
          fail(409, "费用结果需核验，不能超出已授权额度。");
        if (r.charged_minor !== null) {
          if (
            r.charged_minor === amountMinor &&
            r.settlement_ref === settlementRef
          )
            return { ...view(r), candidates: [] };
          fail(409, "费用已结算，不能覆盖。");
        }
        q(
          "UPDATE player_ai_jobs SET charged_minor=?,settlement_ref=?,revision=revision+1 WHERE id=?",
        ).run(amountMinor, settlementRef, r.id);
        return { ...view(getRow(r.id)), candidates: [] };
      });
    },
  };
}
