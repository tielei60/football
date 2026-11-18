const ui=require('../../utils/ui');
let pendingCreate = null;
// 仅持久化核对标识，不保存名称、地址、坐标或登录令牌。
function venueGuardKey() {
  const session=s.api.getSession(),origin=session?.serverOrigin;
  if(!origin||!Number.isSafeInteger(session?.user?.id)||!Number.isSafeInteger(session?.team?.id))throw new Error('无法确认球场管理账号，请重新登录。');
  return 'football.native.venue-create-guard.v1:'+encodeURIComponent(origin)+':'+session.user.id+':'+session.team.id;
}
function readVenueGuard(key) {
  const value=wx.getStorageSync(key);
  if(!value)return null;
  if(typeof value!=='object'||typeof value.taskId!=='string'||!value.taskId)throw new Error('球场核对记录无法读取，请先检查本地存储。');
  return value;
}
function clearVenueGuard(key,taskId) {
  if(readVenueGuard(key)?.taskId===taskId){wx.removeStorageSync(key);if(readVenueGuard(key))throw new Error('无法清除球场核对提醒，请重新打开核对。');}
}
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
      this._guardKey=venueGuardKey();
      const guard=!this.id?readVenueGuard(this._guardKey):null;
      const draft = !this.id && pendingCreate ? pendingCreate.form : null;
      const v = this.id
        ? await s.api.request("/venues/" + encodeURIComponent(this.id))
        : draft || this.data.form;
      if (known?.id && pendingCreate === receipt) pendingCreate = null;
      return {
        editing: !!this.id,
        revision: v.revision ?? null,
        conflict: false,
        uncertain: !!draft || !!guard,
        actionError: draft || guard ? "上次添加结果未确认，请先返回球场列表核对。" : "",
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
  confirmAbsent() { this.confirmRecovery(false); },
  confirmExists() { this.confirmRecovery(true); },
  confirmRecovery(exists) {
    if(this.data.busy||this._disposed||this._hidden)return;
    let key,guard;
    try{key=venueGuardKey();guard=readVenueGuard(key);}catch(e){this.setData({actionError:e.message});return;}
    ui.showModal(this,{
      title: exists ? "确认球场已存在" : "确认未创建球场",
      content: exists ? "确认已在列表找到上次添加的球场？仅解除核对提醒，不会创建、删除或修改球场。" : "请先核对球场列表。仅在确认没有上次添加的球场后继续，避免重复。",
      success: (r) => {
        if (
          r.confirm &&
          !this._disposed && !this._hidden &&
          this._ownerToken === s.api.getSession()?.token
        ) {
          if(pendingCreate?.inFlight){this.setData({actionError:'上次请求仍在处理中，请稍后核对列表。'});return;}
          if(pendingCreate?.result?.id&&!exists){this.refresh();return;}
          try {
            if(key!==venueGuardKey()||key!==this._guardKey)throw new Error('登录状态已变化，请重新打开球场。');
            if(readVenueGuard(key)?.taskId!==guard?.taskId)throw new Error('核对任务已变化，请重新打开球场核对。');
            if(guard)clearVenueGuard(key,guard.taskId);
            pendingCreate = null;
            this.setData({ uncertain: false, actionError: "" });
            if(exists){wx.navigateBack();}
          } catch(e){this.setData({actionError:e.message});}
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
    let dispatched=false;
    try {
      if(attempt){
        const key=venueGuardKey();this._guardKey=key;
        if(readVenueGuard(key)){this.setData({uncertain:true,actionError:'上次添加结果未确认，请先返回球场列表核对。'});return;}
        const taskId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
        wx.setStorageSync(key,{taskId,createdAt:Date.now()});
        if(readVenueGuard(key)?.taskId!==taskId)throw new Error('无法保存球场核对记录，未发起添加。');
        attempt.guardKey=key;attempt.taskId=taskId;pendingCreate=attempt;
      }
      const payload = { ...this.data.form, name: this.data.form.name.trim() };
      if (this.id) payload.revision = this.data.revision;
      dispatched=true;
      const result = await s.api.request(
        this.id ? "/venues/" + encodeURIComponent(this.id) : "/venues",
        this.id ? "PUT" : "POST",
        payload,
      );
      if(attempt&&result?.id)clearVenueGuard(attempt.guardKey,attempt.taskId);
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
      const code=e.status||e.statusCode;
      let uncertain = creating && dispatched && (e.staleSession === true || !code || code >= 500);
      if(attempt&&dispatched&&!uncertain){
        try{clearVenueGuard(attempt.guardKey,attempt.taskId);}catch(_){uncertain=true;}
      }
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
      if(current(this,operation)&&!this._venueReceipt)this.setData({busy:false});
    }
  },
});
