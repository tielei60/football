import { randomUUID, createHash } from "node:crypto";
import { FootballError } from "./football-store.mjs";
const fail = (s, m) => {
  throw new FootballError(s, m);
};
const digest = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sync = (fn, ...args) => {
  const r = fn(...args);
  if (r?.then) fail(500, "采用事务依赖必须同步。");
  return r;
};
// 仅供可信service使用；stage接收已完成安全解码的图片，不开放HTTP。
export function createPlayerAiResults(
  db,
  { check, applyAdoption, now = Date.now },
) {
  const q = (s) => db.prepare(s),
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
  const row = (id) => {
    const r = q("SELECT * FROM player_ai_candidates WHERE id=?").get(id);
    if (!r) fail(404, "候选不存在。");
    return r;
  };
  const meta = (r) => ({
    id: r.id,
    revision: r.revision,
    width: r.width,
    height: r.height,
    mimeType: r.mime_type,
    originKind: r.origin_kind,
    generated: true,
    simulation: r.origin_kind === "local-simulation",
    aiGenerated: r.origin_kind === "ai-generated",
    mode:
      r.origin_kind === "local-simulation"
        ? "local-simulation"
        : "configured-provider",
    expiresAt: r.expires_at,
  });
  const valid = (actor, r) => {
    sync(check, actor, r);
    if (r.deleted || r.expires_at <= now()) fail(409, "候选已删除或过期。");
  };
  return {
    initialize() {
      db.exec(`CREATE TABLE IF NOT EXISTS player_ai_result_reservations(job_id TEXT PRIMARY KEY,team_id INTEGER NOT NULL,requester_id INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS player_ai_candidates(id TEXT PRIMARY KEY,job_id TEXT NOT NULL,team_id INTEGER NOT NULL,player_id TEXT NOT NULL,requester_id INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,expires_at INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,data_url TEXT,mime_type TEXT,width INTEGER,height INTEGER,byte_size INTEGER,origin_kind TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS player_ai_adoptions(request_id TEXT NOT NULL,team_id INTEGER NOT NULL,requester_id INTEGER NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(team_id,requester_id,request_id));`);
    },
    reserve(job) {
      return tx(() => {
        if (
          q("SELECT 1 FROM player_ai_result_reservations WHERE job_id=?").get(
            job.id,
          )
        )
          return;
        const pending = q(
          "SELECT count(*) n FROM player_ai_result_reservations WHERE team_id=? AND requester_id=?",
        ).get(job.team_id, job.requester_id).n;
        const stored = q(
          "SELECT count(*) n,COALESCE(SUM(byte_size),0) bytes FROM player_ai_candidates WHERE team_id=? AND requester_id=? AND deleted=0",
        ).get(job.team_id, job.requester_id);
        if (
          pending + stored.n >= 9 ||
          pending * 2097152 + stored.bytes + 2097152 > 9 * 2097152
        )
          fail(429, "请先清理私有候选，生成配额已满。");
        q("INSERT INTO player_ai_result_reservations VALUES(?,?,?)").run(
          job.id,
          job.team_id,
          job.requester_id,
        );
      });
    },
    stage(job, photos, expiresAt, originKind) {
      return tx(() => {
        if (
          !q("SELECT 1 FROM player_ai_result_reservations WHERE job_id=?").get(
            job.id,
          )
        )
          fail(409, "候选预留已失效。");
        if (
          photos.length !== 1 ||
          !["local-simulation", "ai-generated"].includes(originKind)
        )
          fail(400, "候选数量或来源无效。");
        const output = photos.map((photo) => {
          const id = randomUUID();
          q(
            "INSERT INTO player_ai_candidates(id,job_id,team_id,player_id,requester_id,expires_at,data_url,mime_type,width,height,byte_size,origin_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            id,
            job.id,
            job.team_id,
            job.player_id,
            job.requester_id,
            expiresAt,
            photo.dataUrl,
            photo.mimeType,
            photo.width,
            photo.height,
            photo.byteSize,
            originKind,
          );
          return meta(row(id));
        });
        q("DELETE FROM player_ai_result_reservations WHERE job_id=?").run(
          job.id,
        );
        return output;
      });
    },
    read(actor, id) {
      const r = row(id);
      valid(actor, r);
      return { ...meta(r), dataUrl: r.data_url };
    },
    list(actor, jobId) {
      return q(
        "SELECT * FROM player_ai_candidates WHERE job_id=? AND deleted=0 ORDER BY id",
      )
        .all(jobId)
        .map((r) => {
          valid(actor, r);
          return meta(r);
        });
    },
    eraseJob(jobId) {
      q("DELETE FROM player_ai_result_reservations WHERE job_id=?").run(jobId);
      q(
        "UPDATE player_ai_candidates SET deleted=1,revision=revision+1,data_url=NULL WHERE job_id=? AND deleted=0",
      ).run(jobId);
    },
    remove(actor, id, revision) {
      return tx(() => {
        const r = row(id);
        sync(check, actor, r, { cleanup: true });
        if (r.revision !== revision) fail(409, "候选版本已变化。");
        if (!r.deleted)
          q(
            "UPDATE player_ai_candidates SET deleted=1,revision=revision+1,data_url=NULL WHERE id=?",
          ).run(id);
        return { id, deleted: true, revision: row(id).revision };
      });
    },
    getAdoption(actor, playerId, requestId) {
      const rows = q(
        "SELECT * FROM player_ai_adoptions WHERE request_id=?",
      ).all(requestId);
      for (const receipt of rows) {
        const stored = JSON.parse(receipt.result);
        const candidate = q(
          "SELECT * FROM player_ai_candidates WHERE id=?",
        ).get(stored.candidateId);
        if (!candidate || candidate.player_id !== playerId) continue;
        try {
          sync(check, actor, candidate, { cleanup: true, receipt: true });
          return stored;
        } catch {}
      }
      fail(404, "采用回执不存在。");
    },
    adopt(actor, input) {
      if (
        !input ||
        input.confirmed !== true ||
        !["avatar", "cover"].includes(input.target) ||
        typeof input.requestId !== "string" ||
        !/^[-a-zA-Z0-9]{16,100}$/.test(input.requestId)
      )
        fail(400, "请明确确认采用用途与请求编号。");
      return tx(() => {
        const r = row(input.candidateId);
        valid(actor, r);
        if (r.revision !== input.candidateRevision)
          fail(409, "候选版本已变化。");
        const hash = digest([
          r.id,
          input.candidateRevision,
          input.target,
          input.targetRevision,
        ]);
        const previous = q(
          "SELECT * FROM player_ai_adoptions WHERE team_id=? AND requester_id=? AND request_id=?",
        ).get(r.team_id, r.requester_id, input.requestId);
        if (previous) {
          if (previous.payload_hash !== hash)
            fail(409, "采用编号已用于其他操作。");
          return JSON.parse(previous.result);
        }
        const user = sync(check, actor, r, { target: input.target });
        const applied = sync(applyAdoption, {
          db,
          user,
          playerId: r.player_id,
          target: input.target,
          targetRevision: input.targetRevision,
          requestId: input.requestId,
          photo: {
            dataUrl: r.data_url,
            mimeType: r.mime_type,
            width: r.width,
            height: r.height,
            byteSize: r.byte_size,
          },
          provenance: {
            originKind: r.origin_kind,
            generated: true,
            simulation: r.origin_kind === "local-simulation",
            aiGenerated: r.origin_kind === "ai-generated",
            mode:
              r.origin_kind === "local-simulation"
                ? "local-simulation"
                : "configured-provider",
            jobId: r.job_id,
            candidateId: r.id,
          },
        });
        const result = {
          ...applied,
          candidateId: r.id,
          requestId: input.requestId,
        };
        q("INSERT INTO player_ai_adoptions VALUES(?,?,?,?,?)").run(
          input.requestId,
          r.team_id,
          r.requester_id,
          hash,
          JSON.stringify(result),
        );
        return result;
      });
    },
  };
}
