const ui=require('../../utils/ui');
const s = require("../shared");
Page({onHide(){ui.abort(this);},
  data: { loading: true, error: "", venues: [], search: "" },
  onShow() {
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh();
  },
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  refresh() {
    return s.load(this, async (session) => {
      if (session.user.role !== "admin")
        throw new Error("仅管理员可以管理球场");
      return { venues: await s.api.request("/venues") };
    });
  },
  create() {
    wx.navigateTo({ url: "/pages/manage-venue/index" });
  },
  edit(e) {
    wx.navigateTo({
      url:
        "/pages/manage-venue/index?id=" +
        encodeURIComponent(e.currentTarget.dataset.id),
    });
  },
});
