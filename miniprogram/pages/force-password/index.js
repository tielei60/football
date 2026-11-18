const api = require("../../utils/api");
const ui = require("../../utils/ui");
Page({
  data: {
    loading: true,
    error: "",
    errorSource: "",
    busy: false,
    currentPassword: "",
    newPassword: "",
    confirmation: "",
  },
  onShow() {
    this._hidden = false;
    return this.refresh();
  },
  onHide() {
    ui.abort(this);
    this._hidden = true;
    this._turn = (this._turn || 0) + 1;
    this.setData({ currentPassword: "", newPassword: "", confirmation: "" });
  },
  onUnload() {
    this.onHide();
    this._disposed = true;
  },
  active(owner, turn) {
    return (
      !this._hidden &&
      !this._disposed &&
      this._turn === turn &&
      api.getSession()?.token === owner
    );
  },
  async refresh() {
    const owner = api.getSession()?.token,
      turn = (this._turn = (this._turn || 0) + 1);
    this.setData({ loading: true, error: "", errorSource: "", busy: false });
    let loadError;
    const current = () =>
      !this._hidden && !this._disposed && turn === this._turn &&
      loadError?.staleSession !== true &&
      (api.getSession()?.token === owner ||
        ((loadError?.status || loadError?.statusCode) === 401 && !api.getSession()));
    try {
      const session = await api.ensureSession({ allowPasswordChange: true });
      if (!this.active(owner, turn)) return;
      if (!session.user.mustChangePassword) {
        api.enterAuthenticated();
        return;
      }
      if (session.user.passwordEnabled === false)
        throw Error("此账号无法使用密码，请联系系统管理员。");
      this._owner = owner;
    } catch (e) {
      loadError = e;
      if (current()) {
        this.setData({ error: e.message, errorSource: "load" });
        if ((e.status || e.statusCode) === 401 && !api.getSession())
          wx.reLaunch({ url: "/pages/login/index" });
      }
    } finally {
      if (current()) this.setData({ loading: false });
    }
  },
  input(e) {
    const field = e.currentTarget.dataset.field;
    if (
      this.data.busy ||
      !["currentPassword", "newPassword", "confirmation"].includes(field)
    )
      return;
    this.setData({ [field]: e.detail.value });
  },
  async submit() {
    const owner = this._owner,
      turn = this._turn;
    if (!this.active(owner, turn) || this.data.busy || this.data.loading || this.data.errorSource === "load")
      return;
    const currentPassword = this.data.currentPassword,
      newPassword = this.data.newPassword;
    if (
      !currentPassword ||
      newPassword.length < 10 ||
      newPassword.length > 200 ||
      newPassword !== this.data.confirmation
    ) {
      this.setData({
        errorSource: "submit",
        error: "请输入当前密码和 10–200 位新密码，两次新密码须一致。",
      });
      return;
    }
    this.setData({ busy: true, error: "", errorSource: "" });
    let submitError, completed = false;
    const current = () =>
      !this._hidden && !this._disposed && turn === this._turn &&
      submitError?.staleSession !== true &&
      (api.getSession()?.token === owner ||
        (!api.getSession() && (completed ||
          (submitError?.status || submitError?.statusCode) === 401)));
    try {
      await api.request("/auth/password", "PUT", {
        currentPassword,
        newPassword,
      });
      completed = true;
      if (api.getSession()?.token === owner) api.clearSession();
      if (
        !this._hidden &&
        !this._disposed &&
        turn === this._turn &&
        !api.getSession()
      )
        wx.reLaunch({ url: "/pages/login/index" });
    } catch (e) {
      submitError = e;
      if (!current()) return;
      if (this.active(owner, turn))
        this.setData({
          errorSource: "submit",
          error: !(e.status || e.statusCode) || (e.status || e.statusCode) >= 500 ? "修改结果未确认，请退出后使用新密码登录核对；不要直接重复修改。" : e.message || "修改失败，请核对输入。",
        });
      else if (
        !this._hidden &&
        !this._disposed &&
        turn === this._turn &&
        !api.getSession() &&
        (e.status || e.statusCode) === 401
      )
        wx.reLaunch({ url: "/pages/login/index" });
    } finally {
      if (current())
        this.setData({
          busy: false,
          currentPassword: "",
          newPassword: "",
          confirmation: "",
        });
    }
  },
  async logout() {
    if (this.data.busy) return;
    const owner = api.getSession()?.token,
      turn = this._turn;
    this.setData({ busy: true });
    try {
      await api.logout();
    } catch (_) {
    } finally {
      if (api.getSession()?.token === owner) api.clearSession();
      if (
        !this._hidden &&
        !this._disposed &&
        turn === this._turn &&
        !api.getSession()
      )
        wx.reLaunch({ url: "/pages/login/index" });
    }
  },
});
