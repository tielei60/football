const ui=require('../../utils/ui');
let pendingCreate = null;
const s = require("../shared");
const location = require("../../utils/location");
Page({onHide(){ui.abort(this);},
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
    return s.load(this, async (session) => {
      if (session.user.role !== "admin")
        throw new Error("仅管理员可以管理球场");
      this._ownerToken = s.api.getSession()?.token;
      if (pendingCreate && pendingCreate.token !== this._ownerToken)
        pendingCreate = null;
      const draft = !this.id && pendingCreate ? pendingCreate.form : null;
      const v = this.id
        ? await s.api.request("/venues/" + encodeURIComponent(this.id))
        : draft || this.data.form;
      return {
        revision: v.revision ?? null,
        conflict: false,
        uncertain: !!draft,
        actionError: draft ? "上次添加结果未确认，请先返回球场列表核对。" : "",
        form: {
          name: v.name,
          address: v.address,
          latitude: v.latitude,
          longitude: v.longitude,
          coordinateSystem: "gcj02",
          status: v.status,
        },
        markers: location.point(v)
          ? [
              {
                id: 1,
                latitude: v.latitude,
                longitude: v.longitude,
                title: v.name,
              },
            ]
          : [],
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
    if (this.data.busy) return;
    this.setData({ busy: true, actionError: "" });
    try {
      const v = await location.choose();
      if (v && !this._disposed)
        this.setData({
          form: { ...this.data.form, ...v, name:v.name||this.data.form.name },
          actionError:v.name?'':'微信未返回地点名称，请核对地址并填写球场名称。',
          markers: [
            {
              id: 1,
              latitude: v.latitude,
              longitude: v.longitude,
              title: v.name,
            },
          ],
        });
    } catch (e) {
      if (!this._disposed) this.setData({ actionError: e.message });
    } finally {
      if (!this._disposed) this.setData({ busy: false });
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
          if(pendingCreate?.inFlight){this.setData({actionError:'上次请求仍在处理中，请稍后核对列表。'});return;}
          pendingCreate = null;
          this.setData({ uncertain: false, actionError: "" });
        }
      },
    });
  },
  async save() {
    if (this.data.busy || this.data.conflict || this.data.uncertain) return;
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
    this.setData({ busy: true, actionError: "" });
    const attempt = !this.id ? {token:this._ownerToken,form:{...this.data.form},inFlight:true} : null;
    if(attempt)pendingCreate=attempt;
    try {
      const payload = { ...this.data.form, name: this.data.form.name.trim() };
      if (this.id) payload.revision = this.data.revision;
      await s.api.request(
        this.id ? "/venues/" + encodeURIComponent(this.id) : "/venues",
        this.id ? "PUT" : "POST",
        payload,
      );
      if (attempt && pendingCreate===attempt) pendingCreate = null;
      if (!this._disposed) {
        ui.showToast(this,{ title: "球场已保存", icon: "success" });
        wx.navigateBack();
      }
    } catch (e) {
      const uncertain = !this.id && (!e.status || e.status >= 500);
      if(!uncertain && attempt && pendingCreate===attempt)pendingCreate=null;
      if (!this._disposed) {
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
      }
    } finally {
      if(attempt)attempt.inFlight=false;
      if (!this._disposed) this.setData({ busy: false });
    }
  },
});
