const ui=require('../../utils/ui');
const s = require("../shared");
Page({onHide(){ui.abort(this);this._hidden=true;this.setData({admin:false,venues:[]});return s.hide.apply(this,arguments);},
  data: { loading: true, error: "", venues: [], search: "", admin: false },
  onShow() {
    this._hidden = false;
    return this.refresh();
  },
  onPullDownRefresh() {
    this.refresh();
  },
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  refresh() {
    const owner = s.api.getSession()?.token;
    this._venueOwner = owner;
    this.setData({admin:false});
    return s.load(this, async (session) => {
      if (!owner || owner !== s.api.getSession()?.token) return {};
      if (session.user.role !== "admin")
        throw new Error("仅管理员可以管理球场");
      return { venues: await s.api.request("/venues"), admin: true };
    });
  },
  create() {
    if (this._disposed || this._hidden || this.data.loading || this.data.error || !this.data.admin || !this._venueOwner || this._venueOwner !== s.api.getSession()?.token) return;
    wx.navigateTo({ url: "/pages/manage-venue/index" });
  },
  edit(e) {
    if (this._disposed || this._hidden || this.data.loading || this.data.error || !this.data.admin || !this._venueOwner || this._venueOwner !== s.api.getSession()?.token) return;
    wx.navigateTo({
      url:
        "/pages/manage-venue/index?id=" +
        encodeURIComponent(e.currentTarget.dataset.id),
    });
  },
});
