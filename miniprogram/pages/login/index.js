const ui = require("../../utils/ui");
const s = require("../shared");
Page({
  onShow() {
    this._hidden = false;
    this.loadCapabilities();
  },
  async loadCapabilities() {
    const turn = (this._capTurn = (this._capTurn || 0) + 1);
    try {
      const c = await s.api.capabilities();
      if (!this._hidden && !this._disposed && turn === this._capTurn)
        this.setData({ wechatEnabled: c.wechat });
    } catch (_) {
      if (!this._hidden && !this._disposed && turn === this._capTurn)
        this.setData({ wechatEnabled: false });
    }
  },
  acceptInvite() {
    if (!this.data.busy && this.data.wechatEnabled)
      wx.navigateTo({ url: "/pages/wechat-claim/index" });
  },
  async wechatLogin() {
    if (
      this.data.busy ||
      !this.data.wechatEnabled ||
      this._hidden ||
      this._disposed
    )
      return;
    this.setData({ busy: true, error: "" });
    let attempt;
    try {
      attempt = s.api.beginWechat("login");
    } catch (e) {
      this.setData({ busy: false, error: e.message || "无法开始微信登录" });
      return;
    }
    this._loginAttempt = attempt;
    const active = () =>
      this._loginAttempt === attempt && !this._disposed && !this._hidden;
    try {
      await attempt.promise;
      if (active()) {
        this.setData({ password: "" });
        s.api.enterAuthenticated();
      }
    } catch (e) {
      if (active())
        this.setData({
          error:
            e.status === 403
              ? "尚未完成微信绑定，请先接受球队邀请并等待审批。"
              : e.message || "微信登录未完成",
        });
    } finally {
      if (this._loginAttempt === attempt) {
        this._loginAttempt = null;
        if (!this._disposed) this.setData({ busy: false });
      }
    }
  },
  onHide() {
    ui.abort(this);
    this._hidden = true;
    this.cancelLogin();
  },
  cancelLogin() {
    const attempt = this._loginAttempt;
    this._loginAttempt = null;
    if (attempt) attempt.cancel();
    this.setData({ password: "", busy: false });
  },
  badgeError() {
    if (!this._disposed) this.setData({ badgeFailed: true });
  },
  data: {
    badgeFailed: false,
    username: "",
    password: "",
    busy: false,
    error: "",
    wechatEnabled: false,
  },
  onUnload() {
    ui.abort(this);
    s.unload.call(this);
    this.cancelLogin();
  },
  username(e) {
    this.setData({ username: e.detail.value });
  },
  password(e) {
    this.setData({ password: e.detail.value });
  },
  async submit() {
    if (this.data.busy || this._hidden || this._disposed) return;
    const username = this.data.username.trim();
    if (!username || !this.data.password) {
      this.setData({ error: "请输入账号和密码" });
      return;
    }
    this._authenticated = false;
    this.setData({ busy: true, error: "" });
    const attempt = s.api.beginLogin(username, this.data.password);
    this._loginAttempt = attempt;
    const active = () =>
      this._loginAttempt === attempt && !this._disposed && !this._hidden;
    try {
      await attempt.promise;
      if (active()) {
        this._authenticated = true;
        this.setData({ password: "" });
        s.api.enterAuthenticated();
      }
    } catch (e) {
      if (active()) this.setData({ error: e.message || "登录失败，请重试" });
    } finally {
      if (this._loginAttempt === attempt) {
        this._loginAttempt = null;
        if (!this._disposed) this.setData({ busy: false });
      }
    }
  },
});
