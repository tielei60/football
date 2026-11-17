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
    if (visible(page, epoch, turn) && (token() === owner || ((e.status || e.statusCode) === 401 && !token()))) {
      const code = e.status || e.statusCode || 0;
      const uncertain = dispatched && creating && (code === 0 || code >= 500);
      page.setData({
        conflict: code === 409,
        uncertain,
        actionError: uncertain
          ? "结果未确认，请先到列表核对，勿重复新建。"
          : code === 409
            ? "记录已变化，输入已保留。请重新载入核对。"
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

// Session-only ledger: never persisted or passed to setData.
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
  const entry = ledger().get(page.createKind);
  if (page.id || !entry) return {};
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
  const view = { form: JSON.parse(JSON.stringify(page.data.form)) };
  if (page.createKind === "player") {
    Object.assign(view, { status: page.data.status, membershipConfirmed: page.data.membershipConfirmed,
      membershipIndex: page.data.membershipIndex, initial: page.data.initial, avatar: page.data.avatar, positionOptions: page.data.positionOptions,
      feet: page.data.feet, footIndex: page.data.footIndex });
  }
  const entry = { view: JSON.parse(JSON.stringify(view)), image: page._imageData, inFlight: true };
  const token = pendingOwner;
  entries.set(page.createKind, entry);
  try {
    const result = await s.api.request(path, "POST", payload);
    if (s.api.getSession()?.token === token && entries.get(page.createKind) === entry)
      entry.result = { id: result.id, revision: result.revision };
    return result;
  } catch (e) {
    const code = e.status || e.statusCode || 0;
    if (code >= 400 && code < 500 && s.api.getSession()?.token === token &&
        entries.get(page.createKind) === entry) entries.delete(page.createKind);
    throw e;
  } finally {
    entry.inFlight = false;
  }
}
function confirmNotCreated() {
  if (this.data.busy || !this.data.uncertain || this.id) return;
  if (ledger().get(this.createKind)?.result) { return this.refresh(); }
  if (ledger().get(this.createKind)?.inFlight) {
    ui.showToast(this,{ title: "请求仍在处理中", icon: "none" });
    return;
  }
  const token = s.api.getSession()?.token;
  ui.showModal(this,{
    title: "确认列表中未创建",
    content: "请先到列表检查刚才提交的记录。只有确认不存在，才继续重新提交；否则可能产生重复记录。",
    confirmText: "确认不存在",
    success: (r) => {
      if (!r.confirm || this._disposed || token !== s.api.getSession()?.token) return;
      if (ledger().get(this.createKind)?.result) { this.refresh(); return; }
      if (ledger().get(this.createKind)?.inFlight) return;
      ledger().delete(this.createKind);
      this.setData({ uncertain: false, actionError: "" });
    },
  });
}
module.exports.createRequest = createRequest;
module.exports.confirmNotCreated = confirmNotCreated;
