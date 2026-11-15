const s = require("../shared");
const ui = require("../../utils/ui");
const labels = {
  pending: "等待认领",
  claimed: "等待管理员审批",
  approved: "已审批，请重新登录",
  rejected: "申请已被拒绝",
  revoked: "邀请已撤销",
  expired: "邀请已过期",
};
Page({
  data: {
    loading: true,
    error: "",
    enabled: false,
    busy: false,
    hasCredential: false,
    showInput: true,
    status: "",
    statusLabel: "",
    confirmationCode: "",
    actionError: "",
  },
  onLoad(q) {
    this._credential = /^[a-f0-9]{64}$/.test(q.credential || "")
      ? q.credential
      : "";
    this.setData({ hasCredential: !!this._credential });
  },
  async onShow() {
    this._hidden = false;
    this.setData({ showInput: true });
    const turn = (this._turn = (this._turn || 0) + 1);
    this.setData({ loading: true, error: "" });
    try {
      const c = await s.api.capabilities();
      if (!this._hidden && !this._disposed && turn === this._turn)
        this.setData({ enabled: c.wechat });
    } catch (_) {
      if (!this._hidden && !this._disposed && turn === this._turn)
        this.setData({ error: "无法读取微信服务状态，请重试" });
    } finally {
      if (!this._hidden && !this._disposed && turn === this._turn)
        this.setData({ loading: false });
    }
  },
  refresh() {
    return this.onShow();
  },
  onHide() {
    this._hidden = true;
    this._turn = (this._turn || 0) + 1;
    ui.abort(this);
    this.cancel();
    this._credential = "";
    this._inviteId = null;
    this.setData({
      hasCredential: false,
      showInput: false,
      confirmationCode: "",
      status: "",
      statusLabel: "",
      loading: true,
    });
  },
  onUnload() {
    this.onHide();
    this._disposed = true;
    this._inviteId = null;
  },
  cancel() {
    this._attempt?.cancel();
    this._attempt = null;
    this.setData({ busy: false });
  },
  credential(e) {
    if (this.data.busy) return;
    this._credential = String(e.detail.value || "").trim();
    this._inviteId = null;
    this.setData({
      status: "",
      statusLabel: "",
      confirmationCode: "",
      actionError: "",
    });
    this.setData({ hasCredential: !!this._credential });
  },
  valid() {
    return (
      !this._disposed &&
      !this._hidden &&
      !this.data.loading &&
      !this.data.error &&
      this.data.enabled &&
      !this.data.busy
    );
  },
  async run(action) {
    if (!this.valid()) return;
    if (s.api.getSession()) {
      this.setData({
        actionError: "请先从“我的”退出当前账号，再认领或切换微信账号。",
      });
      return;
    }
    if (action === "claim" && !/^[a-f0-9]{64}$/.test(this._credential || "")) {
      this.setData({ actionError: "请输入管理员提供的完整邀请码" });
      return;
    }
    if (action === "claim-status" && !this._inviteId) return;
    const input =
      action === "claim"
        ? {
            credential: this._credential,
            requestId:
              "claim-" +
              Date.now().toString(36) +
              "-" +
              Math.random().toString(36).slice(2),
          }
        : action === "claim-status"
          ? { inviteId: this._inviteId }
          : {};
    const turn = this._turn;
    this.setData({ busy: true, actionError: "", showInput: false });
    let attempt;
    try {
      attempt = s.api.beginWechat(action, input);
    } catch (e) {
      this.setData({
        busy: false,
        showInput: true,
        actionError: e.message || "无法开始微信操作",
      });
      return;
    }
    this._attempt = attempt;
    const active = () =>
      !this._hidden &&
      !this._disposed &&
      turn === this._turn &&
      this._attempt === attempt;
    try {
      const result = await attempt.promise;
      if (!active()) return;
      if (action === "login") {
        s.api.enterAuthenticated();
        return;
      }
      if (!/^[a-f0-9]{32}$/.test(result.id || "") || !labels[result.status])
        throw new Error("申请响应无效，请联系管理员");
      this._inviteId = result.id;
      this.setData({
        status: result.status,
        statusLabel: labels[result.status],
        confirmationCode: /^[A-F0-9]{8}$/.test(result.confirmationCode || "")
          ? result.confirmationCode
          : "",
      });
    } catch (e) {
      if (active())
        this.setData({
          actionError:
            e.status === 429
              ? "操作较频繁，请稍后主动重试。"
              : action === "claim" && (!e.status || e.status >= 500)
                ? "提交结果尚未确认。可使用原邀请码重新提交，系统只恢复本人申请，不重复创建。"
                : e.message || "微信操作未完成",
        });
    } finally {
      if (this._attempt === attempt) {
        this._attempt = null;
        if (!this._disposed && !this._hidden)
          this.setData({ busy: false, showInput: true });
      }
    }
  },
  submit() {
    return this.run("claim");
  },
  status() {
    return this.run("claim-status");
  },
  login() {
    return this.run("login");
  },
  back() {
    if (!this.data.busy) wx.reLaunch({ url: "/pages/login/index" });
  },
});
