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
    searchHasText: false,
    status: "active",
    statusInitialized: false,
  },
  onShow() {
    return a.show.call(this, true);
  },
  onUnload(){ui.abort(this);return a.unload.apply(this,arguments);},
  refresh() {
    const owner = a.s.api.getSession()?.token;
    if (this._filterOwner !== owner) {
      this._filterOwner = owner;
      this.setData({
        status: "active",
        statusInitialized: false,
        search: "",
        searchHasText: false,
      });
    }
    return a.load(this, async () => {
      const imageEpoch = this._epoch;
      const players = (await a.s.api.request("/players")).map((p) => ({
        ...a.s.playerView(p),
        hasAccount: p.hasAccount,
      }));
      const status = this.data.statusInitialized ? this.data.status : !players.some(p=>p.status==="active"&&p.membershipConfirmed!==false)&&players.some(p=>p.membershipConfirmed===false) ? "unconfirmed" : "active";
      return { imageEpoch, players, status, statusInitialized:true, visible: this.filter(players,status) };
    });
  },
  filter(rows, status=this.data.status) {
    const query = this.data.search.trim();
    return rows.filter(
      (p) =>
        (status === "unconfirmed" ? p.membershipConfirmed === false : p.membershipConfirmed !== false && p.status === status) &&
        (!query ||
          p.name.includes(query) ||
          String(p.number ?? "").includes(query)),
    );
  },
  search(e) {
    this.setData({ search: e.detail.value, searchHasText: e.detail.value.trim().length > 0 });
    this.setData({ visible: this.filter(this.data.players) });
  },
  status(e) {
    const status=e.currentTarget.dataset.status;
    if(this._filterOwner!==a.s.api.getSession()?.token||!["active","inactive","unconfirmed"].includes(status))return;
    this.setData({ status, statusInitialized:true });
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
