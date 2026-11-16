const ui = require("../../utils/ui");
const s = require("../shared");
const cache = require("../../utils/player-photo-cache");
const inFlight = new Map();
const terminal = ["succeeded", "failed", "cancelled"];
const labels = {
  queued: "等待处理",
  submitting: "正在提交",
  submission_unknown: "提交结果待核对",
  submitted: "已提交",
  running: "处理中",
  succeeded: "候选已就绪",
  failed: "处理失败",
  cancelled: "已取消",
};
function requestId() {
  return "ai-" + Date.now() + "-" + Math.random().toString(36).slice(2);
}
function read(key) {
  const r = wx.getStorageSync(key);
  return r && r.version === 1 ? r : { version: 1 };
}
Page({
  data: {
    loading: true,
    error: "",
    admin: false,
    enabled: false,
    mode: "disabled",
    uploadMode: "disabled",
    playerName: "",
    busy: false,
    actionError: "",
    successMessage: "",
    styles: [],
    samples: [],
    purposes: ["头像", "出场封面"],
    purposeIndex: 0,
    styleIndex: 0,
    preparedStyleLabel: "",
    sampleIndex: 0,
    preview: "",
    hasSelectedImage: false,
    sourceReady: false,
    hasSource: false,
    setupLocked: false,
    job: null,
    candidates: [],
    pending: false,
    adopted: "",
    priceLabel: "",
    canResetAdoption: false,
    disclosureText: "",
  },
  onLoad(q) {
    this.id = q.id;
  },
  onHide() {
    ui.abort(this);
    this._hidden = true;
    this._view = (this._view || 0) + 1;
    this.setData({ busy: false, loading: true });
  },
  onUnload() {
    this.onHide();
    this._disposed = true;
    this._imageEpoch = (this._imageEpoch || 0) + 1;
    this._image = null;
    if (this._scope) cache.dispose(this._scope);
    this._scope = null;
  },
  async onShow() {
    this._hidden = false;
    return this.refresh();
  },
  openBusinessPicker(e){return require('../../utils/business-picker-bridge').open(this,e);},
  apiPath(path) {
    return "/players/" + encodeURIComponent(this.id) + "/ai" + path;
  },
  stamp() {
    return {
      token: s.api.getSession()?.token,
      view: this._view,
      owner: this._owner,
    };
  },
  current(t) {
    return (
      !this._hidden &&
      !this._disposed &&
      t.view === this._view &&
      t.token === s.api.getSession()?.token &&
      t.owner === this._owner
    );
  },
  ready() {
    return (
      this.data.admin &&
      this.data.enabled &&
      !this.data.loading &&
      !this.data.businessUiBlocking &&
      !this.data.error &&
      !this.data.busy &&
      !this.data.pending &&
      !this._hidden &&
      !this._disposed &&
      this._owner === s.api.getSession()?.token
    );
  },
  persist(record) {
    wx.setStorageSync(this._key, record);
    this._record = record;
  },
  async refresh() {
    if (this.data.busy) return;
    this._view = (this._view || 0) + 1;
    const view = this._view,
      token = s.api.getSession()?.token;
    this.setData({ loading: true, error: "", successMessage: "", enabled: false, admin: false });
    try {
      const session = await s.api.ensureSession();
      if (
        this._hidden ||
        this._disposed ||
        view !== this._view ||
        token !== s.api.getSession()?.token
      )
        return;
      if (session.user.role !== "admin") throw Error("仅管理员可管理生成照片");
      if (this._owner !== token) {
        if (this._scope) cache.dispose(this._scope);
        this._scope = cache.createScope();
        this._image = null;
        this._imageEpoch = (this._imageEpoch || 0) + 1;
        this.setData({
          preview: "",
          candidates: [],
          job: null,
          sourceReady: false,
          pending: false,
          adopted: "",
        });
      }
      this._owner = token;
      const x = s.api.getSession();
      this._key =
        "football.ai.receipts:" +
        encodeURIComponent(
          x.serverOrigin || require("../../config").apiBaseUrl,
        ) +
        ":" +
        session.user.id +
        ":" +
        session.team.id +
        ":" +
        encodeURIComponent(this.id);
      const cap = await s.api.request(this.apiPath("/capabilities"));
      if (
        this._hidden ||
        this._disposed ||
        view !== this._view ||
        token !== s.api.getSession()?.token
      )
        return;
      this._cap = cap;
      this._record = read(this._key);
      const filePolicy =
        cap.mode === "configured-provider" &&
        [
          "processor",
          "destination",
          "retention",
          "training",
          "cancellation",
        ].every(
          (k) =>
            typeof cap.disclosures?.[k] === "string" &&
            cap.disclosures[k].trim(),
        ) &&
        Number.isSafeInteger(cap.maxAmountMinor) &&
        cap.maxAmountMinor >= 0 &&
        /^[A-Z]{3}$/.test(cap.currency || "") &&
        typeof cap.policyVersion === "string" &&
        !!cap.policyVersion;
      const enabled =
        cap.enabled === true &&
        ((cap.mode === "local-simulation" && cap.uploadMode === "sample") ||
          (cap.uploadMode === "file" && filePolicy));
      this.setData({
        admin: true,
        enabled,
        mode: cap.mode,
        uploadMode: cap.uploadMode,
        playerName: cap.player?.name || "球员照片",
        styles: cap.styles || [],
        preparedStyleLabel: (cap.styles || []).find(x => x.id === this._record.styleId)?.label || "原风格已不可用",
        samples: cap.samples || [],
        purposeIndex: this._record.purpose === "portrait" ? 1 : 0,
        styleIndex: Math.max(
          0,
          (cap.styles || []).findIndex((x) => x.id === this._record.styleId),
        ),
        sampleIndex: Math.max(
          0,
          (cap.samples || []).findIndex((x) => x.id === this._record.sampleId),
        ),
        hasSelectedImage: !!this._image,
        preview: this._record.sourceConsentId ? this.data.preview : "",
        sourceReady:
          !!this._record.source && this._record.source.status !== "failed",
        hasSource: !!this._record.source,
        setupLocked: !!this._record.sourceConsentId,
        pending: !!this._record.pending,
        adopted: this._record.adoption ? "已采用，原有比赛记录不变" : "",
        disclosureText: cap.disclosures
          ? [
              "processor",
              "destination",
              "retention",
              "training",
              "cancellation",
            ]
              .map(
                (k) =>
                  ({
                    processor: "处理方",
                    destination: "目的地",
                    retention: "保留规则",
                    training: "训练用途",
                    cancellation: "取消规则",
                  })[k] +
                  ": " +
                  String(cap.disclosures[k] || "未提供"),
              )
              .join("；")
          : "",
        priceLabel:
          cap.mode === "local-simulation"
            ? "本地模拟，不产生 AI 服务费用"
            : String(cap.maxAmountMinor) +
              " " +
              String(cap.currency) +
              "（最小货币单位上限）",
        loading: false,
      });
      if (enabled && this._record.jobId && !this._record.pending) {
        try {
          await this.loadJob();
        } catch (e) {
          if (view === this._view && !this._hidden)
            this.setData({
              actionError: e.message || "任务读取失败，可核对或删除私有素材",
            });
        }
      } else this.setData({ job: null, candidates: [] });
    } catch (e) {
      if (
        !this._hidden &&
        !this._disposed &&
        view === this._view &&
        token === s.api.getSession()?.token
      ) {
        this.setData({ error: e.message || "读取失败", loading: false });
        if (e.status === 401) s.fail(this, e);
      }
    }
  },
  select(e) {
    if (!this.ready() || this._record.source || this._record.sourceConsentId)
      return;
    const field = e.currentTarget.dataset.field,
      index = Number(e.detail.value);
    if (
      !["purposeIndex", "styleIndex", "sampleIndex"].includes(field) ||
      !Number.isInteger(index) ||
      index < 0
    )
      return;
    const max =
      field === "purposeIndex"
        ? 2
        : this.data[field === "styleIndex" ? "styles" : "samples"].length;
    if (index < max) this.setData({ [field]: index });
  },
  choose() {
    if (!this.ready() || this.data.uploadMode !== "file" || this._record.source)
      return;
    const token = this._owner,
      epoch = (this._imageEpoch = (this._imageEpoch || 0) + 1);
    const valid = () =>
      !this._disposed &&
      token === s.api.getSession()?.token &&
      epoch === this._imageEpoch;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album"],
      success: (r) => {
        if (!valid()) return;
        const file = r.tempFiles?.[0];
        if (!file) return;
        if (file.size > 2097152) {
          this.setData({ actionError: "请选择 2 MB 内的 PNG 或 JPG" });
          return;
        }
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: "base64",
          success: (r) => {
            if (!valid()) return;
            const mime = r.data.startsWith("iVBORw0KGgo")
              ? "png"
              : r.data.startsWith("/9j/")
                ? "jpeg"
                : null;
            if (!mime || r.data.length > 2796204) {
              this.setData({ actionError: "请选择 2 MB 内的 PNG 或 JPG" });
              return;
            }
            this._image = "data:image/" + mime + ";base64," + r.data;
            this.setData({ preview: file.tempFilePath, hasSelectedImage: true, actionError: "", successMessage: "" });
          },
          fail: () => {
            if (valid())
              this.setData({ actionError: "无法读取照片，请重新选择" });
          },
        });
      },
      fail: (e) => {
        if (valid() && !String(e.errMsg).includes("cancel"))
          this.setData({ actionError: "无法选择照片" });
      },
    });
  },
  clearPrivate() {
    this._picturesEpoch = (this._picturesEpoch || 0) + 1;
    if (this._scope) cache.dispose(this._scope);
    this._scope = this._disposed ? null : cache.createScope();
    this._image = null;
    this._imageEpoch = (this._imageEpoch || 0) + 1;
  },
  accept(kind, result, record) {
    if (kind === "sourceConsent") record.sourceConsentId = result.id;
    if (kind === "source") {
      record.source = {
        id: result.id,
        revision: result.revision,
        status: result.status || "ready",
      };
      record.sourceRequestId = record.pending?.requestId;
    }
    if (
      kind === "sourceDelete" ||
      (kind === "source" && result.status === "deleted")
    ) {
      this.clearPrivate();
      return { version: 1 };
    }
    if (kind === "jobConsent") record.jobConsentId = result.id;
    if (kind === "job") record.jobId = result.id;
    if (kind === "adoption")
      record.adoption = {
        id: result.id || result.requestId,
        target: record.pending?.payload.target,
      };
    delete record.pending;
    return record;
  },
  async write(kind, path, payload, existingId, method = "POST") {
    const token = this._owner,
      key = this._key,
      id = existingId || requestId();
    if (inFlight.has(key)) throw Error("上次操作仍在处理中，请稍后核对");
    const safe = { ...payload };
    delete safe.dataUrl;
    const record = {
      ...this._record,
      pending: { kind, requestId: id, payload: safe },
    };
    this.persist(record);
    this.setData({ pending: true });
    inFlight.set(key, id);
    try {
      const result = await s.api.request(
        this.apiPath(path),
        method,
        method === "DELETE" ? payload : { ...payload, requestId: id },
      );
      if (
        token === s.api.getSession()?.token &&
        read(key).pending?.requestId === id
      ) {
        const next = this.accept(kind, result, record);
        wx.setStorageSync(key, next);
        this._record = next;
      }
      return result;
    } catch (e) {
      if (
        token === s.api.getSession()?.token &&
        e.status === 409 &&
        read(key).pending?.requestId === id
      ) {
        record.pending.conflict = true;
        wx.setStorageSync(key, record);
        this._record = record;
      }
      if (
        token === s.api.getSession()?.token &&
        e.status >= 400 &&
        e.status < 500 &&
        e.status !== 409 &&
        read(key).pending?.requestId === id
      ) {
        delete record.pending;
        wx.setStorageSync(key, record);
        this._record = record;
      }
      throw e;
    } finally {
      if (inFlight.get(key) === id) inFlight.delete(key);
    }
  },
  async perform(work) {
    if (!this.ready()) return;
    const t = this.stamp();
    this.setData({ busy: true, actionError: "", successMessage: "" });
    try {
      await s.api.ensureSession();
      if (!this.current(t)) return;
      await work(t);
    } catch (e) {
      if (this.current(t))
        this.setData({
          actionError:
            (this._record.pending ? "结果待核对，请勿重复操作。" : "") +
            (e.message || "操作失败"),
        });
    } finally {
      if (this.current(t))
        this.setData({
          busy: false,
          hasSelectedImage: !!this._image,
          pending: !!this._record.pending,
          sourceReady:
            !!this._record.source && this._record.source.status !== "failed",
          hasSource: !!this._record.source,
          setupLocked: !!this._record.sourceConsentId,
        });
    }
  },
  prepare() {
    if (!this.ready() || this._record.source) return;
    if (this.data.uploadMode === "file" && !this._image) {
      this.setData({ actionError: "请先选择已获授权的照片" });
      return;
    }
    const purpose = this.data.purposeIndex ? "portrait" : "avatar",
      style = this.data.styles[this.data.styleIndex],
      sample = this.data.samples[this.data.sampleIndex];
    if (!style || (this.data.uploadMode === "sample" && !sample)) return;
    const t = this.stamp();
    ui.showModal(this, {
      title: "准备私有素材",
      content:
        this.data.mode === "local-simulation"
          ? "仅使用内置几何样本，本地模拟，不是真实 AI 生成。不会发送个人照片或产生费用。"
          : "仅处理已获本人及必要监护授权的照片。原图不会公开。" +
            this.data.disclosureText,
      confirmText: "确认准备",
      success: (r) => {
        if (!r.confirm || !this.current(t) || this._record.source) return;
        return this.perform(async (active) => {
          this._imageEpoch = (this._imageEpoch || 0) + 1;
          this.persist({
            ...this._record,
            purpose,
            styleId: style.id,
            sampleId: sample?.id || null,
          });
          if (!this._record.sourceConsentId)
            await this.write("sourceConsent", "/consents", {
              purpose: "private-ai-source",
              styleId: "source",
              policyVersion: this._cap.policyVersion,
              maxAmountMinor: 0,
              confirmed: true,
            });
          if (!this.current(active)) return;
          await this.write("source", "/sources", {
            consentId: this._record.sourceConsentId,
            ...(this.data.uploadMode === "sample"
              ? { sampleId: sample.id }
              : { dataUrl: this._image }),
          });
          if (this.current(active)) {
            this._image = null;
            this.setData({ preview: "", hasSelectedImage: false, sourceReady: true, preparedStyleLabel: style.label });
          }
        });
      },
    });
  },
  generate() {
    if (
      !this.ready() ||
      !this._record.source ||
      this._record.source.status === "failed" ||
      this._record.jobId
    )
      return;
    const t = this.stamp();
    ui.showModal(this, {
      title:
        this.data.mode === "local-simulation" ? "生成本地模拟候选" : "生成候选",
      content:
        this.data.mode === "local-simulation"
          ? "结果是本地模拟图，非真实 AI 生成。生成后仍需单独确认采用。"
          : this.data.disclosureText +
            "；费用上限：" +
            this.data.priceLabel +
            "。生成不会自动替换头像或封面。",
      confirmText: "确认生成",
      success: (r) => {
        if (!r.confirm || !this.current(t) || this._record.jobId) return;
        return this.perform(async (active) => {
          const record = this._record,
            source = record.source;
          if (!record.jobConsentId)
            await this.write("jobConsent", "/consents", {
              purpose: record.purpose,
              styleId: record.styleId,
              sourceId: source.id,
              sourceRevision: source.revision,
              policyVersion: this._cap.policyVersion,
              maxAmountMinor: this._cap.maxAmountMinor,
              confirmed: true,
            });
          if (!this.current(active)) return;
          await this.write("job", "/jobs", {
            consentId: this._record.jobConsentId,
            sourceId: source.id,
            sourceRevision: source.revision,
            purpose: record.purpose,
            styleId: record.styleId,
          });
          if (this.current(active)) await this.loadJob();
        });
      },
    });
  },
  async loadJob() {
    if (!this._record?.jobId) return;
    const t = this.stamp(),
      serial = (this._picturesEpoch = (this._picturesEpoch || 0) + 1),
      scope = this._scope,
      jobId = this._record.jobId,
      sourceId = this._record.source?.id;
    const current = () =>
      this.current(t) &&
      serial === this._picturesEpoch &&
      scope === this._scope &&
      jobId === this._record.jobId &&
      sourceId === this._record.source?.id;
    const job = await s.api.request(
      this.apiPath("/jobs/" + encodeURIComponent(this._record.jobId)),
    );
    if (!current()) return;
    this.setData({
      actionError: job.restricted
        ? "登录授权已变化，旧候选不可读取或采用；可取消任务或清理私有素材后重新准备。"
        : "",
      job: {
        id: job.id,
        revision: job.revision,
        status: job.status,
        label: labels[job.status] || "状态待核对",
        canCancel: !terminal.includes(job.status),
      },
      candidates: [],
    });
    for (const candidate of (job.candidates || []).slice(0, 3)) {
      if (!current()) return;
      try {
        const image = await s.api.request(
          this.apiPath("/candidates/" + encodeURIComponent(candidate.id)),
        );
        if (!current()) return;
        const imageKey = "candidate:" + candidate.id + ":" + image.revision;
        const src = cache.put(scope, imageKey, image.dataUrl);
        if (!current()) {
          cache.remove(scope, imageKey);
          return;
        }
        this.setData({
          candidates: [
            ...this.data.candidates,
            {
              id: candidate.id,
              revision: image.revision,
              src,
              imageEpoch: serial,
              label:
                image.simulation || image.originKind === "local-simulation"
                  ? "本地模拟图，非真实 AI 生成"
                  : "AI 生成图",
              target: this._record.purpose === "avatar" ? "avatar" : "cover",
            },
          ],
        });
      } catch (e) {
        if (current())
          this.setData({ actionError: e.message || "候选读取失败" });
      }
    }
  },
  async poll() {
    if (!this.ready()) return;
    return this.perform(() => this.loadJob());
  },
  async recover() {
    if (
      this.data.busy ||
      this._hidden ||
      !this.data.admin ||
      !this._record.pending
    )
      return;
    const t = this.stamp(),
      pending = this._record.pending;
    if (inFlight.has(this._key)) {
      this.setData({ actionError: "操作仍在处理中，请稍后核对" });
      return;
    }
    this.setData({ busy: true, actionError: "", successMessage: "" });
    try {
      const part = {
        sourceConsent: "consents",
        jobConsent: "consents",
        source: "sources",
        sourceDelete: "sources",
        job: "jobs",
        adoption: "adoptions",
      }[pending.kind];
      const result = await s.api.request(
        this.apiPath(
          "/" +
            part +
            "?requestId=" +
            encodeURIComponent(
              pending.kind === "sourceDelete"
                ? this._record.sourceRequestId
                : pending.requestId,
            ),
        ),
      );
      if (!this.current(t)) return;
      if (!(result?.id || (pending.kind === "adoption" && result?.requestId)))
        throw Error("未能确认结果，核对记录已保留");
      if (pending.kind === "sourceDelete" && result.status !== "deleted")
        throw Error("素材尚未删除，可明确重试原删除操作");
      if (
        pending.kind === "source" &&
        !["ready", "failed", "deleted"].includes(result.status)
      )
        throw Error(
          "素材状态为 " + result.status + "，请稍后核对；不会重复上传",
        );
      this.persist(this.accept(pending.kind, result, { ...this._record }));
      this.setData({
        pending: false,
        hasSelectedImage: !!this._image,
        preview: "",
        actionError:
          result.status === "failed"
            ? "素材处理失败，请删除私有素材后重新准备"
            : "",
        sourceReady:
          !!this._record.source && this._record.source.status !== "failed",
        hasSource: !!this._record.source,
        adopted: this._record.adoption ? "已采用" : "",
      });
      if (this._record.jobId) await this.loadJob();
      else this.setData({ job: null, candidates: [] });
    } catch (e) {
      if (this.current(t))
        this.setData({
          canResetAdoption:
            e.status === 404 &&
            pending.kind === "adoption" &&
            pending.conflict === true,
          actionError:
            e.status === 404
              ? "服务端未找到该请求。可明确重试同一请求编号，不会自动新建。"
              : e.message || "核对失败，未重新提交",
        });
    } finally {
      if (this.current(t)) this.setData({ busy: false });
    }
  },
  resetAdoption() {
    if (
      !this.data.canResetAdoption ||
      this.data.busy ||
      this._hidden ||
      this._record.pending?.kind !== "adoption" ||
      !this._record.pending.conflict
    )
      return;
    const t = this.stamp(),
      id = this._record.pending.requestId;
    ui.showModal(this, {
      title: "重新核对采用目标",
      content:
        "上次采用因版本冲突未执行，且已核对没有采用收据。重新载入目标后仍需再次确认，不会自动替换。",
      confirmText: "重新核对",
      success: async (r) => {
        if (
          !r.confirm ||
          !this.current(t) ||
          this._record.pending?.requestId !== id ||
          inFlight.has(this._key)
        )
          return;
        const next = { ...this._record };
        delete next.pending;
        this.persist(next);
        this.setData({ pending: false, canResetAdoption: false });
        await this.refresh();
      },
    });
  },
  retryPending() {
    const pending = this._record?.pending;
    if (
      !pending ||
      this.data.busy ||
      this._hidden ||
      this._disposed ||
      !this.data.enabled ||
      inFlight.has(this._key)
    )
      return;
    if (
      pending.kind === "source" &&
      this.data.uploadMode === "file" &&
      !this._image
    ) {
      this.setData({
        actionError:
          "原图已离开内存，请先核对服务端素材。不能换一张图重试旧请求。",
      });
      return;
    }
    const t = this.stamp();
    ui.showModal(this, {
      title: "重试原请求",
      content: "仅重试相同请求编号与内容，不创建新的生成任务。请先核对结果。",
      confirmText: "重试原请求",
      success: async (r) => {
        if (!r.confirm || !this.current(t) || this.data.busy) return;
        this.setData({ busy: true, actionError: "", successMessage: "" });
        try {
          await s.api.ensureSession();
          if (!this.current(t)) return;
          const path =
            pending.kind === "sourceDelete"
              ? "/sources/" + encodeURIComponent(this._record.source.id)
              : {
                  sourceConsent: "/consents",
                  jobConsent: "/consents",
                  source: "/sources",
                  job: "/jobs",
                  adoption: "/adoptions",
                }[pending.kind];
          await this.write(
            pending.kind,
            path,
            {
              ...pending.payload,
              ...(pending.kind === "source" && this.data.uploadMode === "file"
                ? { dataUrl: this._image }
                : {}),
            },
            pending.requestId,
            pending.kind === "sourceDelete" ? "DELETE" : "POST",
          );
        } catch (e) {
          if (this.current(t))
            this.setData({ actionError: e.message || "重试结果未确认" });
        } finally {
          if (this.current(t)) {
            this.setData({ busy: false });
            await this.refresh();
          }
        }
      },
    });
  },
  removeSource() {
    if (!this.ready() || !this._record.source) return;
    const t = this.stamp(),
      source = this._record.source;
    ui.showModal(this, {
      title: "删除私有素材",
      content:
        "未采用候选将失效；已明确采用的头像和相册照片不会自动删除。删除后可开始新的任务。",
      confirmText: "删除素材",
      danger: true,
      success: (r) => {
        if (!r.confirm || !this.current(t)) return;
        return this.perform(async (active) => {
          await this.write(
            "sourceDelete",
            "/sources/" + encodeURIComponent(source.id),
            { revision: source.revision },
            undefined,
            "DELETE",
          );
          if (!this.current(active)) return;
          this.persist({ version: 1 });
          this.setData({
            sourceReady: false,
            hasSource: false,
            setupLocked: false,
            job: null,
            candidates: [],
            adopted: "",
            preview: "",
            actionError: "",
            successMessage: "私有素材已删除，已采用资料保持不变",
          });
        });
      },
    });
  },
  adopt(e) {
    const candidate = this.data.candidates.find(
      (x) => x.id === e.currentTarget.dataset.id,
    );
    if (!this.ready() || !candidate || candidate.imageError || this._record.adoption) return;
    const t = this.stamp(),
      target = candidate.target,
      targetRevision =
        target === "avatar"
          ? this._cap.player.revision
          : this._cap.albumRevision;
    const candidateCurrent = () => this.data.candidates.some(x =>
      x.id === candidate.id && x.revision === candidate.revision && x.src === candidate.src &&
      x.imageEpoch === candidate.imageEpoch && !x.imageError);
    ui.showModal(this, {
      title: target === "avatar" ? "采用为头像" : "采用为出场封面",
      content:
        candidate.label +
        "。" +
        (target === "avatar"
          ? "仅替换当前头像，不改出场封面或历史比赛。"
          : "新增一张至照片集并替换出场封面；旧照片保留，头像不变。"),
      confirmText: "确认采用",
      success: (r) => {
        if (!r.confirm || !this.current(t) || this._record.adoption || !candidateCurrent()) return;
        return this.perform(async (active) => {
          if (!this.current(active) || !candidateCurrent()) return;
          await this.write("adoption", "/adoptions", {
            candidateId: candidate.id,
            candidateRevision: candidate.revision,
            target,
            targetRevision,
            confirmed: true,
          });
          if (this.current(active))
            this.setData({ adopted: "已采用，原有比赛记录不变" });
        });
      },
    });
  },
  cancel() {
    if (!this.ready() || !this.data.job?.canCancel) return;
    const t = this.stamp(),
      job = this.data.job;
    ui.showModal(this, {
      title: "取消处理",
      content: "取消后不再采用候选。若真实服务已受理，取消不代表免除费用。",
      confirmText: "确认取消",
      success: (r) => {
        if (!r.confirm || !this.current(t)) return;
        return this.perform(async (active) => {
          this._picturesEpoch = (this._picturesEpoch || 0) + 1;
          await s.api.request(
            this.apiPath("/jobs/" + encodeURIComponent(job.id) + "/cancel"),
            "POST",
            { revision: job.revision },
          );
          if (this.current(active)) await this.loadJob();
        });
      },
    });
  },
  candidateError(e) {
    if (this._disposed || this._hidden || this.data.loading || this.data.error ||
        this._owner !== s.api.getSession()?.token) return;
    const { id, revision, src, epoch } = e.currentTarget.dataset;
    if (epoch !== this._picturesEpoch) return;
    const candidate = this.data.candidates.find(x => x.id === id && x.revision === revision &&
      x.src === src && x.imageEpoch === epoch);
    if (!candidate || candidate.imageError) return;
    this.setData({ candidates: this.data.candidates.map(x => x === candidate
      ? { ...x, imageError: true } : x) });
  },
  preview(e) {
    const c = this.data.candidates.find(
      (x) => x.id === e.currentTarget.dataset.id,
    );
    if (c?.src && !c.imageError && this.ready())
      wx.previewImage({ current: c.src, urls: [c.src] });
  },
});
