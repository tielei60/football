const ui = require("../../utils/ui");
const a = require("../manage-team/admin");
const standard = [
  "门将",
  "后卫",
  "中后卫",
  "边后卫",
  "后腰",
  "中场",
  "前腰",
  "边前卫",
  "左边前",
  "右边前",
  "中锋",
  "前锋",
  "待定",
];
Page({
  async openWechat() {
    if (
      this._hidden ||
      this._disposed ||
      this.data.loading ||
      this.data.busy ||
      !this.id
    )
      return;
    const token = a.s.api.getSession()?.token,
      epoch = this._epoch;
    try {
      const c = await a.s.api.capabilities();
      if (
        this._hidden ||
        this._disposed ||
        epoch !== this._epoch ||
        token !== a.s.api.getSession()?.token
      )
        return;
      if (!c.wechat) {
        ui.showToast(this, { title: "微信邀请尚未启用", icon: "none" });
        return;
      }
      wx.navigateTo({
        url: "/pages/wechat-invites/index?id=" + encodeURIComponent(this.id),
      });
    } catch (e) {
      if (
        !this._hidden &&
        !this._disposed &&
        token === a.s.api.getSession()?.token
      )
        ui.showToast(this, { title: "暂时无法读取微信配置", icon: "none" });
    }
  },

  openPhotos() {
    if (
      this._disposed ||
      this._hidden ||
      this.data.loading ||
      this.data.error ||
      this.data.busy ||
      !this.id
    )
      return;
    wx.navigateTo({
      url: "/pages/player-photos/index?id=" + encodeURIComponent(this.id),
    });
  },
  openBusinessPicker(e){return require('../../utils/business-picker-bridge').open(this,e);},
  createKind: "player",
  confirmNotCreated: a.confirmNotCreated,
  data: {
    loading: true,
    error: "",
    authorized: false,
    wechatEnabled: false,
    busy: false,
    conflict: false,
    uncertain: false,
    actionError: "",
    id: "",
    revision: null,
    status: "active",
    hasAccount: false,
    passwordEnabled: true,
    avatar: "",
    form: {
      name: "",
      number: "",
      positions: ["待定"],
      preferredFoot: "",
      note: "",
    },
    positionOptions: [],
    feet: ["未设置", "右脚", "左脚", "双脚"],
    footIndex: 0,
    accountOpen: false,
    username: "",
    password: "",
  },
  async onShow() {
    const beforeEpoch = this._epoch;
    await a.show.call(this);
    // 首次载入及本次重新载入由 refresh 统一提交能力，避免早于权限结果返回。
    if (this.data.loading || beforeEpoch !== this._epoch) return;
    const token = a.s.api.getSession()?.token,
      epoch = this._epoch,
      view = this._adminView || 0;
    if (!this.data.authorized || this._hidden || this._disposed) return;
    try {
      const c = await a.s.api.capabilities();
      if (
        !this._hidden &&
        !this._disposed &&
        epoch === this._epoch && view === (this._adminView || 0) &&
        token === a.s.api.getSession()?.token
      )
        this.setData({ wechatEnabled: c.wechat });
    } catch (_) {
      if (!this._hidden && !this._disposed && epoch === this._epoch && view === (this._adminView || 0) &&
          token === a.s.api.getSession()?.token)
        this.setData({ wechatEnabled: false });
    }
  },
  onLoad(q) {
    this.id = q.id;
    return this.refresh();
  },
  onUnload() {
    ui.abort(this);
    this.setData({ password: "" });
    a.unload.call(this);
  },
  onHide() {
    a.hide.call(this);
    this.setData({ password: "", wechatEnabled: false });
  },
  refresh() {
    if (this.data.busy) return;
    this._imageData = undefined;
    this.setData({ wechatEnabled: false });
    return a.load(this, async () => {
      const p = this.id
        ? (await a.s.api.request("/players")).find((x) => x.id === this.id)
        : null;
      if (this.id && !p) throw new Error("球员不存在");
      // 能力读取失败不阻断已有球员管理，最终提交沿用 a.load 的身份与代次门禁。
      let wechatEnabled = false;
      if (!this._hidden && !this._disposed) {
        try { wechatEnabled = (await a.s.api.capabilities()).wechat === true; }
        catch (_) { /* 保持关闭，不影响密码账号管理。 */ }
      }
      const selected = p?.positions || ["待定"];
      const feet = ["未设置", "右脚", "左脚", "双脚"];
      if (p?.preferredFoot && !feet.includes(p.preferredFoot))
        feet.push(p.preferredFoot);
      return {
        id: this.id || "",
        wechatEnabled,
        revision: p?.revision || null,
        status: p?.status || "active",
        hasAccount: !!p?.hasAccount,
        passwordEnabled: p?.passwordEnabled !== false,
        accountOpen: false,
        avatar: a.s.assetUrl(p?.avatar),
        form: {
          name: p?.name || "",
          number: p?.number == null ? "" : String(p.number),
          positions: selected,
          preferredFoot: p?.preferredFoot || "",
          note: p?.note || "",
        },
        positionOptions: [...new Set([...standard, ...selected])].map(
          (name) => ({ name, selected: selected.includes(name) }),
        ),
        feet,
        footIndex: p?.preferredFoot ? feet.indexOf(p.preferredFoot) : 0,
        conflict: false,
        uncertain: false,
        actionError: "",
        username: "",
        password: "",
      };
    });
  },
  input: a.input,
  reload() {
    a.reload(this);
  },
  position(e) {
    if (this.data.busy) return;
    const name = e.currentTarget.dataset.name;
    const selected = this.data.form.positions.includes(name)
      ? this.data.form.positions.filter((p) => p !== name)
      : [...this.data.form.positions, name];
    this.setData({
      "form.positions": selected,
      positionOptions: this.data.positionOptions.map((p) => ({
        ...p,
        selected: selected.includes(p.name),
      })),
    });
  },
  foot(e) {
    if (this.data.busy) return;
    const footIndex = Number(e.detail.value);
    this.setData({
      footIndex,
      "form.preferredFoot": footIndex ? this.data.feet[footIndex] : "",
    });
  },
  choose() {
    a.choosePicture(this, "avatar");
  },
  remove() {
    if (this.data.busy) return;
    this._imageEpoch = (this._imageEpoch || 0) + 1;
    this._imageData = null;
    this.setData({ avatar: "" });
  },
  imageError() {
    this.setData({ avatar: "" });
  },
  save() {
    const f = this.data.form;
    if (!f.name.trim()) {
      this.setData({ actionError: "请输入姓名" });
      return;
    }
    if (
      f.number !== "" &&
      (!/^\d+$/.test(f.number) || Number(f.number) > 9999)
    ) {
      this.setData({ actionError: "号码为 0–9999 的整数，未知请留空" });
      return;
    }
    if (!f.positions.length) {
      this.setData({ actionError: "请选择至少一个位置，未知可选待定" });
      return;
    }
    const payload = {
      ...f,
      name: f.name.trim(),
      number: f.number === "" ? null : Number(f.number),
      status: this.data.status,
    };
    if (this.id) payload.revision = this.data.revision;
    if (this._imageData !== undefined) payload.avatar = this._imageData;
    return a.act(
      this,
      () =>
        !this.id
          ? a.createRequest(this, "/players", payload)
          : a.s.api.request(
              this.id ? "/players/" + encodeURIComponent(this.id) : "/players",
              this.id ? "PUT" : "POST",
              payload,
            ),
      (p) => {
        this.id = p.id;
        this._imageData = undefined;
        this.setData({
          id: p.id,
          revision: p.revision,
          hasAccount: p.hasAccount,
          passwordEnabled: p.passwordEnabled !== false,
        });
        ui.showToast(this, { title: "球员已保存" });
      },
      !this.id,
    );
  },
  archive() {
    if (this.data.busy || !this.id) return;
    const status = this.data.status === "active" ? "inactive" : "active";
    ui.showModal(this, {
      title: status === "inactive" ? "归档球员" : "恢复球员",
      content:
        status === "inactive"
          ? "归档后该球员退出登录，历史比赛记录保留。未保存修改不会提交。"
          : "恢复为在队状态，历史记录保持不变。",
      success: (r) => {
        if (r.confirm && !this._disposed)
          a.act(
            this,
            () =>
              a.s.api.request(
                "/players/" + encodeURIComponent(this.id),
                "PUT",
                { revision: this.data.revision, status },
              ),
            (p) => {
              this.setData({ revision: p.revision, status: p.status });
              ui.showToast(this, { title: "状态已更新" });
            },
          );
      },
    });
  },
  toggleAccount() {
    if (this.data.busy || (this.data.hasAccount && !this.data.passwordEnabled)) return;
    this.setData({
      accountOpen: !this.data.accountOpen,
      password: "",
      username: "",
    });
  },
  accountInput(e) {
    if (this.data.busy) return;
    const key = e.currentTarget.dataset.field;
    if (["username", "password"].includes(key))
      this.setData({ [key]: e.detail.value });
  },
  account() {
    if (!this.id || this.data.status !== "active" ||
        (this.data.hasAccount && !this.data.passwordEnabled)) return;
    if (
      this.data.password.length < 10 ||
      (!this.data.hasAccount && !this.data.username.trim())
    ) {
      this.setData({ actionError: "请填写账号和至少 10 位密码" });
      return;
    }
    ui.showModal(this, {
      title: this.data.hasAccount ? "重置登录密码" : "开通球员账号",
      content: this.data.hasAccount
        ? "重置后该球员所有现有会话失效。是否继续？"
        : "为当前球员创建独立登录账号。是否继续？",
      success: (r) => {
        if (!r.confirm || this._disposed ||
            (this.data.hasAccount && !this.data.passwordEnabled)) return;
        const existing = this.data.hasAccount;
        const body = existing
          ? { newPassword: this.data.password }
          : {
              username: this.data.username.trim(),
              password: this.data.password,
            };
        a.act(
          this,
          () =>
            a.s.api.request(
              "/players/" +
                encodeURIComponent(this.id) +
                (existing ? "/password" : "/account"),
              existing ? "PUT" : "POST",
              body,
            ),
          () => {
            this.setData({
              password: "",
              username: "",
              hasAccount: true,
              accountOpen: false,
            });
            ui.showToast(this, {
              title: existing ? "密码已重置" : "账号已开通",
            });
          },
          true,
        ).finally(() => {
          if (!this._disposed) this.setData({ password: "" });
        });
      },
    });
  },
  backToList() {
    wx.redirectTo({ url: "/pages/manage-players/index" });
  },
});
