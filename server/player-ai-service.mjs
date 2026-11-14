import { createHash, randomUUID } from "node:crypto";
import { FootballError } from "./football-store.mjs";
import { createPlayerAiAssets } from "./player-ai-assets.mjs";
import { createPlayerAiJobs } from "./player-ai-jobs.mjs";
import { createPlayerAiResults } from "./player-ai-results.mjs";
import { sanitizePlayerPhoto } from "./player-media-store.mjs";
const fail = (s, m) => {
  throw new FootballError(s, m);
};
const hash = (v) =>
  createHash("sha256")
    .update(typeof v === "string" ? v : JSON.stringify(v))
    .digest("hex");
const fields = (v, allowed) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !allowed.includes(k))
  )
    fail(400, "AI请求字段无效。");
};
const reqId = (v) => {
  if (typeof v !== "string" || !/^[-A-Za-z0-9]{16,100}$/.test(v))
    fail(400, "请求编号无效。");
};
// 仅支持可信构造注入的本地合成演练；真实供应商适配器本批未实现。
export function createPlayerAiService(
  db,
  {
    enabled = false,
    provider = null,
    policy,
    authenticate,
    getPlayer,
    getAlbumRevision,
    applyAdoption,
    authorizeProcessing,
    now = Date.now,
  } = {},
) {
  const simulation =
    provider?.mode === "local-simulation" &&
    policy?.mode === "local-simulation" &&
    policy.currency === "XXX" &&
    policy.amountMinor === 0 &&
    typeof provider.sample === "function";
  const configuredFile =
    provider?.mode === "configured-provider" &&
    provider.uploadMode === "file" &&
    policy?.mode === "configured-provider" &&
    policy.approved === true &&
    typeof authorizeProcessing === "function" &&
    policy.providerId === provider.id &&
    policy.termsVersion === provider.termsVersion &&
    ["processor", "destination", "retention", "training", "cancellation"].every(
      (k) =>
        typeof policy.disclosures?.[k] === "string" &&
        policy.disclosures[k].trim(),
    ) &&
    /^[A-Z]{3}$/.test(policy.currency || "") &&
    Number.isSafeInteger(policy.amountMinor) &&
    policy.amountMinor >= 0 &&
    Number.isSafeInteger(policy.budgetMinor) &&
    policy.budgetMinor >= policy.amountMinor;
  const mode = simulation ? "local-simulation" : "configured-provider";
  const available =
    enabled === true &&
    (simulation || configuredFile) &&
    typeof authenticate === "function" &&
    typeof getPlayer === "function" &&
    typeof getAlbumRevision === "function" &&
    typeof applyAdoption === "function" &&
    typeof provider.submit === "function" &&
    typeof provider.query === "function";
  const guard = () => {
    if (closed) fail(503, "AI服务已停止。");
    if (!available) fail(503, "AI功能未配置，本次不接受上传或生成。");
  };
  const q = (s) => db.prepare(s),
    inFlight = new Map(),
    uploads = new Set();
  let closed = false;
  const actorFor = (actor, playerId) => ({
    ...actor,
    expectedPlayer: playerId,
  });
  const auth = (actor, playerId, requesterId) => {
    const user = authenticate(actor?.token, actor?.transport);
    if (
      user.role !== "admin" ||
      (requesterId !== undefined && user.id !== requesterId)
    )
      fail(403, "仅获准的原上传管理员可操作。");
    const player = getPlayer(user.team_id, playerId);
    if (
      player.status !== "active" ||
      (actor.expectedPlayer !== undefined && actor.expectedPlayer !== playerId)
    )
      fail(403, "球员或素材归属无效。");
    return user;
  };
  const processing = (user, playerId, purpose) => {
    if (simulation) return 1;
    const scope = {
      teamId: user.team_id,
      playerId,
      requesterId: user.id,
      purpose,
      providerId: provider.id,
      termsVersion: policy.termsVersion,
    };
    const a = authorizeProcessing({
      ...scope,
      player: getPlayer(user.team_id, playerId),
    });
    if (
      !a ||
      typeof a.then === "function" ||
      a.active !== true ||
      !Number.isSafeInteger(a.revision) ||
      a.revision < 1 ||
      Object.entries(scope).some(([k, v]) => a[k] !== v)
    )
      fail(403, "尚未取得此球员对应处理用途的有效授权。");
    return a.revision;
  };
  const actorHash = (actor) => hash(actor.token + "\0" + actor.transport);
  const authority = (actor, s) => {
    if (closed) fail(503, "AI服务已停止。");
    const u = auth(actor, s.playerId, s.requesterId);
    if (u.team_id !== s.teamId) fail(403, "素材不属于当前球队。");
    return {
      ...s,
      role: "admin",
      active: true,
      revision: (() => {
        q(
          "INSERT OR IGNORE INTO player_ai_authorities(actor_hash) VALUES(?)",
        ).run(actorHash(actor));
        return q("SELECT id FROM player_ai_authorities WHERE actor_hash=?").get(
          actorHash(actor),
        ).id;
      })(),
    };
  };
  const consentRow = (id) => {
    const r = q("SELECT * FROM player_ai_consents WHERE id=?").get(id);
    if (!r) fail(404, "授权记录不存在。");
    return r;
  };
  const checkConsent = (actor, r) => {
    const u = auth(actor, r.player_id, r.requester_id);
    if (
      u.team_id !== r.team_id ||
      actorHash(actor) !== r.actor_hash ||
      r.revoked ||
      r.policy_version !== policy.version ||
      r.provider_id !== provider.id ||
      r.origin_kind !== (simulation ? "local-simulation" : "ai-generated") ||
      r.expires_at <= now()
    )
      fail(403, "本次授权无效、过期或会话已变化。");
    if (processing(u, r.player_id, r.purpose) !== r.processing_revision)
      fail(403, "处理授权版本已变化。");
    return u;
  };
  const sourceConsent = (id) => {
    const r = consentRow(id);
    if (
      processing(
        { team_id: r.team_id, id: r.requester_id },
        r.player_id,
        r.purpose,
      ) !== r.processing_revision
    )
      fail(403, "处理授权版本已变化。");
    return {
      active: !r.revoked,
      revision: r.revision,
      expiresAt: r.expires_at,
      teamId: r.team_id,
      playerId: r.player_id,
      requesterId: r.requester_id,
      purpose: r.purpose,
    };
  };
  const generationConsent = (id) => {
    const r = consentRow(id);
    return {
      ...sourceConsent(id),
      sourceId: r.source_id,
      styleId: r.style_id,
      providerId: provider.id,
      termsVersion: r.policy_version,
      currency: policy.currency,
      maxAmountMinor: policy.amountMinor,
    };
  };
  let assets, jobs, results;
  const jobRow = (id) => {
    const r = q("SELECT * FROM player_ai_jobs WHERE id=?").get(id);
    if (!r) fail(404, "任务不存在。");
    return r;
  };
  const checkJob = (actor, r, cleanup = false) => {
    const c = consentRow(r.consent_id);
    const u = auth(actor, r.player_id, r.requester_id);
    if (
      u.team_id !== r.team_id ||
      (!cleanup && actorHash(actor) !== c.actor_hash)
    )
      fail(403, "任务不属于当前会话。");
    if (!cleanup) {
      checkConsent(actor, c);
      assets.reference(actor, r.source_id, c.source_revision);
    }
    return u;
  };
  const sourceScope = (actor, playerId, requestId) => {
    const u = auth(actor, playerId);
    return { teamId: u.team_id, playerId, requesterId: u.id, requestId };
  };
  const viewJob = (actor, r) => {
    checkJob(actor, r);
    const v = jobs.get(actor, r.id);
    return {
      ...v,
      mode,
      simulated: simulation,
      candidates: r.status === "succeeded" ? results.list(actor, r.id) : [],
    };
  };
  const imageUrl = (photo) => {
    if (
      !photo ||
      !["image/png", "image/jpeg"].includes(photo.mimeType) ||
      !(photo.bytes instanceof Uint8Array) ||
      photo.bytes.byteLength < 1 ||
      photo.bytes.byteLength > 2097152
    )
      fail(502, "模拟适配器图片格式或大小无效。");
    return (
      "data:" +
      photo.mimeType +
      ";base64," +
      Buffer.from(photo.bytes).toString("base64")
    );
  };
  if (available) {
    if (
      !Number.isSafeInteger(policy.lifetimeMs) ||
      policy.lifetimeMs < 1000 ||
      policy.lifetimeMs > 86400000 ||
      typeof policy.version !== "string" ||
      !/^[-a-zA-Z0-9]{1,80}$/.test(policy.version)
    )
      fail(503, "模拟授权策略无效。");
    db.exec(
      "CREATE TABLE IF NOT EXISTS player_ai_authorities(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_hash TEXT NOT NULL UNIQUE)",
    );
    db.exec(
      `CREATE TABLE IF NOT EXISTS player_ai_consents(id TEXT PRIMARY KEY,team_id INTEGER NOT NULL,player_id TEXT NOT NULL,requester_id INTEGER NOT NULL,actor_hash TEXT NOT NULL,request_id TEXT NOT NULL,payload_hash TEXT NOT NULL,purpose TEXT NOT NULL,style_id TEXT NOT NULL,source_id TEXT,source_revision INTEGER,policy_version TEXT NOT NULL,provider_id TEXT NOT NULL,origin_kind TEXT NOT NULL,processing_revision INTEGER NOT NULL,expires_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1,revoked INTEGER NOT NULL DEFAULT 0,UNIQUE(team_id,requester_id,request_id));`,
    );
    assets = createPlayerAiAssets(db, {
      enabled: true,
      authorize: authority,
      resolveConsent: sourceConsent,
      maxLifetimeMs: policy.lifetimeMs,
      maxObjectsPerUploader: 9,
      maxStoredBytes: 9 * 2097152,
      now,
    });
    assets.initialize();
    jobs = createPlayerAiJobs(db, {
      enabled: true,
      authorize: authority,
      resolveConsent: generationConsent,
      policy: {
        currency: policy.currency,
        budgetMinor: simulation ? 0 : policy.budgetMinor,
        maxJobMinor: policy.amountMinor,
        maxActive: 2,
        maxCandidates: 1,
      },
      now,
    });
    jobs.initialize();
    results = createPlayerAiResults(db, {
      now,
      applyAdoption,
      check: (actor, r, { cleanup = false, target, receipt = false } = {}) => {
        const j = jobRow(r.job_id);
        const u = receipt
          ? auth(actor, j.player_id, j.requester_id)
          : checkJob(actor, j, cleanup);
        if (u.team_id !== j.team_id) fail(403, "任务不属于当前球队。");
        if (
          target &&
          !(
            (j.purpose === "avatar" && target === "avatar") ||
            (j.purpose === "portrait" && target === "cover")
          )
        )
          fail(403, "采用用途与生成授权不一致。");
        if (
          !cleanup &&
          (j.status !== "succeeded" ||
            !JSON.parse(j.candidates).some((c) => c.id === r.id))
        )
          fail(409, "候选任务尚未完成或已取消。");
        return u;
      },
    });
    results.initialize();
  }
  async function consume(actor, id, response) {
    if (closed) return;
    let r = jobRow(id);
    checkJob(actor, r);
    if (["cancelled", "failed", "succeeded"].includes(r.status)) return;
    if (
      !response ||
      !["succeeded", "running", "failed", "unknown"].includes(response.state)
    )
      throw Error("invalid adapter state");
    if (response.state === "unknown") {
      if (r.status === "submitting")
        jobs.transition(actor, id, r.revision, "unknown");
      return;
    }
    if (["submitting", "submission_unknown"].includes(r.status)) {
      if (!response.externalRef) {
        if (r.status === "submitting")
          jobs.transition(actor, id, r.revision, "unknown");
        return;
      }
      jobs.transition(actor, id, r.revision, "submitted", {
        externalRef: response.externalRef,
      });
      r = jobRow(id);
    }
    if (response.state === "running") {
      if (r.status === "submitted")
        jobs.transition(actor, id, r.revision, "running");
      return;
    }
    if (response.state === "failed") {
      jobs.transition(actor, id, r.revision, "fail");
      results.eraseJob(id);
    } else {
      if (!Array.isArray(response.images) || response.images.length !== 1)
        fail(502, "模拟结果数量无效。");
      const photos = [];
      for (const photo of response.images)
        photos.push(await sanitizePlayerPhoto(imageUrl(photo)));
      if (closed) return;
      r = jobRow(id);
      checkJob(actor, r);
      if (!["submitted", "running"].includes(r.status)) return;
      const candidates = results.stage(
        r,
        photos,
        consentRow(r.consent_id).expires_at,
        simulation ? "local-simulation" : "ai-generated",
      );
      try {
        jobs.transition(actor, id, r.revision, "succeed", {
          candidates: candidates.map((c) => ({
            id: c.id,
            objectId: c.id,
            width: c.width,
            height: c.height,
            mimeType: c.mimeType,
          })),
        });
      } catch (e) {
        results.eraseJob(id);
        throw e;
      }
    }
    r = jobRow(id);
    if (
      Number.isSafeInteger(response.charge?.amountMinor) &&
      response.charge.amountMinor >= 0 &&
      response.charge.amountMinor <= r.reserved_minor &&
      typeof response.charge.reference === "string"
    )
      jobs.settle(actor, id, r.revision, {
        amountMinor: response.charge.amountMinor,
        settlementRef: response.charge.reference,
      });
  }
  const controllers = new Set();
  async function bounded(method, payload) {
    const controller = new AbortController();
    controllers.add(controller);
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() =>
          provider[method](payload, { signal: controller.signal }),
        ),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("adapter timeout"));
          }, 5000);
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error("adapter stopped")),
            { once: true },
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  function run(actor, id, queryOnly = false) {
    if (closed || inFlight.has(id) || inFlight.size >= 2) return;
    const promise = (async () => {
      let r = jobRow(id);
      checkJob(actor, r);
      if (r.status === "queued" && !queryOnly) {
        jobs.transition(actor, id, r.revision, "submit");
        r = jobRow(id);
        try {
          await consume(
            actor,
            id,
            await bounded("submit", {
              requestId: id,
              purpose: r.purpose,
              styleId: r.style_id,
              source: assets.read(
                actor,
                r.source_id,
                consentRow(r.consent_id).source_revision,
              ),
            }),
          );
        } catch {
          if (closed) return;
          const current = jobRow(id);
          if (current.status === "submitting") {
            try {
              jobs.transition(actor, id, current.revision, "unknown");
            } catch {}
          }
        }
      } else if (
        ["submitted", "running"].includes(r.status) &&
        r.external_ref
      ) {
        try {
          await consume(actor, id, await bounded("query", r.external_ref));
        } catch {}
      }
      // submitting/unknown sans current promise never resubmits. Recovery requires explicit provider query capability.
    })()
      .catch(() => {})
      .finally(() => inFlight.delete(id));
    inFlight.set(id, promise);
  }
  const consentView = (r) => ({
    id: r.id,
    revision: r.revision,
    purpose: r.purpose,
    styleId: r.style_id,
    expiresAt: r.expires_at,
    mode,
    maxAmountMinor: r.purpose === "private-ai-source" ? 0 : policy.amountMinor,
    policyVersion: r.policy_version,
  });
  return {
    enabled: available,
    capabilities(actor, playerId) {
      const u = auth(actor, playerId);
      return {
        enabled: available,
        mode: available ? mode : "disabled",
        uploadMode: available ? (simulation ? "sample" : "file") : "disabled",
        player: (({ id, name, revision, status }) => ({
          id,
          name,
          revision,
          status,
        }))(getPlayer(u.team_id, playerId)),
        albumRevision: getAlbumRevision(u.team_id, playerId),
        ...(available
          ? {
              samples: simulation ? provider.samples : [],
              styles: provider.styles,
              policyVersion: policy.version,
              currency: policy.currency,
              maxAmountMinor: policy.amountMinor,
              disclosures: simulation ? null : policy.disclosures,
              warning: simulation
                ? "仅本地合成模拟，不是AI人像生成，不接受真实照片。"
                : "仅按本次已确认的处理条件执行。",
            }
          : {}),
      };
    },
    createConsent(actor, playerId, input) {
      guard();
      fields(input, [
        "purpose",
        "styleId",
        "maxAmountMinor",
        "policyVersion",
        "confirmed",
        "requestId",
        "sourceId",
        "sourceRevision",
      ]);
      reqId(input.requestId);
      const u = auth(actor, playerId);
      if (
        input.confirmed !== true ||
        input.policyVersion !== policy.version ||
        input.maxAmountMinor !==
          (input.purpose === "private-ai-source" ? 0 : policy.amountMinor) ||
        !["private-ai-source", "avatar", "portrait"].includes(input.purpose)
      )
        fail(400, "请核对并确认模拟处理条件。");
      if (input.purpose === "private-ai-source") {
        if (
          input.styleId !== "source" ||
          input.sourceId !== undefined ||
          input.sourceRevision !== undefined
        )
          fail(400, "来源授权参数无效。");
      } else {
        if (!provider.styles.some((s) => s.id === input.styleId))
          fail(400, "请选择有效样式。");
        assets.reference(
          actorFor(actor, playerId),
          input.sourceId,
          input.sourceRevision,
        );
      }
      const payload = hash(input),
        old = q(
          "SELECT * FROM player_ai_consents WHERE team_id=? AND requester_id=? AND request_id=?",
        ).get(u.team_id, u.id, input.requestId);
      if (old) {
        checkConsent(actorFor(actor, playerId), old);
        if (old.payload_hash !== payload) fail(409, "授权请求编号已使用。");
        return consentView(old);
      }
      const id = randomUUID();
      q(
        "INSERT INTO player_ai_consents(id,team_id,player_id,requester_id,actor_hash,request_id,payload_hash,purpose,style_id,source_id,source_revision,policy_version,provider_id,origin_kind,processing_revision,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        u.team_id,
        playerId,
        u.id,
        actorHash(actor),
        input.requestId,
        payload,
        input.purpose,
        input.styleId,
        input.sourceId ?? null,
        input.sourceRevision ?? null,
        policy.version,
        provider.id,
        simulation ? "local-simulation" : "ai-generated",
        processing(u, playerId, input.purpose),
        now() + policy.lifetimeMs,
      );
      return consentView(consentRow(id));
    },
    getConsentByRequest(actor, playerId, requestId) {
      guard();
      reqId(requestId);
      const u = auth(actor, playerId),
        r = q(
          "SELECT * FROM player_ai_consents WHERE team_id=? AND requester_id=? AND request_id=? AND player_id=?",
        ).get(u.team_id, u.id, requestId, playerId);
      if (!r) fail(404, "授权记录不存在。");
      checkConsent(actorFor(actor, playerId), r);
      return consentView(r);
    },
    uploadSource(actor, playerId, input) {
      const pending = (async () => {
        guard();
        fields(
          input,
          simulation
            ? ["consentId", "requestId", "sampleId"]
            : ["consentId", "requestId", "dataUrl"],
        );
        reqId(input.requestId);
        const a = actorFor(actor, playerId),
          c = consentRow(input.consentId);
        checkConsent(a, c);
        if (c.purpose !== "private-ai-source") fail(400, "来源授权用途无效。");
        let dataUrl;
        if (simulation) {
          if (!provider.samples.some((s) => s.id === input.sampleId))
            fail(400, "请选择内置合成样本。");
          dataUrl = imageUrl(await bounded("sample", input.sampleId));
        } else dataUrl = input.dataUrl;
        guard();
        checkConsent(a, consentRow(c.id));
        return assets.upload(a, {
          ...sourceScope(a, playerId, input.requestId),
          consentId: c.id,
          expiresAt: c.expires_at,
          dataUrl,
        });
      })();
      uploads.add(pending);
      pending.then(
        () => uploads.delete(pending),
        () => uploads.delete(pending),
      );
      return pending;
    },
    getSourceStatus(actor, playerId, requestId) {
      guard();
      return assets.inspectRequest(
        actorFor(actor, playerId),
        sourceScope(actor, playerId, requestId),
      );
    },
    deleteSource(actor, playerId, { id, revision }) {
      guard();
      const a = actorFor(actor, playerId);
      const removed = assets.remove(a, id, revision);
      const u = auth(a, playerId);
      for (const r of q(
        "SELECT * FROM player_ai_jobs WHERE source_id=? AND team_id=? AND player_id=? AND requester_id=?",
      ).all(id, u.team_id, playerId, u.id)) {
        if (!["succeeded", "failed", "cancelled"].includes(r.status))
          jobs.cancel(a, r.id, r.revision);
        results.eraseJob(r.id);
      }
      return removed;
    },
    createJob(actor, playerId, input) {
      guard();
      fields(input, [
        "consentId",
        "sourceId",
        "sourceRevision",
        "purpose",
        "styleId",
        "requestId",
      ]);
      reqId(input.requestId);
      const a = actorFor(actor, playerId),
        c = consentRow(input.consentId),
        u = checkConsent(a, c);
      if (
        c.source_id !== input.sourceId ||
        c.source_revision !== input.sourceRevision ||
        c.purpose !== input.purpose ||
        c.style_id !== input.styleId ||
        !["avatar", "portrait"].includes(c.purpose)
      )
        fail(400, "生成授权与来源用途不一致。");
      assets.reference(a, c.source_id, c.source_revision);
      const j = jobs.create(a, {
        teamId: u.team_id,
        playerId,
        requesterId: u.id,
        requestId: input.requestId,
        consentId: c.id,
        sourceId: c.source_id,
        purpose: c.purpose,
        styleId: c.style_id,
        providerId: provider.id,
        termsVersion: policy.version,
        amountMinor: policy.amountMinor,
      });
      if (j.status === "queued") {
        try {
          results.reserve(jobRow(j.id));
        } catch (e) {
          jobs.cancel(a, j.id, j.revision);
          throw e;
        }
      }
      run(a, j.id);
      return { ...j, mode, simulated: simulation };
    },
    getJob(actor, playerId, id) {
      guard();
      const a = actorFor(actor, playerId),
        r = jobRow(id);
      let result;
      try {
        result = viewJob(a, r);
      } catch (e) {
        checkJob(a, r, true);
        return {
          id: r.id,
          status: r.status,
          revision: r.revision,
          candidates: [],
          mode,
          restricted: true,
        };
      }
      if (r.status === "queued") run(a, id);
      else run(a, id, true);
      return result;
    },
    getJobByRequest(actor, playerId, requestId) {
      guard();
      reqId(requestId);
      const u = auth(actor, playerId),
        r = q(
          "SELECT * FROM player_ai_jobs WHERE team_id=? AND requester_id=? AND request_id=? AND player_id=?",
        ).get(u.team_id, u.id, requestId, playerId);
      if (!r) fail(404, "任务不存在。");
      return this.getJob(actor, playerId, r.id);
    },
    cancelJob(actor, playerId, id, { revision }) {
      guard();
      const a = actorFor(actor, playerId),
        r = jobRow(id);
      checkJob(a, r, true);
      const j = jobs.cancel(a, id, revision);
      results.eraseJob(id);
      if (r.external_ref && typeof provider.cancel === "function")
        Promise.resolve()
          .then(() => provider.cancel(r.external_ref))
          .catch(() => {});
      return { ...j, mode };
    },
    getCandidate(actor, playerId, id) {
      guard();
      return results.read(actorFor(actor, playerId), id);
    },
    getAdoptionByRequest(actor, playerId, requestId) {
      guard();
      reqId(requestId);
      auth(actor, playerId);
      return results.getAdoption(
        actorFor(actor, playerId),
        playerId,
        requestId,
      );
    },
    adopt(actor, playerId, input) {
      guard();
      fields(input, [
        "candidateId",
        "candidateRevision",
        "target",
        "targetRevision",
        "requestId",
        "confirmed",
      ]);
      return results.adopt(actorFor(actor, playerId), input);
    },
    deleteCandidate(actor, playerId, id, { revision }) {
      guard();
      return results.remove(actorFor(actor, playerId), id, revision);
    },
    revokeConsent(actor, playerId, id, { revision }) {
      guard();
      const c = consentRow(id);
      auth(actorFor(actor, playerId), c.player_id, c.requester_id);
      if (c.revision !== revision) fail(409, "授权记录已变化。");
      q(
        "UPDATE player_ai_consents SET revoked=1,revision=revision+1 WHERE id=?",
      ).run(id);
      const a = actorFor(actor, playerId);
      const related =
        c.purpose === "private-ai-source"
          ? q(
              "SELECT j.* FROM player_ai_jobs j JOIN player_ai_sources s ON s.id=j.source_id WHERE s.consent_id=?",
            ).all(id)
          : q("SELECT * FROM player_ai_jobs WHERE consent_id=?").all(id);
      for (const r of related) {
        if (!["succeeded", "failed", "cancelled"].includes(r.status))
          jobs.cancel(a, r.id, r.revision);
        results.eraseJob(r.id);
      }
      return { id, revoked: true };
    },
    async drain() {
      await Promise.allSettled([...inFlight.values(), ...uploads]);
    },
    close() {
      closed = true;
      for (const c of controllers) c.abort();
    },
  };
}
