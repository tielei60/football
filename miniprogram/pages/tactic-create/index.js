const s = require("../shared");
const ui = require("../../utils/ui");
const model = require("../../utils/tactic-create");
const flights = new Map();
function key(session) {
  const origin = session?.serverOrigin || require("../../config").apiBaseUrl;
  if (!origin || !session?.user?.id || !session?.team?.id)
    throw Error("请重新登录后创建战术");
  return (
    "football.tactic-create.v1:" +
    encodeURIComponent(origin) +
    ":" +
    session.user.id +
    ":" +
    session.team.id
  );
}
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}
Page({
  openBusinessPicker(e){return require('../../utils/business-picker-bridge').open(this,e);},
  data: {
    loading: true,
    error: "",
    admin: false,
    busy: false,
    actionError: "",
    title: "",
    counts: model.COUNTS,
    countIndex: 2,
    formations: ["空白战术"],
    formationIndex: 0,
    pending: false,
    createdId: null,
    unavailable: false,
    canRetry: false,
    pendingSummary: "",
  },
  onShow() {
    this._hidden = false;
    this._disposed = false;
    return this.refresh();
  },
  onHide() {
    ui.abort(this);
    this._hidden = true;
    this._turn = (this._turn || 0) + 1;
    this.setData({ busy: false, loading: true });
  },
  onUnload() {
    this.onHide();
    this._disposed = true;
    this._payload = null;
  },
  active(owner, turn) {
    return (
      !this._hidden &&
      !this._disposed &&
      this._turn === turn &&
      s.api.getSession()?.token === owner
    );
  },
  ready() {
    return (
      this.active(this._owner, this._turn) &&
      this.data.admin &&
      !this.data.loading &&
      !this.data.error &&
      !this.data.busy &&
      !this.data.businessUiBlocking
    );
  },
  async refresh() {
    const turn = (this._turn = (this._turn || 0) + 1),
      owner = s.api.getSession()?.token;
    this.setData({ loading: true, error: "", admin: false, busy: false });
    try {
      const account = await s.api.ensureSession();
      if (!this.active(owner, turn)) return;
      if (account.user.role !== "admin") throw Error("仅管理员可以新建战术");
      if (this._owner && this._owner !== owner) {
        this._payload = null;
        this.setData({
          title: "",
          countIndex: 2,
          formationIndex: 0,
          actionError: "",
        });
      }
      this._owner = owner;
      this._key = key(s.api.getSession());
      const result = await s.api.request("/tactic-formations");
      if (!this.active(owner, turn)) return;
      this._catalog = result.formations || [];
      const receipt = wx.getStorageSync(this._key);
      if (
        receipt &&
        (typeof receipt.requestId !== "string" ||
          !/^[a-f0-9-]{36}$/.test(receipt.requestId))
      )
        throw Error("创建核对记录异常，请勿重复创建");
      this._receipt = receipt || null;
      this._payload = null;
      if (receipt?.payload) {
        if (
          !Number.isFinite(receipt.createdAt) ||
          Date.now() - receipt.createdAt > 7 * 86400000 ||
          receipt.createdAt > Date.now() ||
          JSON.stringify(receipt).length > 32768
        ) {
          wx.setStorageSync(this._key, { requestId: receipt.requestId });
        } else {
          this._payload = model.validatePayload(receipt.payload);
          if (this._payload.requestId !== receipt.requestId)
            throw Error("创建草稿编号不一致");
        }
      }
      this.setData({
        admin: true,
        pending: !!receipt,
        createdId: null,
        unavailable: false,
        canRetry: false,
        pendingSummary: this._payload ? `${this._payload.tactic.title} · ${this._payload.tactic.board.playerCount} 人制 · ${this._payload.tactic.formationName || "空白战术"}` : "",
      });
      if (this._payload)
        this.setData({
          title: this._payload.tactic.title,
          countIndex: model.COUNTS.indexOf(
            this._payload.tactic.board.playerCount,
          ),
        });
      this.options();
      if (this._payload)
        this.setData({
          formationIndex: Math.max(
            0,
            this._choices.findIndex(
              (f) => f?.id === this._payload.tactic.board.formationId,
            ),
          ),
        });
    } catch (e) {
      if (this.active(owner, turn))
        this.setData({ error: e.message || "无法加载创建表单" });
    } finally {
      if (this.active(owner, turn)) this.setData({ loading: false });
    }
  },
  options() {
    const selected = this._choices?.[this.data.formationIndex]?.id;
    this._choices = [
      null,
      ...(this._catalog || []).filter(
        (f) => f.playerCount === this.data.counts[this.data.countIndex],
      ),
    ];
    this.setData({
      formations: this._choices.map((f) =>
        f ? f.name + (f.category ? " · " + f.category : "") : "空白战术",
      ),
      formationIndex: Math.max(
        0,
        this._choices.findIndex((f) => f?.id === selected),
      ),
    });
  },
  input(e) {
    if (this.ready() && !this.data.pending)
      this.setData({ title: e.detail.value });
  },
  count(e) {
    if (!this.ready() || this.data.pending) return;
    const i = Number(e.detail.value);
    if (!Number.isInteger(i) || !model.COUNTS[i]) return;
    this.setData({ countIndex: i, formationIndex: 0 });
    this._choices = [];
    this.options();
  },
  formation(e) {
    if (!this.ready() || this.data.pending) return;
    const i = Number(e.detail.value);
    if (Number.isInteger(i) && i >= 0 && i < this._choices.length)
      this.setData({ formationIndex: i });
  },
  async create() {
    if (!this.ready() || this.data.pending || flights.has(this._key)) return;
    const owner = this._owner,
      turn = this._turn;
    try {
      const requestId = uuid();
      const payload = {
        requestId,
        tactic: model.build(
          this.data.title,
          this.data.counts[this.data.countIndex],
          this._choices[this.data.formationIndex],
          "native-" + requestId,
        ),
        note: "",
      };
      wx.setStorageSync(this._key, {
        requestId,
        payload,
        createdAt: Date.now(),
      });
      if (wx.getStorageSync(this._key)?.requestId !== requestId)
        throw Error("无法保存核对记录，尚未创建");
      this._receipt = { requestId };
      this._payload = payload;
      this.setData({ pending: true, canRetry: false, pendingSummary: `${payload.tactic.title} · ${payload.tactic.board.playerCount} 人制 · ${payload.tactic.formationName || "空白战术"}` });
      await this.submit(payload, owner, turn);
    } catch (e) {
      if (this.active(owner, turn)) this.setData({ actionError: e.message });
    }
  },
  async submit(payload, owner, turn) {
    const storageKey = this._key;
    if (flights.has(storageKey)) return;
    const attempt = {};
    flights.set(storageKey, attempt);
    this.setData({ busy: true, actionError: "" });
    try {
      const result = await s.api.request("/tactics", "POST", payload);
      if (!Number.isSafeInteger(result.tacticId) || result.tacticId < 1)
        throw Error("创建结果需要核对");
      if (this.active(owner, turn)) {
        this.setData({ createdId: result.tacticId });
        this.enterCreated();
      }
    } catch (e) {
      if (!this.active(owner, turn)) return;
      const status = e.status || e.statusCode || 0;
      if (status >= 400 && status < 500 && status !== 409) {
        wx.removeStorageSync(storageKey);
        this._receipt = null;
        this._payload = null;
        this.setData({
          pending: false,
          actionError: e.message || "未能创建，请检查输入",
        });
      } else
        this.setData({
          canRetry: false,
          actionError: "创建结果尚未确认，请先核对，避免重复创建。",
        });
    } finally {
      if (flights.get(storageKey) === attempt) flights.delete(storageKey);
      if (this.active(owner, turn)) this.setData({ busy: false });
    }
  },
  async recover() {
    if (!this.ready() || !this._receipt) return;
    const owner = this._owner,
      turn = this._turn,
      requestId = this._receipt.requestId;
    this.setData({ busy: true, actionError: "" });
    try {
      const result = await s.api.request(
        "/tactic-create-receipts?requestId=" + encodeURIComponent(requestId),
      );
      if (!this.active(owner, turn)) return;
      if (
        result.requestId !== requestId ||
        !Number.isSafeInteger(result.tacticId) ||
        result.tacticId < 1 ||
        typeof result.available !== "boolean"
      )
        throw Error("核对结果异常，请勿重复创建");
      this.setData({
        createdId: result.available ? result.tacticId : null,
        unavailable: !result.available,
        actionError: result.available
          ? "已确认创建成功，可进入编辑。"
          : "该请求已创建过战术，但战术已被删除，不会重复创建。",
      });
    } catch (e) {
      if (this.active(owner, turn))
        this.setData({
          canRetry:
            e.status === 404 && !!this._payload && !flights.has(this._key),
          actionError:
            e.status === 404
              ? "暂未查到回执，原请求可能仍在处理中。请稍后再核对，不要重复创建。"
              : e.message,
        });
    } finally {
      if (this.active(owner, turn)) this.setData({ busy: false });
    }
  },
  retry() {
    if (
      !this.ready() ||
      !this.data.pending ||
      !this.data.canRetry ||
      !this._payload ||
      flights.has(this._key)
    )
      return;
    const payload = this._payload,
      owner = this._owner,
      turn = this._turn;
    ui.showModal(this, {
      title: "重试原创建请求",
      content: `${payload.tactic.title} · ${payload.tactic.board.playerCount} 人制 · ${payload.tactic.formationName || "空白战术"}。使用完全相同的请求编号和内容重试，不创建新的请求。`,
      success: (r) => {
        if (
          r.confirm &&
          this.ready() &&
          this.active(owner, turn) &&
          this._payload === payload &&
          !flights.has(this._key)
        )
          this.submit(payload, owner, turn);
      },
    });
  },
  enterCreated() {
    if (!this.active(this._owner, this._turn) || !this.data.createdId) return;
    const id = this.data.createdId,
      owner = this._owner,
      turn = this._turn,
      storageKey = this._key,
      requestId = this._receipt?.requestId;
    wx.redirectTo({
      url: "/pages/tactic-board/index?id=" + id,
      success: () => {
        // 仅清除这次已确认的收据；导航失败仍保留入口。
        if (
          s.api.getSession()?.token === owner &&
          wx.getStorageSync(storageKey)?.requestId === requestId
        )
          wx.removeStorageSync(storageKey);
      },
      fail: () => {
        if (this.active(owner, turn))
          this.setData({
            actionError: "已创建成功，但未能打开编辑页，请重试进入。",
          });
      },
    });
  },
  finishDeleted() {
    if (!this.ready() || !this.data.unavailable) return;
    wx.removeStorageSync(this._key);
    this._receipt = null;
    this._payload = null;
    this.setData({
      pending: false,
      unavailable: false,
      createdId: null,
      actionError: "",
    });
  },
});
