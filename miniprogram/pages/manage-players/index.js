const ui=require('../../utils/ui');
const a = require("../manage-team/admin");
Page({onHide(){a.hide.call(this);},
  data: {
    loading: true,
    error: "",
    authorized: false,
    players: [],
    visible: [],
    search: "",
    status: "active",
  },
  onShow() {
    return a.show.call(this, true);
  },
  onUnload(){ui.abort(this);return a.unload.apply(this,arguments);},
  refresh() {
    return a.load(this, async () => {
      const players = (await a.s.api.request("/players")).map((p) => ({
        ...a.s.playerView(p),
        hasAccount: p.hasAccount,
      }));
      return { players, visible: this.filter(players) };
    });
  },
  filter(rows) {
    const query = this.data.search.trim();
    return rows.filter(
      (p) =>
        p.status === this.data.status &&
        (!query ||
          p.name.includes(query) ||
          String(p.number ?? "").includes(query)),
    );
  },
  search(e) {
    this.setData({ search: e.detail.value });
    this.setData({ visible: this.filter(this.data.players) });
  },
  status(e) {
    this.setData({ status: e.currentTarget.dataset.status });
    this.setData({ visible: this.filter(this.data.players) });
  },
  create() {
    wx.navigateTo({ url: "/pages/manage-player/index" });
  },
  edit(e) {
    wx.navigateTo({
      url:
        "/pages/manage-player/index?id=" +
        encodeURIComponent(e.currentTarget.dataset.id),
    });
  },
  imageError: a.s.imageError,
});
