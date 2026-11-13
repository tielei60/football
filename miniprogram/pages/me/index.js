const s = require("../shared");
Page({
  data: {
    loading: true,
    error: "",
    session: null,
    player: null,
    registration: null,
    passwordOpen: false,
    currentPassword: "",
    newPassword: "",
    busy: false,
    actionError: "",
  },
  onShow() {
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh();
  },
  onUnload() {
    this._viewEpoch = (this._viewEpoch || 0) + 1;
    s.unload.call(this);
  },
  onHide() {
    this._viewEpoch = (this._viewEpoch || 0) + 1;
    s.hide.call(this);
  },
  imageError: s.imageError,
  refresh() {
    return s.load(this, async (session) => {
      const [players, stats] = await Promise.all([
        s.api.request("/players"),
        s.api.request("/statistics"),
      ]);
      const profile = players.find((p) => p.id === session.user.playerId);
      const record = stats.players.find(
        (p) => p.playerId === session.user.playerId,
      );
      return {
        session,
        player: profile ? s.playerView(profile) : null,
        registration: record?.registration || null,
        year: new Date().getFullYear(),
      };
    });
  },
  profile() {
    if (this.data.player)
      wx.navigateTo({
        url:
          "/pages/player-detail/index?id=" +
          encodeURIComponent(this.data.player.id),
      });
  },
  togglePassword() {
    if (this.data.busy) return;
    this.setData({
      passwordOpen: !this.data.passwordOpen,
      currentPassword: "",
      newPassword: "",
      actionError: "",
    });
  },
  input(e) {
    if (this.data.busy) return;
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  async changePassword() {
    if (this.data.busy) return;
    if (this.data.newPassword.length < 10) {
      this.setData({ actionError: "新密码至少 10 个字符" });
      return;
    }
    const viewEpoch = this._viewEpoch || 0;
    this.setData({ busy: true, actionError: "" });
    try {
      await s.api.request("/auth/password", "PUT", {
        currentPassword: this.data.currentPassword,
        newPassword: this.data.newPassword,
      });
      s.api.clearSession();
      this.setData({ currentPassword: "", newPassword: "" });
      wx.reLaunch({ url: "/pages/login/index" });
    } catch (e) {
      if (!this._disposed && viewEpoch === (this._viewEpoch || 0))
        this.setData({ actionError: e.message || "修改失败" });
    } finally {
      this.data.busy = false;
      if (!this._disposed) this.setData({ busy: false });
    }
  },
  logout() {
    if (this.data.busy) return;
    wx.showModal({
      title: "退出登录",
      content: "确认退出当前俱乐部账号？",
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ busy: true, actionError: "" });
        try {
          await s.api.logout();
          wx.reLaunch({ url: "/pages/login/index" });
        } catch (e) {
          wx.showModal({ title: "本机已退出", content: "服务器注销未确认。网络恢复后请重新登录并修改密码，以撤销所有旧会话。", showCancel: false, complete: () => wx.reLaunch({ url: "/pages/login/index" }) });
        } finally {
          this.data.busy = false;
          if (!this._disposed) this.setData({ busy: false });
        }
      },
    });
  },
});
