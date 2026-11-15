const api = require("../../utils/api");
const ui = require("../../utils/ui");
let pendingCreate = null;
function pending(owner) {
  if (pendingCreate && pendingCreate.owner !== owner) pendingCreate = null;
  return pendingCreate;
}
Page({
  data: {
    loading: true,
    error: "",
    busy: false,
    accounts: [],
    authorized: false,
    username: "",
    password: "",
    actionError: "",
    uncertain: false,
    canRelease: false,
  },
  onShow() {
    this._hidden = false;
    return this.refresh();
  },
  onHide() {
    ui.abort(this);
    this._hidden = true;
    this._turn = (this._turn || 0) + 1;
    this.setData({ password: "", accounts: [], authorized: false });
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
    const p = pending(owner);
    this.setData({
      loading: true,
      error: "",
      authorized: false,
      busy: !!p?.inFlight,
      uncertain: !!p,
      canRelease: false,
      ...(this._owner && this._owner !== owner
        ? { username: "", password: "", actionError: "" }
        : {}),
    });
    try {
      const session = await api.ensureSession();
      if (!this.active(owner, turn)) return;
      if (session.user.systemAdmin !== true)
        throw Error("仅系统管理员可以管理账号。");
      if (p?.inFlight) await p.done;
      if (!this.active(owner, turn)) return;
      const accounts = await api.request("/system/accounts");
      if (!this.active(owner, turn)) return;
      this._owner = owner;
      this._viewer = session.user.id;
      this.setData({
        authorized: true,
        accounts: accounts.map((x) => ({
          id: x.id,
          username: x.username,
          role: x.role,
          playerId: x.playerId,
          systemAdmin: x.systemAdmin === true,
          enabled: x.enabled === true,
          revision: x.revision,
          passwordEnabled: x.passwordEnabled !== false,
          mustChangePassword: x.mustChangePassword === true,
        })),
      });
      if (p && !p.inFlight) {
        const found = accounts.find((x) => x.username === p.username);
        if (found) {
          pendingCreate = null;
          this.setData({
            uncertain: false,
            busy: false,
            actionError:
              "该用户名已有账号，请核对账号状态。此处不确认初始密码是否与上次输入相同。",
          });
        } else
          this.setData({
            canRelease: true,
            busy: false,
            actionError:
              "未查询到上次用户名。请确认未创建后解除锁定，不会自动重试。",
          });
      }
    } catch (e) {
      if (this.active(owner, turn)) {
        this.setData({ error: e.message });
        if (e.status === 401) wx.reLaunch({ url: "/pages/login/index" });
      }
    } finally {
      if (this.active(owner, turn)) this.setData({ loading: false });
    }
  },
  input(e) {
    if (this.data.busy || this.data.uncertain) return;
    const f = e.currentTarget.dataset.field;
    if (["username", "password"].includes(f))
      this.setData({ [f]: e.detail.value });
  },
  allowed() {
    return (
      this.active(this._owner, this._turn) &&
      this.data.authorized &&
      !this.data.loading &&
      !this.data.busy &&
      !this.data.uncertain
    );
  },
  async create() {
    if (!this.allowed()) return;
    const username = this.data.username.trim(),
      password = this.data.password,
      owner = this._owner,
      turn = this._turn;
    if (!username || password.length < 10 || password.length > 200) {
      this.setData({ actionError: "请输入用户名和 10–200 位初始密码。" });
      return;
    }
    const answer = await ui.showModal(this, {
      title: "创建普通管理员",
      content: `为“${username}”创建普通管理员账号？首次登录必须修改初始密码。`,
      confirmText: "创建",
    });
    if (
      !answer.confirm ||
      answer.aborted ||
      !this.allowed() ||
      !this.active(owner, turn)
    )
      return;
    let finish;
    const done = new Promise((resolve) => {
      finish = resolve;
    });
    const p = { owner, username, inFlight: true, done };
    pendingCreate = p;
    this.setData({ busy: true, actionError: "", password: "" });
    try {
      await api.request("/system/accounts", "POST", { username, password });
      if (pendingCreate === p) pendingCreate = null;
      if (this.active(owner, turn)) {
        this.setData({
          busy: false,
          username: "",
          actionError: "账号已创建，请通过可信渠道交付初始凭据。",
        });
        await this.refresh();
      }
    } catch (e) {
      const status = e.status || 0;
      if (status >= 400 && status < 500 && pendingCreate === p)
        pendingCreate = null;
      if (this.active(owner, turn))
        this.setData({
          uncertain: pendingCreate === p,
          actionError:
            status >= 400 && status < 500
              ? e.message
              : "创建结果未确认，请核对账号列表，勿重复创建。",
        });
    } finally {
      p.inFlight = false;
      finish();
      if (this.active(owner, turn)) this.setData({ busy: false });
    }
  },
  async release() {
    const owner = this._owner,
      turn = this._turn,
      p = pending(owner);
    if (!this.active(owner, turn) || !this.data.canRelease || !p || p.inFlight)
      return;
    const answer = await ui.showModal(this, {
      title: "确认未创建",
      content: `已核对“${p.username}”未出现在列表中？解除后需要重新输入密码，系统不会自动重试。`,
    });
    if (
      answer.confirm &&
      !answer.aborted &&
      this.active(owner, turn) &&
      pendingCreate === p &&
      !p.inFlight
    ) {
      pendingCreate = null;
      this.setData({ uncertain: false, canRelease: false, actionError: "" });
    }
  },
  async update(e) {
    if (!this.allowed()) return;
    const id = Number(e.currentTarget.dataset.id),
      kind = e.currentTarget.dataset.kind;
    const account = this.data.accounts.find((x) => x.id === id);
    if (!account || account.systemAdmin) return;
    const patch = { revision: account.revision };
    let message;
    if (kind === "enabled") {
      patch.enabled = !account.enabled;
      message = `${patch.enabled ? "启用" : "停用"}“${account.username}”？此账号已有会话将失效。`;
    } else if (kind === "role" && account.playerId) {
      patch.role = account.role === "admin" ? "player" : "admin";
      message = `将“${account.username}”设为${patch.role === "admin" ? "普通管理员" : "球员"}？已有会话将失效，须重新登录。`;
    } else return;
    const owner = this._owner,
      turn = this._turn;
    const answer = await ui.showModal(this, {
      title: "调整账号权限",
      content: message,
      confirmText: "确认调整",
    });
    if (
      !answer.confirm ||
      answer.aborted ||
      !this.allowed() ||
      !this.active(owner, turn)
    )
      return;
    this.setData({ busy: true, actionError: "" });
    try {
      await api.request("/system/accounts/" + id, "PUT", patch);
      if (this.active(owner, turn)) {
        this.setData({ busy: false });
        await this.refresh();
      }
    } catch (e) {
      if (this.active(owner, turn)) {
        this.setData({
          actionError:
            e.status === 409
              ? "账号已变化，请重新载入核对后再操作。"
              : e.message || "结果未确认，请重新载入核对。",
          authorized: false,
        });
      }
    } finally {
      if (this.active(owner, turn)) this.setData({ busy: false });
    }
  },
});
