const ui=require('../../utils/ui');
const s = require("../shared");
Page({
  onShow() { this._hidden = false; },
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
  data: { username: "", password: "", busy: false, error: "" },
  onUnload() {ui.abort(this);
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
    const active = () => this._loginAttempt === attempt && !this._disposed && !this._hidden;
    try {
      await attempt.promise;
      if (active()) {
        this._authenticated = true;
        this.setData({ password: "" });
        wx.switchTab({ url: "/pages/home/index" });
      }
    } catch (e) {
      if (active())
        this.setData({ error: e.message || "登录失败，请重试" });
    } finally {
      if (this._loginAttempt === attempt) {
        this._loginAttempt = null;
        if (!this._disposed) this.setData({ busy: false });
      }
    }
  },
});
