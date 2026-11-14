const ui=require('../../utils/ui');
const s = require("../shared");
Page({onHide(){ui.abort(this);},
  data: { username: "", password: "", busy: false, error: "" },
  onUnload() {ui.abort(this);
    s.unload.call(this);
    if (this.data.busy && !this._authenticated) s.api.clearSession();
  },
  username(e) {
    this.setData({ username: e.detail.value });
  },
  password(e) {
    this.setData({ password: e.detail.value });
  },
  async submit() {
    if (this.data.busy) return;
    const username = this.data.username.trim();
    if (!username || !this.data.password) {
      this.setData({ error: "请输入账号和密码" });
      return;
    }
    this._authenticated = false;
    this.setData({ busy: true, error: "" });
    try {
      await s.api.login(username, this.data.password);
      if (!this._disposed) {
        this._authenticated = true;
        this.setData({ password: "" });
        wx.switchTab({ url: "/pages/home/index" });
      }
    } catch (e) {
      if (!this._disposed)
        this.setData({ error: e.message || "登录失败，请重试" });
    } finally {
      if (!this._disposed) this.setData({ busy: false });
    }
  },
});
