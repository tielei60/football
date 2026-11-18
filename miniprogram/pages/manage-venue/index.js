const ui=require('../../utils/ui');
let pendingCreate = null;
const s = require("../shared");
const location = require("../../utils/location");
// 页面隐藏不等于卸载：地图返回需要接收结果，但旧页面不能触发导航。
function current(page, operation) {
  return !page._disposed && page._venueOperation === operation &&
    (operation.owner === s.api.getSession()?.token ||
      (operation.expired && !s.api.getSession()?.token));
}
function complete(page, operation, apply) {
  if (!current(page, operation)) return;
  if (page._hidden) page._venueReceipt = { operation, apply };
  else {
    page._venueOperation = null;
    page.setData({ busy: false });
    apply();
  }
}
Page({
  onHide(){ this._hidden = true; ui.abort(this); },
  onShow(){
    this._hidden = false;
    if (this._ownerToken && this._ownerToken !== s.api.getSession()?.token &&
        !(this._venueReceipt?.operation.expired && !s.api.getSession()?.token)) {
      this._venueOperation = null;
      this._venueReceipt = null;
      this.setData({ busy:false, conflict:true, error:"登录状态已变化，请返回列表重新打开球场。" });
      return;
    }
    const receipt = this._venueReceipt;
    this._venueReceipt = null;
    if (receipt) complete(this, receipt.operation, receipt.apply);
  },
  data: {
    loading: true,
    error: "",
    busy: false,
    actionError: "",
    conflict: false,
    uncertain: false,
    editing: false,
    revision: null,
    form: {
      name: "",
      fieldNumber: "",
      address: "",
      latitude: null,
      longitude: null,
      coordinateSystem: "gcj02",
      status: "active",
    },
    markers: [],
  },
  onLoad(q) {
    this.id = q.id;
    this.setData({ editing: !!q.id });
    this.refresh();
  },
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  refresh() {
    if (this.data.busy) return;
    return s.load(this, async (session) => {
      if (session.user.role !== "admin")
        throw new Error("仅管理员可以管理球场");
      this._ownerToken = s.api.getSession()?.token;
      if (pendingCreate && pendingCreate.token !== this._ownerToken)
        pendingCreate = null;
      const receipt = pendingCreate;
      const known = !this.id && receipt?.result;
      if (known?.id) {
        this.id = known.id;
      }
      const draft = !this.id && pendingCreate ? pendingCreate.form : null;
      const v = this.id
        ? await s.api.request("/venues/" + encodeURIComponent(this.id))
        : draft || this.data.form;
      if (known?.id && pendingCreate === receipt) pendingCreate = null;
      return {
        editing: !!this.id,
        revision: v.revision ?? null,
        conflict: false,
        uncertain: !!draft,
        actionError: draft ? "上次添加结果未确认，请先返回球场列表核对。" : "",
        form: {
          name: v.name,
          fieldNumber: v.fieldNumber || "",
          address: v.address,
          latitude: v.latitude,
          longitude: v.longitude,
          coordinateSystem: "gcj02",
          status: v.status,
        },
        markers: location.markers(v),
      };
    });
  },
  input(e) {
    if (!this.data.busy)
      this.setData({
        ["form." + e.currentTarget.dataset.field]: e.detail.value,
      });
  },
  status(e) {
    if (!this.data.busy)
      this.setData({ "form.status": e.detail.value ? "active" : "inactive" });
  },
  async choose() {
    if (this.data.busy || this._disposed || this._hidden) return;
    const operation = this._venueOperation = { owner: s.api.getSession()?.token };
    this.setData({ busy: true, actionError: "" });
    try {
      const v = await location.choose();
      complete(this, operation, () => { if (v) this.setData({
          form: { ...this.data.form, ...v, name:v.name||this.data.form.name },
          actionError:v.name?'':'微信未返回地点名称，请核对地址并填写球场名称。',
          markers: location.markers(v),
        }); });
    } catch (e) {
      complete(this, operation, () => this.setData({ actionError: e.message }));
    }
  },
  clear() {
    if (!this.data.busy)
      this.setData({
        "form.latitude": null,
        "form.longitude": null,
        markers: [],
      });
  },
  async open() {
    try {
      await location.open(this.data.form);
    } catch (e) {
      if (!this._disposed) this.setData({ actionError: e.message });
    }
  },
  checkList() {
    wx.navigateBack();
  },
  confirmAbsent() {
    ui.showModal(this,{
      title: "确认未创建球场",
      content: "请先核对球场列表。仅在确认没有上次添加的球场后继续，避免重复。",
      success: (r) => {
        if (
          r.confirm &&
          !this._disposed &&
          this._ownerToken === s.api.getSession()?.token
        ) {
          if(pendingCreate?.result?.id){this.refresh();return;}
          if(pendingCreate?.inFlight){this.setData({actionError:'上次请求仍在处理中，请稍后核对列表。'});return;}
          pendingCreate = null;
          this.setData({ uncertain: false, actionError: "" });
        }
      },
    });
  },
  async save() {
    if (this.data.busy || this.data.conflict || this.data.uncertain) return;
    if (this._disposed || this._hidden) return;
    if (!this._ownerToken || this._ownerToken !== s.api.getSession()?.token) {
      this.setData({
        conflict: true,
        actionError: "登录状态已变化，请返回列表重新打开球场。",
      });
      return;
    }
    if (!this.data.form.name.trim()) {
      this.setData({ actionError: "请填写球场名称" });
      return;
    }
    const operation = this._venueOperation = { owner: this._ownerToken };
    const creating = !this.id;
    this.setData({ busy: true, actionError: "" });
    const attempt = !this.id ? {token:this._ownerToken,form:{...this.data.form},inFlight:true} : null;
    if(attempt)pendingCreate=attempt;
    try {
      const payload = { ...this.data.form, name: this.data.form.name.trim() };
      if (this.id) payload.revision = this.data.revision;
      const result = await s.api.request(
        this.id ? "/venues/" + encodeURIComponent(this.id) : "/venues",
        this.id ? "PUT" : "POST",
        payload,
      );
      // 已成功的新建保留回执，旧页面卸载后重新进入也不能再次 POST。
      if (attempt && pendingCreate === attempt) attempt.result = result;
      complete(this, operation, () => {
        if (creating && !result?.id) {
          this.setData({ uncertain:true, actionError:"保存结果未确认，请返回球场列表核对，不要重复添加。" });
          return;
        }
        if (result?.id) this.id = result.id;
        this.setData({ editing:!!this.id, revision:result?.revision ?? this.data.revision });
        if (attempt && pendingCreate === attempt) pendingCreate = null;
        ui.showToast(this,{ title: "球场已保存", icon: "success" });
        wx.navigateBack();
      });
    } catch (e) {
      operation.expired = e.status === 401 && !e.staleSession && !s.api.getSession()?.token;
      const uncertain = creating && (!e.status || e.status >= 500);
      if(!uncertain && attempt && pendingCreate===attempt)pendingCreate=null;
      complete(this, operation, () => {
        this.setData({
          conflict: e.status === 409,
          uncertain,
          actionError: uncertain
            ? "保存结果未确认，请返回球场列表核对，不要重复添加。"
            : e.status === 409
              ? "球场已被其他人修改，输入已保留，请返回列表核对。"
              : e.message,
        });
        if (e.status === 401) s.fail(this, e);
      });
    } finally {
      if(attempt)attempt.inFlight=false;
    }
  },
});
