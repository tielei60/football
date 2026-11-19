const ui = require("../../utils/ui");
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
    ui.abort(this);
    this._viewEpoch = (this._viewEpoch || 0) + 1;
    s.unload.call(this);
    this.setData({ passwordOpen: false, actionError: "", currentPassword: "", newPassword: "" });
  },
  onHide() {
    ui.abort(this);
    this._viewEpoch = (this._viewEpoch || 0) + 1;
    s.hide.call(this);
    this.setData({ passwordOpen: false, actionError: "" });
  },
  imageError: s.imageError,
  refresh() {
    const requestedOwner = s.api.getSession()?.token;
    return s.load(this, async (session) => {
      const token = s.api.getSession()?.token;
      if (token && requestedOwner === token && this._authOwner && this._authOwner !== token) {
        // 只释放已确认新登录的界面忙态，不取消旧请求或清理任何会话。
        this._authAttempt = {};
        this.setData({ busy: false, passwordOpen: false, actionError: "", currentPassword: "", newPassword: "" });
      }
      const [players, stats] = await Promise.all([
        s.api.request("/players"),
        s.api.request("/statistics?year=" + new Date().getFullYear()),
      ]);
      const profile = players.find((p) => p.id === session.user.playerId);
      const record = stats.players.find(
        (p) => p.playerId === session.user.playerId,
      );
      return {
        session: s.sessionView(session),
        player: profile ? s.playerView(profile) : null,
        registration: record?.registration || null,
        year: new Date().getFullYear(),
      };
    });
  },
  manage(e) {
    if (this._hidden || this._disposed || this.data.loading || this.data.error || this.data.busy || this.data.session?.user.role !== "admin") return;
    const catalogs = { competitions: "competition", opponents: "opponent", notices: "notice" };
    const kind = catalogs[e.currentTarget.dataset.page];
    if (kind) { wx.navigateTo({ url: "/pages/club-catalog/index?type=" + kind }); return; }
    const pages = {
      team: "manage-team",
      players: "manage-players",
      seasons: "manage-seasons",
      venues: "manage-venues",
    };
    const page = pages[e.currentTarget.dataset.page];
    if (page) wx.navigateTo({ url: "/pages/" + page + "/index" });
  },
  systemAccounts() {
    if(this._hidden||this._disposed||this.data.loading||this.data.busy||!this.data.session?.user.systemAdmin)return;
    wx.navigateTo({url:"/pages/system-accounts/index"});
  },
  matches() {
    if (this._hidden || this._disposed || this.data.loading || this.data.error || this.data.busy) return;
    wx.switchTab({ url: "/pages/schedule/index" });
  },
  statistics() {
    if (this._hidden || this._disposed || this.data.loading || this.data.error || this.data.busy) return;
    wx.switchTab({ url: "/pages/statistics/index" });
  },
  photos() {
    if (this._hidden || this._disposed || this.data.loading || this.data.error || this.data.busy || !this.data.player || this.data.player.id !== this.data.session?.user.playerId) return;
    wx.navigateTo({ url: "/pages/player-photos/index?id=" + encodeURIComponent(this.data.player.id) });
  },
  tactics() {
    wx.navigateTo({ url: "/pages/tactics/index" });
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
    if (this.data.busy || this.data.session?.user.passwordEnabled === false)
      return;
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
    if (this.data.busy || this.data.session?.user.passwordEnabled === false)
      return;
    if (this.data.newPassword.length < 10 || this.data.newPassword.length > 200) {
      this.setData({ actionError: "新密码须为 10–200 个字符" });
      return;
    }
    const viewEpoch = this._viewEpoch || 0;
    const token = s.api.getSession()?.token;
    this._authOwner = token;
    const attempt = (this._authAttempt = {});
    this.setData({ busy: true, actionError: "" });
    try {
      await s.api.request("/auth/password", "PUT", {
        currentPassword: this.data.currentPassword,
        newPassword: this.data.newPassword,
      });
      // The server revoked the original password session; never clear a newer login.
      if (s.api.getSession()?.token === token) s.api.clearSession();
      if (
        !this._disposed &&
        viewEpoch === (this._viewEpoch || 0) &&
        !s.api.getSession()
      ) {
        this.setData({ currentPassword: "", newPassword: "" });
        wx.reLaunch({ url: "/pages/login/index" });
      }
    } catch (e) {
      if (!this._disposed && viewEpoch === (this._viewEpoch || 0)) {
        if ((e.status || e.statusCode) === 401 && !s.api.getSession())
          s.fail(this, e);
        else if (s.api.getSession()?.token === token)
          this.setData({ actionError: !(e.status || e.statusCode) || (e.status || e.statusCode) >= 500 ? "修改结果未确认，请退出后使用新密码登录核对；不要直接重复修改。" : e.message || "修改失败" });
      }
    } finally {
      if (this._authAttempt === attempt) {
        this.data.busy = false;
        if (!this._disposed) this.setData({ busy: false });
      }
    }
  },
  logout() {
    if (this.data.busy) return;
    ui.showModal(this, {
      title: "退出 / 切换账号",
      content: "确认退出当前账号？退出后可使用其他球队账号登录。",
      success: async (result) => {
        if (!result.confirm) return;
        const viewEpoch = this._viewEpoch || 0;
        const passwordEnabled = this.data.session?.user.passwordEnabled !== false;
        this._authOwner = s.api.getSession()?.token;
        const attempt = (this._authAttempt = {});
        const active = () =>
          !this._disposed &&
          viewEpoch === (this._viewEpoch || 0) &&
          !s.api.getSession();
        this.setData({ busy: true, actionError: "" });
        try {
          await s.api.logout();
          if (active()) wx.reLaunch({ url: "/pages/login/index" });
        } catch (e) {
          if (!active()) return;
          ui.showModal(this, {
            title: "本机已退出",
            content:
              passwordEnabled
                ? "服务器注销未确认。网络恢复后请重新登录并修改密码，以撤销所有旧会话。"
                : "服务器注销未确认。请联系管理员解除微信绑定，以撤销旧会话；之后需重新邀请绑定。",
            showCancel: false,
            complete: () => {
              if (active()) wx.reLaunch({ url: "/pages/login/index" });
            },
          });
        } finally {
          if (this._authAttempt === attempt) {
            this.data.busy = false;
            if (!this._disposed) this.setData({ busy: false });
          }
        }
      },
    });
  },
});
