const ui=require('../../utils/ui');
const a = require("../manage-team/admin");
Page({openBusinessPicker(e){return require('../../utils/business-picker-bridge').open(this,e);},onHide(){a.hide.call(this);},
  createKind: "season",
  confirmNotCreated: a.confirmNotCreated,
  data: {
    loading: true,
    error: "",
    authorized: false,
    busy: false,
    conflict: false,
    uncertain: false,
    actionError: "",
    id: "",
    revision: null,
    form: { name: "", startDate: "", endDate: "" },
  },
  onShow() { return a.show.call(this); },
  onLoad(q) {
    this.id = q.id;
    wx.setNavigationBarTitle?.({ title: this.id ? "编辑赛季" : "新增赛季" });
    this.refresh();
  },
  onUnload(){ui.abort(this);return a.unload.apply(this,arguments);},
  refresh() {
    if (this.data.busy) return;
    return a.load(this, async () => {
      const season = this.id
        ? (await a.s.api.request("/seasons")).find(
            (s) => String(s.id) === String(this.id),
          )
        : null;
      if (this.id && !season) throw new Error("赛季不存在");
      return {
        id: this.id || "",
        revision: season?.revision || null,
        form: season
          ? {
              name: season.name,
              startDate: season.startDate,
              endDate: season.endDate,
            }
          : { name: "", startDate: "", endDate: "" },
        conflict: false,
        uncertain: false,
        actionError: "",
      };
    });
  },
  input: a.input,
  date(e) {
    if (
      !this.data.busy &&
      ["startDate", "endDate"].includes(e.currentTarget.dataset.field)
    )
      this.setData({
        ["form." + e.currentTarget.dataset.field]: e.detail.value,
      });
  },
  reload() {
    a.reload(this);
  },
  save() {
    const f = this.data.form;
    if (!f.name.trim() || !f.startDate || !f.endDate) {
      this.setData({ actionError: "请填写名称和完整起止日期" });
      return;
    }
    if (f.startDate > f.endDate) {
      this.setData({ actionError: "结束日期不能早于开始日期" });
      return;
    }
    const payload = { ...f, name: f.name.trim() };
    if (this.id) payload.revision = this.data.revision;
    return a.act(
      this,
      () =>
        !this.id ? a.createRequest(this, "/seasons", payload) : a.s.api.request(
          this.id ? "/seasons/" + encodeURIComponent(this.id) : "/seasons",
          this.id ? "PUT" : "POST",
          payload,
        ),
      (s) => {
        this.id = s.id;
        this.setData({ id: s.id, revision: s.revision });
        wx.setNavigationBarTitle?.({ title: "编辑赛季" });
        ui.showToast(this,{ title: "赛季已保存" });
      },
      !this.id,
    );
  },
  openRoster() {
    if (this.data.busy || !this.id) return;
    wx.navigateTo({url: '/pages/season-roster/index?id=' + encodeURIComponent(this.id)});
  },
  backToList() {
    wx.redirectTo({ url: "/pages/manage-seasons/index" });
  },
});
