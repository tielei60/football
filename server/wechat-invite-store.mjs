import { randomBytes, createHash } from "node:crypto";
import { WechatFoundationError } from "./wechat-provider.mjs";
const fail = (status, message) => {
  throw new WechatFoundationError(status, message);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (value, max = 128) => {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    fail(400, "邀请参数不正确。");
  return value;
};
const fields = (value, allowed) => {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    fail(400, "邀请参数不正确。");
  return value;
};
const sync = (fn, value) => {
  const result = fn(value);
  if (result?.then) fail(500, "邀请事务依赖必须同步执行。");
  return result;
};
// 只能由可信服务层装配；authorize 必须重新认证当前会话和同队active球员。
// bindIdentity 必须仅在给定同一 db 的当前事务内写绑定，不得外呼/提交/异步。
export function createWechatInviteStore(
  db,
  {
    enabled = false,
    authorize,
    isVerifiedIdentity,
    bindIdentity,
    now = Date.now,
  } = {},
) {
  const guard = () => {
    if (enabled !== true) fail(503, "微信邀请尚未启用。");
  };
  if (
    enabled &&
    [authorize, isVerifiedIdentity, bindIdentity].some(
      (fn) =>
        typeof fn !== "function" || fn.constructor.name === "AsyncFunction",
    )
  )
    fail(503, "微信邀请授权依赖不完整。");
  const tx = (work) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const q = (sql) => db.prepare(sql);
  // 确认元数据不等于停用账号；只约束新的邀请/认领/批准，历史查询与撤销保持。
  // 独立旧表没有该列时沿用已确认语义；主应用迁移默认值为1。
  const requireConfirmed = (teamId, playerId) => {
    const player = q("SELECT * FROM club_players WHERE team_id=? AND id=?").get(teamId, playerId);
    if (player?.membership_confirmed === 0)
      fail(409, "球员成员状态尚未确认，请先确认后再邀请或批准。");
  };
  const auth = (actor, target) => {
    const result = sync(authorize, {
      actor,
      teamId: target.team_id,
      playerId: target.player_id,
      db,
    });
    if (
      !result ||
      !Number.isSafeInteger(result.actorId) ||
      result.actorId < 1 ||
      result.teamId !== target.team_id ||
      result.playerId !== target.player_id ||
      result.role !== "admin" ||
      result.active !== true
    )
      fail(403, "没有管理该球员邀请的权限。");
    return result;
  };
  const view = (r) => ({
    id: r.id,
    teamId: r.team_id,
    playerId: r.player_id,
    appId: r.app_id,
    status: r.status,
    revision: r.revision,
    expiresAt: r.expires_at,
    confirmationCode: r.claim_confirmation_code ?? null,
  });
  const get = (id) => {
    const r = q("SELECT * FROM wechat_invites_foundation WHERE id=?").get(
      text(id),
    );
    if (!r) fail(404, "邀请不存在。");
    return r;
  };
  const expire = () =>
    q(
      "UPDATE wechat_invites_foundation SET status='expired',revision=revision+1 WHERE status IN ('pending','claimed') AND expires_at<=?",
    ).run(now());
  const validIdentity = (identity) => {
    if (sync(isVerifiedIdentity, identity) !== true)
      fail(401, "请先完成服务端微信身份验证。");
    return identity;
  };
  return {
    initialize() {
      guard();
      return tx(() => {
        // 不改 club_users/club_sessions，也不由模块加载自动执行迁移。
        db.exec(`CREATE TABLE IF NOT EXISTS wechat_invites_foundation (
        id TEXT PRIMARY KEY, team_id INTEGER NOT NULL, player_id TEXT NOT NULL, app_id TEXT NOT NULL,
        actor_id INTEGER NOT NULL, request_id TEXT NOT NULL, request_hash TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','claimed','approved','rejected','revoked','expired')),
        revision INTEGER NOT NULL DEFAULT 1, claim_openid TEXT, claim_request_id TEXT, claim_confirmation_code TEXT,
        FOREIGN KEY(team_id,player_id) REFERENCES club_players(team_id,id), FOREIGN KEY(actor_id) REFERENCES club_users(id),
        UNIQUE(actor_id,request_id)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS wechat_invites_foundation_active ON wechat_invites_foundation(app_id,team_id,player_id) WHERE status IN ('pending','claimed');`);
        if (
          !q("PRAGMA table_info(wechat_invites_foundation)")
            .all()
            .some((c) => c.name === "claim_confirmation_code")
        )
          db.exec(
            "ALTER TABLE wechat_invites_foundation ADD COLUMN claim_confirmation_code TEXT",
          );
        // 旧待审批申请无核对码，撤销后重新邀请，不能绕过二次核验。
        q(
          "UPDATE wechat_invites_foundation SET status='revoked',revision=revision+1 WHERE status='claimed' AND claim_confirmation_code IS NULL",
        ).run();
      });
    },
    create(actor, input) {
      const {
        teamId,
        playerId,
        appId,
        requestId,
        ttlMs = 86400000,
      } = fields(input, ["teamId", "playerId", "appId", "requestId", "ttlMs"]);
      guard();
      text(playerId);
      text(requestId);
      if (
        !Number.isSafeInteger(teamId) ||
        teamId < 1 ||
        !/^wx[0-9a-f]{16}$/.test(appId || "") ||
        !Number.isInteger(ttlMs) ||
        ttlMs < 1000 ||
        ttlMs > 86400000
      )
        fail(400, "邀请参数不正确。");
      return tx(() => {
        const a = auth(actor, { team_id: teamId, player_id: playerId });
        expire();
        const digest = hash(JSON.stringify([teamId, playerId, appId, ttlMs]));
        const old = q(
          "SELECT * FROM wechat_invites_foundation WHERE actor_id=? AND request_id=?",
        ).get(a.actorId, requestId);
        if (old) {
          if (old.request_hash !== digest)
            fail(409, "请求编号已经用于其他邀请。");
          return { ...view(old), credentialUnavailable: true };
        }
        requireConfirmed(teamId, playerId);
        if (
          q(
            "SELECT id FROM wechat_invites_foundation WHERE app_id=? AND team_id=? AND player_id=? AND status IN ('pending','claimed')",
          ).get(appId, teamId, playerId)
        )
          fail(409, "请先撤销原邀请再重新创建。");
        if (
          q(
            "SELECT count(*) AS n FROM wechat_invites_foundation WHERE status IN ('pending','claimed')",
          ).get().n >= 1000
        )
          fail(429, "待处理邀请过多，请先清理或稍后重试。");
        const id = randomBytes(16).toString("hex"),
          credential = randomBytes(32).toString("hex");
        q(
          "INSERT INTO wechat_invites_foundation(id,team_id,player_id,app_id,actor_id,request_id,request_hash,token_hash,expires_at,status) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          teamId,
          playerId,
          appId,
          a.actorId,
          requestId,
          digest,
          hash(credential),
          now() + ttlMs,
          "pending",
        );
        return { ...view(get(id)), credential };
      });
    },
    inspect(actor, id) {
      guard();
      return tx(() => {
        const r = get(id);
        auth(actor, r);
        expire();
        return view(get(id));
      });
    },
    verifyCredential(actor, id, credential) {
      guard();
      if (!/^[a-f0-9]{64}$/.test(credential || "")) fail(400, "邀请凭据无效。");
      return tx(() => {
        const row = get(id);
        auth(actor, row);
        expire();
        const current = get(id);
        if (current.status !== "pending" || current.token_hash !== hash(credential))
          fail(409, "邀请无效或已过期，请重新核对。");
        return view(current);
      });
    },
    claim(identity, input) {
      guard();
      const { credential, requestId } = fields(input, [
        "credential",
        "requestId",
      ]);
      validIdentity(identity);
      text(credential, 64);
      text(requestId);
      if (!/^[a-f0-9]{64}$/.test(credential)) fail(400, "邀请凭据无效。");
      const result = tx(() => {
        const r = q(
          "SELECT * FROM wechat_invites_foundation WHERE token_hash=?",
        ).get(hash(credential));
        // 丢响应后的本人终态恢复仅派生元数据，不修改任何行、版本或绑定。
        // 到期但尚未落库的 claimed 也只返回 expired，不运行全局 expire 写入。
        if (
          r &&
          r.app_id === identity.appId &&
          r.claim_openid === identity.openid &&
          (["approved", "rejected", "revoked", "expired"].includes(r.status) ||
            (r.status === "claimed" && r.expires_at <= now()))
        ) {
          return {
            id: r.id,
            status: r.status === "claimed" ? "expired" : r.status,
            revision: r.revision,
            confirmationCode: r.claim_confirmation_code ?? null,
          };
        }
        if (
          !r ||
          r.app_id !== identity.appId ||
          r.expires_at <= now() ||
          !["pending", "claimed"].includes(r.status)
        )
          fail(409, "邀请不可用，请联系管理员。");
        const player = q(
          "SELECT status FROM club_players WHERE team_id=? AND id=?",
        ).get(r.team_id, r.player_id);
        if (!player || player.status !== "active") {
          q(
            "UPDATE wechat_invites_foundation SET status='revoked',revision=revision+1 WHERE id=?",
          ).run(r.id);
          return null;
        }
        if (r.status === "claimed") {
          // 同一服务端验证身份可在丢响应/重启后恢复，不改变初次申请及版本。
          if (r.claim_openid !== identity.openid)
            fail(409, "邀请已有待审核申请。");
        } else {
          requireConfirmed(r.team_id, r.player_id);
          q(
            "UPDATE wechat_invites_foundation SET status='claimed',claim_openid=?,claim_request_id=?,claim_confirmation_code=?,revision=revision+1 WHERE id=?",
          ).run(
            identity.openid,
            requestId,
            randomBytes(4).toString("hex").toUpperCase(),
            r.id,
          );
        }
        // 认领者只得到自身申请状态；不发业务session，不返回球员/球队资料。
        return {
          id: r.id,
          status: "claimed",
          revision: get(r.id).revision,
          confirmationCode: get(r.id).claim_confirmation_code,
        };
      });
      if (!result) fail(409, "邀请不可用，请联系管理员。");
      return result;
    },
    list(actor, input) {
      guard();
      const {
        teamId,
        playerId,
        appId,
        limit = 20,
        cursor = null,
      } = fields(input, ["teamId", "playerId", "appId", "limit", "cursor"]);
      if (
        typeof appId !== "string" ||
        !/^wx[0-9a-f]{16}$/.test(appId) ||
        !Number.isSafeInteger(teamId) ||
        teamId < 1 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        (cursor !== null && !/^[a-f0-9]{32}$/.test(cursor))
      )
        fail(400, "邀请分页参数不正确。");
      text(playerId);
      return tx(() => {
        auth(actor, { team_id: teamId, player_id: playerId });
        expire();
        if (
          cursor !== null &&
          !q(
            "SELECT id FROM wechat_invites_foundation WHERE id=? AND app_id=? AND team_id=? AND player_id=?",
          ).get(cursor, appId, teamId, playerId)
        )
          fail(400, "分页位置不属于当前邀请列表。");
        const rows = q(
          "SELECT * FROM wechat_invites_foundation WHERE app_id=? AND team_id=? AND player_id=? AND id>? ORDER BY id LIMIT ?",
        ).all(appId, teamId, playerId, cursor ?? "", limit + 1);
        const active = q(
          "SELECT * FROM wechat_invites_foundation WHERE app_id=? AND team_id=? AND player_id=? AND status IN ('pending','claimed')",
        ).get(appId, teamId, playerId);
        return {
          activeInvite: active ? view(active) : null,
          items: rows.slice(0, limit).map(view),
          nextCursor: rows.length > limit ? rows[limit - 1].id : null,
        };
      });
    },
    claimStatus(identity, id) {
      guard();
      validIdentity(identity);
      return tx(() => {
        const r = get(id);
        if (r.app_id !== identity.appId || r.claim_openid !== identity.openid)
          fail(404, "申请不存在。");
        expire();
        const current = get(id);
        return {
          id: current.id,
          status: current.status,
          revision: current.revision,
          confirmationCode: current.claim_confirmation_code ?? null,
        };
      });
    },
    decide(actor, input) {
      guard();
      const { id, revision, action, confirmationCode } = fields(input, [
        "id",
        "revision",
        "action",
        "confirmationCode",
      ]);
      if (
        !["approve", "reject", "revoke"].includes(action) ||
        !Number.isSafeInteger(revision) ||
        revision < 1
      )
        fail(400, "邀请操作不正确。");
      return tx(() => {
        const before = get(id);
        const a = auth(actor, before);
        expire();
        const r = get(id);
        if (r.revision !== revision) fail(409, "邀请已变化，请重新核对。");
        if (
          !["pending", "claimed"].includes(r.status) ||
          (action !== "revoke" && r.status !== "claimed")
        )
          fail(409, "当前邀请状态不允许此操作。");
        if (action === "approve") {
          requireConfirmed(r.team_id, r.player_id);
          if (
            typeof confirmationCode !== "string" ||
            !/^[A-F0-9]{8}$/.test(confirmationCode) ||
            confirmationCode !== r.claim_confirmation_code
          )
            fail(409, "核对编号不匹配，请与申请人重新核实。");
          const binding = sync(bindIdentity, {
            db,
            authorization: a,
            appId: r.app_id,
            openid: r.claim_openid,
            teamId: r.team_id,
            playerId: r.player_id,
          });
          if (
            !binding ||
            !Number.isSafeInteger(binding.userId) ||
            binding.userId < 1
          )
            fail(500, "身份绑定未完成。");
        }
        const status = {
          approve: "approved",
          reject: "rejected",
          revoke: "revoked",
        }[action];
        q(
          "UPDATE wechat_invites_foundation SET status=?,revision=revision+1 WHERE id=?",
        ).run(status, id);
        return view(get(id));
      });
    },
  };
}
