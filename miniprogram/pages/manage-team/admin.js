const ui=require('../../utils/ui');
const s = require("../shared");
function admin(session) {
  if (session.user.role !== "admin") throw new Error("仅管理员可操作");
}
function load(page, work) {
  let owner;
  page.setData({ authorized: false });
  const pending = s.load(page, async (session) => {
    admin(session);
    owner = s.api.getSession()?.token;
    return { ...(await work(session)), ...restoreCreate(page), authorized: true };
  });
  const epoch = page._epoch;
  return pending.then(() => {
    if (!page._disposed && page._epoch === epoch && !page.data.error)
      page._ownerToken = owner;
  });
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
  const epoch = page._epoch;
  page._imageEpoch = (page._imageEpoch || 0) + 1;
  let dispatched = false;
  page.setData({ busy: true, actionError: "" });
  try {
    admin(await s.api.ensureSession());
    if (page._ownerToken !== s.api.getSession()?.token)
      throw new Error("登录已变化，请重新载入后再操作");
    if (page._disposed || epoch !== page._epoch) return;
    dispatched = true;
    const result = await work();
    if (!page._disposed && epoch === page._epoch) await done(result);
  } catch (e) {
    if (!page._disposed && epoch === page._epoch) {
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
    if (!page._disposed && epoch === page._epoch) page.setData({ busy: false });
  }
}
function choosePicture(page, field) {
  if (page.data.busy) return;
  const imageEpoch = page._imageEpoch = (page._imageEpoch || 0) + 1;
  const epoch = page._epoch;
  wx.chooseMedia({
    count: 1,
    mediaType: ["image"],
    sourceType: ["album"],
    success(result) {
      if (page._disposed || epoch !== page._epoch || imageEpoch !== page._imageEpoch) return;
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
          if (page._disposed || epoch !== page._epoch || imageEpoch !== page._imageEpoch) return;
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
          if (!page._disposed && epoch === page._epoch && imageEpoch === page._imageEpoch)
            page.setData({ actionError: "无法读取图片" });
        },
      });
    },
    fail(e) {
      if (
        !page._disposed &&
        epoch === page._epoch &&
        !String(e.errMsg).includes("cancel")
      )
        page.setData({ actionError: "无法选择图片，请检查相册权限" });
    },
  });
}
function unload() {
  this._imageEpoch = (this._imageEpoch || 0) + 1;
  this._imageData = undefined;
  s.unload.call(this);
}
module.exports = { s, load, input, reload, act, choosePicture, unload };

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
  page._imageData = entry.image;
  return { ...JSON.parse(JSON.stringify(entry.view)), uncertain: true,
    actionError: "创建结果待核对，请先查看列表；确认未创建后才能重新提交。" };
}
async function createRequest(page, path, payload) {
  const entries = ledger();
  if (entries.has(page.createKind)) throw Object.assign(new Error("请先核对创建结果"), { status: 503 });
  const view = { form: JSON.parse(JSON.stringify(page.data.form)) };
  if (page.createKind === "player") {
    Object.assign(view, { avatar: page.data.avatar, positionOptions: page.data.positionOptions,
      feet: page.data.feet, footIndex: page.data.footIndex });
  }
  const entry = { view: JSON.parse(JSON.stringify(view)), image: page._imageData, inFlight: true };
  const token = pendingOwner;
  entries.set(page.createKind, entry);
  try {
    const result = await s.api.request(path, "POST", payload);
    if (s.api.getSession()?.token === token && entries.get(page.createKind) === entry)
      entries.delete(page.createKind);
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
      ledger().delete(this.createKind);
      this.setData({ uncertain: false, actionError: "" });
    },
  });
}
module.exports.createRequest = createRequest;
module.exports.confirmNotCreated = confirmNotCreated;
