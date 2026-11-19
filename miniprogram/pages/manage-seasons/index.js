const ui=require('../../utils/ui');
const a = require("../manage-team/admin");
Page({onHide(){a.hide.call(this);},
  data: { loading: true, error: "", authorized: false, seasons: [] },
  onShow() {
    return a.show.call(this, true);
  },
  onUnload(){ui.abort(this);return a.unload.apply(this,arguments);},
  refresh() {
    return a.load(this, async () => ({
      seasons: (await a.s.api.request("/seasons")).map((s) => ({
        id: s.id,
        name: s.name,
        icon:a.s.assetUrl(s.icon),image:a.s.assetUrl(s.image),
        startDate: s.startDate,
        endDate: s.endDate,
      })),
    }));
  },
  create() {
    wx.navigateTo({ url: "/pages/manage-season/index" });
  },
  edit(e) {
    wx.navigateTo({
      url:
        "/pages/manage-season/index?id=" +
        encodeURIComponent(e.currentTarget.dataset.id),
    });
  },
});
