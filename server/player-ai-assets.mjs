import { createHash, randomUUID } from "node:crypto";
import { FootballError } from "./football-store.mjs";
import { sanitizePlayerPhoto } from "./player-media-store.mjs";
const fail = (status, message) => {
  throw new FootballError(status, message);
};
const validId = (v) =>
  typeof v === "string" && /^[-A-Za-z0-9_]{1,128}$/.test(v);
const version = (v) => Number.isSafeInteger(v) && v > 0;
const sync = (fn, ...args) => {
  const r = fn(...args);
  if (r?.then) fail(500, "素材授权依赖必须同步。");
  return r;
};
const fields = (v, keys) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail(400, "素材参数无效。");
};
// 仅私有来源领域模块，不接HTTP、供应商、候选写入或公开媒体。
export function createPlayerAiAssets(
  db,
  {
    enabled = false,
    authorize,
    resolveConsent,
    maxLifetimeMs,
    maxObjectsPerUploader,
    maxStoredBytes,
    now = Date.now,
  } = {},
) {
  const guard = () => {
    if (enabled !== true) fail(503, "AI私有素材尚未启用。");
    if (
      typeof authorize !== "function" ||
      typeof resolveConsent !== "function" ||
      !version(maxObjectsPerUploader) ||
      maxObjectsPerUploader > 1000 ||
      !version(maxStoredBytes) ||
      maxStoredBytes < 2 * 1024 * 1024 ||
      !version(maxLifetimeMs) ||
      maxLifetimeMs > 30 * 86400000
    )
      fail(503, "素材授权或保留策略未配置。");
  };
  const q = (sql) => db.prepare(sql),
    tx = (fn) => {
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
  const authority = (actor, r) => {
    const a = sync(authorize, actor, {
      teamId: r.team_id,
      playerId: r.player_id,
      requesterId: r.requester_id,
    });
    if (
      !a ||
      a.role !== "admin" ||
      a.active !== true ||
      a.teamId !== r.team_id ||
      a.playerId !== r.player_id ||
      a.requesterId !== r.requester_id ||
      !version(a.revision)
    )
      fail(403, "没有访问该私有来源的权限。");
    return a.revision;
  };
  const consent = (r) => {
    const c = sync(resolveConsent, r.consent_id);
    if (
      !c ||
      c.active !== true ||
      !version(c.revision) ||
      !Number.isSafeInteger(c.expiresAt) ||
      c.expiresAt <= now() ||
      c.teamId !== r.team_id ||
      c.playerId !== r.player_id ||
      c.requesterId !== r.requester_id ||
      c.purpose !== "private-ai-source"
    )
      fail(403, "私有来源处理授权无效或已撤回。");
    return c;
  };
  const row = (objectId) => {
    if (!validId(objectId)) fail(400, "素材编号无效。");
    const r = q("SELECT * FROM player_ai_sources WHERE id=?").get(objectId);
    if (!r) fail(404, "素材不存在。");
    return r;
  };
  const usable = (r) => {
    if (r.status !== "ready" || r.expires_at <= now())
      fail(409, "素材尚不可用、已删除或已过期。");
  };
  const meta = (r) => ({
    id: r.id,
    revision: r.revision,
    status: r.status,
    expiresAt: r.expires_at,
    mimeType: r.mime_type,
    width: r.width,
    height: r.height,
    byteSize: r.byte_size,
  });
  return {
    initialize() {
      guard();
      db.exec(`CREATE TABLE IF NOT EXISTS player_ai_sources (
   id TEXT PRIMARY KEY,team_id INTEGER NOT NULL,player_id TEXT NOT NULL,requester_id INTEGER NOT NULL,
   request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,consent_id TEXT NOT NULL,
   authority_revision INTEGER NOT NULL,consent_revision INTEGER NOT NULL,expires_at INTEGER NOT NULL,
   status TEXT NOT NULL CHECK(status IN ('processing','ready','failed','deleted')),revision INTEGER NOT NULL DEFAULT 1,
   data_url TEXT,mime_type TEXT,width INTEGER,height INTEGER,byte_size INTEGER,
   UNIQUE(team_id,requester_id,request_id)
  ) STRICT;`);
    },
    async upload(actor, input) {
      guard();
      fields(input, [
        "teamId",
        "playerId",
        "requesterId",
        "requestId",
        "consentId",
        "expiresAt",
        "dataUrl",
      ]);
      if (
        !version(input.teamId) ||
        !version(input.requesterId) ||
        !["playerId", "requestId", "consentId"].every((k) =>
          validId(input[k]),
        ) ||
        !Number.isSafeInteger(input.expiresAt) ||
        input.expiresAt <= now() ||
        input.expiresAt - now() > maxLifetimeMs ||
        typeof input.dataUrl !== "string" ||
        input.dataUrl.length > 2800000
      )
        fail(400, "素材范围、大小或到期时间无效。");
      const base = {
        team_id: input.teamId,
        player_id: input.playerId,
        requester_id: input.requesterId,
        consent_id: input.consentId,
      };
      const payloadHash = createHash("sha256")
        .update(JSON.stringify([base, input.expiresAt, input.dataUrl]))
        .digest("hex");
      let replay = false;
      const pending = tx(() => {
        const authRevision = authority(actor, base),
          c = consent(base);
        if (input.expiresAt > c.expiresAt)
          fail(400, "素材保留时间不能超过授权有效期。");
        const old = q(
          "SELECT * FROM player_ai_sources WHERE team_id=? AND requester_id=? AND request_id=?",
        ).get(base.team_id, base.requester_id, input.requestId);
        if (old) {
          if (old.status === "deleted" || old.payload_hash !== payloadHash)
            fail(409, "请求已删除或已用于其他素材。");
          usable(old);
          if (
            authRevision !== old.authority_revision ||
            c.revision !== old.consent_revision
          )
            fail(409, "原素材授权版本已失效。");
          replay = true;
          return old;
        }
        const usage = q(
          "SELECT count(*) n,COALESCE(SUM(CASE WHEN status='processing' THEN 2097152 ELSE COALESCE(byte_size,0) END),0) bytes FROM player_ai_sources WHERE team_id=? AND requester_id=? AND status!='deleted'",
        ).get(base.team_id, base.requester_id);
        if (
          usage.n >= maxObjectsPerUploader ||
          !Number.isSafeInteger(usage.bytes) ||
          maxStoredBytes - usage.bytes < 2097152
        )
          fail(429, "私有来源配额不足，请先清理。");
        const objectId = randomUUID();
        q(
          `INSERT INTO player_ai_sources(id,team_id,player_id,requester_id,request_id,payload_hash,consent_id,authority_revision,consent_revision,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,'processing')`,
        ).run(
          objectId,
          base.team_id,
          base.player_id,
          base.requester_id,
          input.requestId,
          payloadHash,
          base.consent_id,
          authRevision,
          c.revision,
          input.expiresAt,
        );
        return row(objectId);
      });
      if (replay) return meta(pending);
      try {
        const clean = await sanitizePlayerPhoto(input.dataUrl);
        return tx(() => {
          const r = row(pending.id),
            authRevision = authority(actor, r),
            c = consent(r);
          if (
            r.status !== "processing" ||
            r.revision !== pending.revision ||
            r.expires_at <= now() ||
            c.expiresAt < r.expires_at ||
            authRevision !== r.authority_revision ||
            c.revision !== r.consent_revision
          )
            fail(409, "素材或授权在处理中已变化。");
          q(
            "UPDATE player_ai_sources SET status='ready',revision=revision+1,data_url=?,mime_type=?,width=?,height=?,byte_size=? WHERE id=?",
          ).run(
            clean.dataUrl,
            clean.mimeType,
            clean.width,
            clean.height,
            clean.byteSize,
            r.id,
          );
          return meta(row(r.id));
        });
      } catch (error) {
        // 不覆盖delete墓碑；无原图内容进入失败记录。崩溃processing需核对后删除重建。
        q(
          "UPDATE player_ai_sources SET status='failed',revision=revision+1,data_url=NULL,payload_hash='' WHERE id=? AND status='processing' AND revision=?",
        ).run(pending.id, pending.revision);
        throw error;
      }
    },
    inspectRequest(actor, { teamId, playerId, requesterId, requestId }) {
      guard();
      if (
        !version(teamId) ||
        !version(requesterId) ||
        !validId(playerId) ||
        !validId(requestId)
      )
        fail(400, "请求范围无效。");
      const r = q(
        "SELECT * FROM player_ai_sources WHERE team_id=? AND requester_id=? AND request_id=?",
      ).get(teamId, requesterId, requestId);
      if (!r || r.player_id !== playerId) fail(404, "素材不存在。");
      authority(actor, r);
      // 核对/清理只给状态和版本，不披露图片、摘要或授权ID。
      return { id: r.id, revision: r.revision, status: r.status };
    },
    read(actor, objectId, revision) {
      guard();
      const r = row(objectId);
      const authRevision = authority(actor, r),
        c = consent(r);
      if (
        authRevision !== r.authority_revision ||
        c.revision !== r.consent_revision
      )
        fail(409, "原素材授权版本已失效。");
      usable(r);
      if (r.revision !== revision) fail(409, "素材版本已变化。");
      return { ...meta(r), dataUrl: r.data_url };
    },
    reference(actor, objectId, revision) {
      guard();
      const r = row(objectId);
      const authRevision = authority(actor, r),
        c = consent(r);
      if (
        authRevision !== r.authority_revision ||
        c.revision !== r.consent_revision
      )
        fail(409, "原素材授权版本已失效。");
      usable(r);
      if (r.revision !== revision) fail(409, "素材版本已变化。");
      return {
        id: r.id,
        revision: r.revision,
        teamId: r.team_id,
        playerId: r.player_id,
        requesterId: r.requester_id,
      };
    },
    remove(actor, objectId, revision) {
      guard();
      return tx(() => {
        const r = row(objectId);
        authority(actor, r);
        if (r.revision !== revision) fail(409, "素材版本已变化。");
        if (r.status === "deleted") return meta(r);
        q(
          "UPDATE player_ai_sources SET status='deleted',revision=revision+1,data_url=NULL,payload_hash='',mime_type=NULL,width=NULL,height=NULL,byte_size=NULL WHERE id=?",
        ).run(r.id);
        return meta(row(r.id));
      });
    },
  };
}
