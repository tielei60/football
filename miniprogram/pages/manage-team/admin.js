const ui=require('../../utils/ui');
const s = require("../shared");
function admin(session) {
  if (session.user.role !== "admin") throw new Error("仅管理员可操作");
}
function token() { return s.api.getSession()?.token; }
function visible(page, epoch, turn) {
  return !page._disposed && !page._hidden && page._epoch === epoch && (page._adminView || 0) === turn;
}
async function load(page, work) {
  const owner = token(), turn = page._adminView || 0;
  const epoch = page._epoch = (page._epoch || 0) + 1;
  page._disposed = false;
  page._loadingOwner = owner;
  page.setData({ authorized: false, loading: true, error: "" });
  try {
    const session = await s.api.ensureSession();
    if (!visible(page, epoch, turn) || token() !== owner) return;
    admin(session);
    const result = await work(session);
    if (!visible(page, epoch, turn) || token() !== owner) return;
    s.safeSetData(page, { ...result, ...restoreCreate(page), authorized: true });
    page._ownerToken = owner;
    page._adminLoaded = true;
    page._adminRefresh = false;
  } catch (e) {
    if (visible(page, epoch, turn) && (token() === owner || ((e.status || e.statusCode) === 401 && !token()))) s.fail(page, e);
  } finally {
    if (visible(page, epoch, turn) && (token() === owner || !token())) page.setData({ loading: false });
    wx.stopPullDownRefresh();
  }
}
function hide() {
  ui.abort(this);
  this._hidden = true;
  this._adminView = (this._adminView || 0) + 1;
  if (this.data.loading) this._adminRefresh = true;
}
async function show(always = false) {
  this._hidden = false;
  const changed = (this._adminLoaded ? this._ownerToken : this._loadingOwner) !== token();
  if (changed) {
    this._adminReceipt = null;
    this._imageEpoch = (this._imageEpoch || 0) + 1;
    this._imageData = undefined;
    this.setData({ authorized: false, loading: true });
  }
  const receipt = this._adminReceipt;
  if (receipt && !changed && receipt.owner === token()) {
    this._adminReceipt = null;
    this._adminRefresh = false;
    await receipt.done(receipt.result);
    acknowledgeCreate(this, receipt.result);
  }
  if (always || changed || this._adminRefresh) {
    if (this.data.busy) { this._adminRefresh = true; return; }
    return this.refresh();
  }
}
function input(e) {
  if (this.data.busy) return;
  const key = e.currentTarget.dataset.field;
  if (Object.prototype.hasOwnProperty.call(this.data.form, key))
    this.setData({ ["form." + key]: e.detail.value });
}
function reload(page) {
  if (page.data.busy) return;
  ui.showModal(page,{
    title: "重新载入",
    content: "未保存修改将丢弃，是否继续？",
    success: (r) => {
      if (r.confirm && !page._disposed) page.refresh();
    },
  });
}
async function act(page, work, done, creating = false) {
  if (
    page.data.busy ||
    page.data.conflict ||
    page.data.uncertain ||
    !page.data.authorized
  )
    return;
  const epoch = page._epoch, owner = token(), turn = page._adminView || 0;
  const attempt = page._adminAttempt = {};
  page._imageEpoch = (page._imageEpoch || 0) + 1;
  let dispatched = false;
  page.setData({ busy: true, actionError: "" });
  try {
    admin(await s.api.ensureSession());
    if (page._ownerToken !== s.api.getSession()?.token)
      throw new Error("登录已变化，请重新载入后再操作");
    if (!visible(page, epoch, turn) || token() !== owner) return;
    dispatched = true;
    const result = await work();
    if (visible(page, epoch, turn) && token() === owner) {
      await done(result);
      acknowledgeCreate(page, result);
    }
    else if (!page._disposed && token() === owner && page._epoch === epoch) {
      page._adminReceipt = { owner, done, result };
      if (!page._hidden) await show.call(page);
    }
  } catch (e) {
    if (!page._disposed && token() === owner && dispatched) page._adminRefresh = true;
    if (!e.staleSession && visible(page, epoch, turn) && (token() === owner || ((e.status || e.statusCode) === 401 && !token()))) {
      const code = e.status || e.statusCode || 0;
      const uncertain = !!e.createGuardPending || (dispatched && creating && !e.createNotDispatched && (e.staleSession === true || code === 0 || code >= 500));
      page.setData({
        conflict: code === 409,
        uncertain,
        actionError: uncertain
          ? "结果未确认，请先到列表核对，勿重复新建。"
          : code === 409
            ? (page.createKind === "season" && e.message === "新的赛季日期范围会排除已归属比赛，请先调整比赛归属或日期。"
              ? e.message + " 输入已保留，请重新载入核对。"
              : "记录已变化，输入已保留。请重新载入核对。")
            : e.message || "操作失败",
      });
      if (code === 401) s.fail(page, e);
    }
  } finally {
    if (!page._disposed && page._adminAttempt === attempt) {
      page.setData({ busy: false });
      if (!page._hidden && page._adminRefresh && !visible(page, epoch, turn)) page.refresh();
    }
  }
}
function choosePicture(page, field) {
  if (page.data.busy) return;
  const imageEpoch = page._imageEpoch = (page._imageEpoch || 0) + 1;
  const epoch = page._epoch, owner = token();
  const current = () => !page._disposed && epoch === page._epoch && imageEpoch === page._imageEpoch && token() === owner;
  wx.chooseMedia({
    count: 1,
    mediaType: ["image"],
    sourceType: ["album"],
    success(result) {
      if (!current()) return;
      const file = result.tempFiles?.[0];
      if (!file) return;
      if (file.size > 2097152) {
        page.setData({ actionError: "图片不能超过 2 MB" });
        return;
      }
      wx.getFileSystemManager().readFile({
        filePath: file.tempFilePath,
        encoding: "base64",
        success(res) {
          if (!current()) return;
          const bytes = res.data;
          const mime = bytes.startsWith("iVBORw0KGgo")
            ? "png"
            : bytes.startsWith("/9j/")
              ? "jpeg"
              : null;
          if (!mime || Math.floor((bytes.length * 3) / 4) > 2097152) {
            page.setData({ actionError: "请选择 2 MB 内的 PNG 或 JPG" });
            return;
          }
          page._imageData = "data:image/" + mime + ";base64," + bytes;
          page.setData({ [field]: file.tempFilePath, actionError: "" });
        },
        fail() {
          if (current())
            page.setData({ actionError: "无法读取图片" });
        },
      });
    },
    fail(e) {
      if (
        current() &&
        !String(e.errMsg).includes("cancel")
      )
        page.setData({ actionError: "无法选择图片，请检查相册权限" });
    },
  });
}
function unload() {
  this._adminReceipt = null;
  this._imageEpoch = (this._imageEpoch || 0) + 1;
  this._imageData = undefined;
  s.unload.call(this);
}
module.exports = { s, load, input, reload, act, choosePicture, unload, hide, show };

// 表单和照片仅内存保留；跨运行只存无个人资料的核对标识。
function createGuardKey(kind) {
  const session=s.api.getSession();
  if(!['player','season'].includes(kind)||!session?.serverOrigin||!Number.isSafeInteger(session?.user?.id)||!Number.isSafeInteger(session?.team?.id))throw new Error('无法确认创建账号，请重新登录。');
  return 'football.native.admin-create-guard.v1:'+encodeURIComponent(session.serverOrigin)+':'+session.user.id+':'+session.team.id+':'+kind;
}
function readCreateGuard(key) {
  const value=wx.getStorageSync(key);if(!value)return null;
  if(typeof value!=='object'||typeof value.taskId!=='string'||!value.taskId)throw new Error('创建核对记录无法读取，请检查本地存储。');
  return value;
}
function clearCreateGuard(key,taskId) {
  if(readCreateGuard(key)?.taskId===taskId){wx.removeStorageSync(key);if(readCreateGuard(key))throw new Error('无法清除创建核对提醒，请重新打开核对。');}
}
function validCreatedId(kind,id){return kind==='season'?Number.isSafeInteger(id)&&id>0:typeof id==='string'&&id.trim().length>0;}
// 同一登录可恢复私有草稿，但草稿绝不持久化。
let pendingOwner;
const pendingCreates = new Map();
function ledger() {
  const token = s.api.getSession()?.token;
  if (token !== pendingOwner) {
    pendingCreates.clear();
    pendingOwner = token;
  }
  return pendingCreates;
}
function restoreCreate(page) {
  if(page.id||!page.createKind)return {};
  const guard=readCreateGuard(createGuardKey(page.createKind));
  const entry = ledger().get(page.createKind);
  if(!entry)return guard?{uncertain:true,actionError:'上次创建结果待核对，请先到列表检查，勿重复新建。'}:{};
  if (entry.result) {
    page.id = entry.result.id;
    page._imageData = undefined;
    ledger().delete(page.createKind);
    return { ...JSON.parse(JSON.stringify(entry.view)), id: entry.result.id,
      revision: entry.result.revision, uncertain: false, conflict: false,
      actionError: "创建已成功，已恢复记录；继续编辑前可重新载入核对。" };
  }
  page._imageData = entry.image;
  return { ...JSON.parse(JSON.stringify(entry.view)), uncertain: true,
    actionError: "创建结果待核对，请先查看列表；确认未创建后才能重新提交。" };
}
function acknowledgeCreate(page, result) {
  const entries = ledger(), entry = entries.get(page.createKind);
  if (entry?.result && entry.result.id === result?.id) entries.delete(page.createKind);
}
async function createRequest(page, path, payload) {
  const entries = ledger();
  if (entries.has(page.createKind)) throw Object.assign(new Error("请先核对创建结果"), { status: 503 });
  let entry;
  const token = pendingOwner;
  let dispatched=false;
  try {
  const view = { form: JSON.parse(JSON.stringify(page.data.form)) };
  if (page.createKind === "player") {
    Object.assign(view, { status: page.data.status, membershipConfirmed: page.data.membershipConfirmed,
      membershipIndex: page.data.membershipIndex, initial: page.data.initial, avatar: page.data.avatar, positionOptions: page.data.positionOptions,
      feet: page.data.feet, footIndex: page.data.footIndex });
  }
  entry = { view: JSON.parse(JSON.stringify(view)), image: page._imageData, inFlight: true };
    entry.guardKey=createGuardKey(page.createKind);
    if(readCreateGuard(entry.guardKey))throw Object.assign(new Error('上次创建结果待核对，请先到列表检查。'),{status:503,createGuardPending:true});
    entry.taskId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    wx.setStorageSync(entry.guardKey,{taskId:entry.taskId,createdAt:Date.now()});
    if(readCreateGuard(entry.guardKey)?.taskId!==entry.taskId)throw new Error('无法保存创建核对记录，未发起创建。');
    entries.set(page.createKind, entry);
    dispatched=true;
    const result = await s.api.request(path, "POST", payload);
    if(!validCreatedId(page.createKind,result?.id))throw new Error('创建响应编号异常，请先到列表核对。');
    clearCreateGuard(entry.guardKey,entry.taskId);
    if (s.api.getSession()?.token === token && entries.get(page.createKind) === entry)
      entry.result = { id: result.id, revision: result.revision };
    return result;
  } catch (e) {
    const code = e.status || e.statusCode || 0;
    if(!dispatched)e.createNotDispatched=true;
    if(dispatched&&code>=400&&code<500&&!e.staleSession){
      try{clearCreateGuard(entry.guardKey,entry.taskId);if(entries.get(page.createKind)===entry)entries.delete(page.createKind);}
      catch(storageError){throw storageError;}
    }
    throw e;
  } finally {
    if(entry)entry.inFlight = false;
  }
}
function confirmNotCreated(){return confirmCreateRecovery.call(this,false);}
function confirmCreated(){return confirmCreateRecovery.call(this,true);}
function confirmCreateRecovery(exists) {
  if(this.data.busy||!this.data.uncertain||this.id||this.data.id||this._hidden||this._disposed||!this.data.authorized)return;
  const owner=token();if(owner!==this._ownerToken)return;
  const entry=ledger().get(this.createKind);
  if(entry?.result)return this.refresh();
  if(entry?.inFlight){ui.showToast(this,{title:'请求仍在处理中',icon:'none'});return;}
  let key,guard;
  try{key=createGuardKey(this.createKind);guard=readCreateGuard(key);}catch(e){this.setData({actionError:e.message});return;}
  ui.showModal(this,{
    title:exists?'确认记录已存在':'确认列表中未创建',
    content:exists?'确认已在列表找到上次创建的记录？仅解除提醒，不会创建、修改或删除记录。':'请先到列表检查。仅确认不存在时继续，避免重复创建。',
    confirmText:exists?'已核对存在':'确认不存在',
    success:r=>{
      if(!r.confirm||this._disposed||this._hidden||this.data.busy||this.id||this.data.id||!this.data.uncertain||!this.data.authorized||owner!==token()||owner!==this._ownerToken)return;
      const current=ledger().get(this.createKind);
      if(current!==entry||current?.inFlight||current?.result)return;
      try{
        if(key!==createGuardKey(this.createKind)||readCreateGuard(key)?.taskId!==guard?.taskId)throw new Error('核对任务已变化，请重新打开核对。');
        if(guard)clearCreateGuard(key,guard.taskId);
        ledger().delete(this.createKind);this.setData({uncertain:false,actionError:''});
        if(exists)this.backToList();
      }catch(e){this.setData({actionError:e.message});}
    }
  });
}
module.exports.confirmCreated=confirmCreated;
module.exports.createRequest = createRequest;
module.exports.confirmNotCreated = confirmNotCreated;
