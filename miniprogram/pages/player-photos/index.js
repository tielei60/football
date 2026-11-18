const { mergeText, replacementMessage } = require("../../utils/text-draft");
const ui = require("../../utils/ui");
const s = require("../shared");
const photoCache = require("../../utils/player-photo-cache");
const pendingByPlayer = new Map();
let pendingOwner;
function owned(id) {
  const token = s.api.getSession()?.token;
  if (pendingOwner !== token) {
    pendingByPlayer.clear();
    pendingOwner = token;
  }
  return pendingByPlayer.get(id) || null;
}
function drop(p) {
  if (pendingByPlayer.get(p.playerId) === p) pendingByPlayer.delete(p.playerId);
}
function key() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16);
    return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
}
function guardKey(id) {
  const x = s.api.getSession();
  if (!x?.token || !x.user?.id || !x.team?.id)
    throw new Error("登录信息不完整，请重新登录");
  return (
    "football.player-photo.pending:" +
    encodeURIComponent(x.serverOrigin || require("../../config").apiBaseUrl) +
    ":" +
    x.user.id +
    ":" +
    x.team.id +
    ":" +
    encodeURIComponent(id)
  );
}
function receipt(k) {
  return wx.getStorageSync(k) || null;
}
function record(k, id) {
  wx.setStorageSync(k, { requestId: id });
  if (receipt(k)?.requestId !== id)
    throw new Error("无法保存上传核对记录，未发起上传");
}
function clear(k, id) {
  if (receipt(k)?.requestId === id) wx.removeStorageSync(k);
}
Page({
  openAi() {
    if (
      !this.data.admin ||
      this._hidden ||
      this._disposed ||
      this.data.busy ||
      this.data.loading
    )
      return;
    // AI 页可改变相册与封面；返回后重读元数据，并沿用同账号草稿保留逻辑。
    this._needsRefresh = true;
    wx.navigateTo({
      url: "/pages/player-ai/index?id=" + encodeURIComponent(this.id),
    });
  },
  data: {
    loading: true,
    error: "",
    admin: false,
    busy: false,
    conflict: false,
    actionError: "",
    playerName: "",
    playerNumber: "",
    photos: [],
    coverPhotoId: null,
    preview: "",
    caption: "",
    uncertain: false,
    recoveryBlocked: false,
  },
  releasePictures() {
    if (this._photoScope) photoCache.dispose(this._photoScope);
    this._photoScope = null;
    this._cachedPaths = new Map();
    this._cacheOwner = null;
  },
  cachePicture(key, data) {
    const token = s.api.getSession()?.token;
    if (this._disposed || !token || token !== this._owner) return "";
    if (this._cacheOwner !== token) {
      this.releasePictures();
      this._cacheOwner = token;
      this._photoScope = photoCache.createScope();
    }
    const path = photoCache.put(this._photoScope, key, data);
    if (path) this._cachedPaths.set(key, path);
    return path;
  },
  releasePicture(key) {
    if (this._photoScope) photoCache.remove(this._photoScope, key);
    this._cachedPaths?.delete(key);
  },
  onLoad(q) {
    this.id = q.id;
  },
  onHide() {
    ui.abort(this);
    this._showTurn = (this._showTurn || 0) + 1;
    this._picturesTurn = (this._picturesTurn || 0) + 1;
    this._hidden = true;
    this.setData({ loading: true });
  },
  async onShow() {
    this._hidden = false;
    const showTurn = (this._showTurn = (this._showTurn || 0) + 1),
      token = s.api.getSession()?.token;
    if (!this._loaded) return this.refresh();
    const epoch = this._epoch;
    try {
      const session = await s.api.ensureSession();
      if (
        this._disposed ||
        this._hidden ||
        epoch !== this._epoch ||
        showTurn !== this._showTurn
      )
        return;
      owned(this.id);
      if (this._owner !== s.api.getSession()?.token) {
        this.releasePictures();
        this._image = null;
        this.setData({
          photos: [],
          playerName: "",
          playerNumber: "",
          preview: "",
          caption: "",
          loading: false,
          error: "登录已变化，请重新打开照片集。",
        });
        return;
      }
      const admin = session.user.role === "admin";
      if (admin !== this.data.admin) {
        this._imageEpoch = (this._imageEpoch || 0) + 1;
        this._roleRefreshPending = true;
        this.setData({ admin });
      }
      if (this._roleRefreshPending) {
        // 先撤掉管理入口；已发起的请求结束后再重读，避免覆盖上传回执。
        if (this.data.busy) {
          this.setData({ loading: false });
          return;
        }
        return this.refresh();
      }
      if (this._needsRefresh) {
        this._needsRefresh = false;
        return this.refresh();
      }
      this.setData({ loading: false });
      this.loadPictures();
    } catch (e) {
      if (
        !this._disposed &&
        !this._hidden &&
        epoch === this._epoch &&
        showTurn === this._showTurn
      ) {
        const current = s.api.getSession();
        if (
          current?.token === token ||
          ((e.status || e.statusCode) === 401 && !current)
        ) {
          this.setData({ loading: false });
          s.fail(this, e);
        }
      }
    }
  },
  alertDraft() {
    const dirty =
      this.data.photos.some((p) => p.draft !== p.caption) ||
      !!this._image ||
      !!owned(this.id);
    if (dirty) {
      wx.enableAlertBeforeUnload?.({
        message: "有未保存内容或待确认上传，确定离开？",
      });
    } else wx.disableAlertBeforeUnload?.();
  },
  onUnload() {
    this.releasePictures();
    ui.abort(this);
    this._imageEpoch = (this._imageEpoch || 0) + 1;
    s.unload.call(this);
  },
  async refresh(preserve = true) {
    if (this.data.busy) return;
    this._roleRefreshPending = false;
    this._imageEpoch = (this._imageEpoch || 0) + 1;
    const token = s.api.getSession()?.token,
      showTurn = this._showTurn;
    const local =
      this._loaded && preserve && this._owner === token
        ? {
            preview: this.data.preview,
            caption: this.data.caption,
          }
        : null;
    const epoch = (this._epoch = (this._epoch || 0) + 1);
    this._disposed = false;
    const active = () =>
      !this._disposed &&
      !this._hidden &&
      epoch === this._epoch &&
      showTurn === this._showTurn;
    const ownedResponse = () => active() && token === s.api.getSession()?.token;
    this.setData({ loading: true, error: "" });
    try {
      const session = await s.api.ensureSession();
      if (!ownedResponse()) return;
      const list = await s.api.request("/players/" + this.id + "/photos");
      if (!ownedResponse()) return;
      if (!list.player || String(list.player.id) !== String(this.id))
        throw new Error("无法确认目标球员，请重新载入");
      const p = owned(this.id);
      if (local && this.data.uncertain && !p) {
        local.preview = "";
        local.caption = "";
        this._image = null;
      }
      this._guardKey = guardKey(this.id);
      const persisted = receipt(this._guardKey);
      if (this._cacheOwner !== token) this.releasePictures();
      this._owner = token;
      const live = new Set(list.photos.map((x) => "photo:" + x.id));
      if (p) live.add("pending:" + p.requestId);
      let clearedPendingPreview = false;
      for (const key of this._cachedPaths?.keys() || []) {
        if (!live.has(key)) {
          if (
            !p &&
            local &&
            key.startsWith("pending:") &&
            local.preview === this._cachedPaths.get(key)
          ) {
            local.preview = "";
            this._image = null;
            clearedPendingPreview = true;
          }
          this.releasePicture(key);
        }
      }
      s.safeSetData(this, {
        admin: session.user.role === "admin",
        playerName: String(list.player?.name || "球员"),
        playerNumber:
          list.player?.number == null
            ? "号码未设置"
            : String(list.player.number) + "号",
        photos: list.photos.map((x) => ({
          id: x.id,
          caption: x.caption || "",
          generated: x.generated === true,
          originLabel:
            x.simulation === true || x.originKind === "local-simulation"
              ? "模拟图"
              : x.aiGenerated === true
                ? "AI 生成"
                : "生成图",
          ...(() => {
            const old = local && this.data.photos.find((p) => p.id === x.id);
            const merged = old
              ? mergeText(
                  old.caption,
                  old.draft,
                  x.caption || "",
                  old.captionConflict,
                )
              : { value: x.caption || "", conflict: false };
            return { draft: merged.value, captionConflict: merged.conflict };
          })(),
          src: this._cachedPaths?.get("photo:" + x.id) || "",
          loading: !this._cachedPaths?.has("photo:" + x.id),
          imageError: "",
        })),
        coverPhotoId: list.coverPhotoId,
        conflict: false,
        actionError: clearedPendingPreview
          ? "上次图片预览已清理，请重新选择照片；说明已保留。"
          : "",
        preview: p
          ? this.cachePicture("pending:" + p.requestId, p.dataUrl)
          : local?.preview || "",
        caption: p?.caption ?? local?.caption ?? "",
        uncertain: !!p,
        recoveryBlocked: !!persisted && !p,
      });
      this._owner = token;
      this.revision = list.revision;
      this._loaded = true;
      if (p) this._image = p.dataUrl;
      else if (!local) this._image = null;
      if (this.data.photos.some((p) => p.captionConflict))
        this.setData({
          actionError:
            "部分说明已被修改，草稿已保留；保存前须确认替换最新文字。",
        });
      this.alertDraft();
    } catch (e) {
      if (active()) {
        const current = s.api.getSession();
        if (
          current?.token === token ||
          ((e.status || e.statusCode) === 401 && !current)
        )
          s.fail(this, e);
      }
    } finally {
      if (
        active() &&
        (token === s.api.getSession()?.token || !s.api.getSession())
      ) {
        this.setData({ loading: false });
        if (ownedResponse() && !this.data.error) this.loadPictures();
      }
      wx.stopPullDownRefresh();
    }
  },
  pictureCurrent(epoch, token, turn) {
    return (
      !this._disposed &&
      !this._hidden &&
      epoch === this._epoch &&
      token === this._owner &&
      token === s.api.getSession()?.token &&
      turn === this._picturesTurn
    );
  },
  async loadPictures(retryId) {
    if (
      this._disposed ||
      this._hidden ||
      this.data.loading ||
      this.data.error ||
      this._owner !== s.api.getSession()?.token
    )
      return;
    const epoch = this._epoch,
      token = this._owner,
      turn = (this._picturesTurn = (this._picturesTurn || 0) + 1);
    const photos = this.data.photos.filter(
      (p) => !p.src && (!p.imageError || p.id === retryId),
    );
    for (const photo of photos) {
      if (!this.pictureCurrent(epoch, token, turn)) return;
      const update = (patch) => {
        if (!this.pictureCurrent(epoch, token, turn)) return;
        const i = this.data.photos.findIndex((p) => p.id === photo.id);
        if (i >= 0) {
          const data = {};
          for (const k in patch) data["photos[" + i + "]." + k] = patch[k];
          this.setData(data);
        }
      };
      update({ loading: true, imageError: "" });
      try {
        const result = await s.api.request(
          "/players/" + this.id + "/photos/" + photo.id,
        );
        if (!this.pictureCurrent(epoch, token, turn)) return;
        const src = this.cachePicture("photo:" + photo.id, result.dataUrl);
        if (!src) throw new Error("照片暂时无法显示，请重试");
        update({ src, loading: false, imageError: "" });
      } catch (e) {
        if (
          !this._disposed &&
          !this._hidden &&
          epoch === this._epoch &&
          turn === this._picturesTurn &&
          (e.status || e.statusCode) === 401 &&
          !s.api.getSession()
        ) {
          s.fail(this, e);
          return;
        }
        if (!this.pictureCurrent(epoch, token, turn)) return;
        update({ loading: false, imageError: "照片加载失败，请重试" });
      }
    }
  },
  retryPhoto(e) {
    if (!this.readable()) return;
    const id = e.currentTarget.dataset.id;
    if (this.data.photos.some((p) => p.id === id && !p.loading))
      return this.loadPictures(id);
  },
  readable() {
    return (
      !this._disposed &&
      !this._hidden &&
      !this.data.loading &&
      !this.data.error &&
      this._owner === s.api.getSession()?.token
    );
  },
  photoError(e) {
    if (!this.readable()) return;
    this.releasePicture("photo:" + e.currentTarget.dataset.id);
    const i = this.data.photos.findIndex(
      (p) => p.id === e.currentTarget.dataset.id,
    );
    if (i >= 0)
      this.setData({
        ["photos[" + i + "].src"]: "",
        ["photos[" + i + "].loading"]: false,
        ["photos[" + i + "].imageError"]: "照片显示失败，请重试",
      });
  },
  input(e) {
    if (this.data.busy || this.data.uncertain) return;
    const field = e.currentTarget.dataset.field;
    if (field === "caption" && this.editable()) {
      this.setData({ [field]: e.detail.value });
      this.alertDraft();
    }
  },
  choose() {
    if (!this.editable() || this.data.uncertain) return;
    const epoch = this._epoch,
      turn = (this._imageEpoch = (this._imageEpoch || 0) + 1);
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album"],
      success: (r) => {
        if (
          this._disposed ||
          epoch !== this._epoch ||
          turn !== this._imageEpoch ||
          this._owner !== s.api.getSession()?.token
        )
          return;
        const f = r.tempFiles?.[0];
        if (!f) return;
        if (f.size > 2097152) {
          this.setData({ actionError: "请选择 2 MB 内的 PNG 或 JPG" });
          return;
        }
        wx.getFileSystemManager().readFile({
          filePath: f.tempFilePath,
          encoding: "base64",
          success: (result) => {
            if (
              this._disposed ||
              epoch !== this._epoch ||
              turn !== this._imageEpoch ||
              this._owner !== s.api.getSession()?.token
            )
              return;
            const data = result.data;
            const mime = data.startsWith("iVBORw0KGgo")
              ? "png"
              : data.startsWith("/9j/")
                ? "jpeg"
                : null;
            if (!mime || (data.length * 3) / 4 > 2097154) {
              this.setData({ actionError: "请选择 2 MB 内的 PNG 或 JPG" });
              return;
            }
            this._image = "data:image/" + mime + ";base64," + data;
            this.setData({ preview: f.tempFilePath, actionError: "" });
            this.alertDraft();
          },
          fail: () => {
            if (
              !this._disposed &&
              turn === this._imageEpoch &&
              this._owner === s.api.getSession()?.token
            )
              this.setData({ actionError: "图片读取失败，请重选" });
          },
        });
      },
      fail: (e) => {
        if (
          !this._disposed &&
          epoch === this._epoch &&
          turn === this._imageEpoch &&
          this._owner === s.api.getSession()?.token &&
          !/cancel/.test(e.errMsg || "")
        )
          this.setData({ actionError: "无法选择图片，请检查相册授权" });
      },
    });
  },
  editable() {
    return (
      this.data.admin &&
      !this.data.recoveryBlocked &&
      !this.data.busy &&
      !this.data.conflict &&
      !this.data.loading &&
      !this.data.error &&
      !this._hidden &&
      !this._disposed &&
      this._owner === s.api.getSession()?.token
    );
  },
  async perform(work, done, options = {}) {
    if (!this.editable()) return;
    const epoch = this._epoch,
      token = this._owner,
      showTurn = this._showTurn,
      attempt = (this._writeAttempt = {});
    this.setData({ busy: true, actionError: "" });
    this._imageEpoch = (this._imageEpoch || 0) + 1;
    try {
      const session = await s.api.ensureSession();
      if (
        session.user.role !== "admin" ||
        this._owner !== s.api.getSession()?.token
      )
        throw new Error("登录已变化，请重新载入");
      if (
        this._disposed ||
        this._hidden ||
        epoch !== this._epoch ||
        showTurn !== this._showTurn
      )
        return;
      const result = await work();
      if (
        !this._disposed &&
        epoch === this._epoch &&
        this._owner === s.api.getSession()?.token
      ) {
        if (done) done(result);
        this.setData({ busy: false });
        if (this._hidden) this._needsRefresh = true;
        else await this.refresh();
      }
    } catch (e) {
      const unknownOrder =
        options.order &&
        (!(e.status || e.statusCode) || (e.status || e.statusCode) >= 500);
      if (
        unknownOrder &&
        !this._disposed &&
        epoch === this._epoch &&
        token === this._owner &&
        token === s.api.getSession()?.token &&
        this._writeAttempt === attempt
      ) {
        if (this._hidden) this._needsRefresh = true;
        else
          this.setData({
            conflict: true,
            actionError: "排序结果尚未确认，请重新载入核对后再操作。",
          });
      }
      if (
        !this._disposed &&
        !this._hidden &&
        epoch === this._epoch &&
        showTurn === this._showTurn
      ) {
        const current = s.api.getSession();
        if ((e.status || e.statusCode) === 401 && !current) s.fail(this, e);
        else if (current?.token === token && this._owner === token)
          this.setData({
            conflict:
              (e.status || e.statusCode) === 409 ||
              (options.order &&
                (!(e.status || e.statusCode) ||
                  (e.status || e.statusCode) >= 500)),
            actionError:
              options.order &&
              (!(e.status || e.statusCode) || (e.status || e.statusCode) >= 500)
                ? "排序结果尚未确认，请重新载入核对后再操作。"
                : (e.status || e.statusCode) === 409
                  ? "相册已被修改，内容已保留，请重新载入核对。"
                  : e.message,
          });
      }
    } finally {
      if (
        !this._disposed &&
        epoch === this._epoch &&
        this._writeAttempt === attempt
      ) {
        this.setData({ busy: false });
        if (this._roleRefreshPending && !this._hidden &&
            token === this._owner && token === s.api.getSession()?.token)
          await this.refresh();
      }
    }
  },
  captionInput(e) {
    if (!this.editable() || this.data.uncertain) return;
    const i = this.data.photos.findIndex(
      (p) => p.id === e.currentTarget.dataset.id,
    );
    if (i >= 0) this.setData({ ["photos[" + i + "].draft"]: e.detail.value });
    this.alertDraft();
  },
  async saveCaption(e) {
    if (!this.editable() || this.data.uncertain || owned(this.id)) return;
    const p = this.data.photos.find((x) => x.id === e.currentTarget.dataset.id);
    if (!p || p.draft === p.caption) return;
    const { id, draft, caption } = p,
      revision = this.revision,
      epoch = this._epoch,
      owner = this._owner,
      showTurn = this._showTurn;
    if (p.captionConflict) {
      const result = await ui.showModal(this, {
        title: "确认替换照片说明",
        content: replacementMessage(caption, draft),
        confirmText: "确认替换",
      });
      if (!result.confirm) return;
    }
    const current = this.data.photos.find((x) => x.id === id);
    if (
      !this.editable() ||
      this.data.uncertain ||
      owner !== s.api.getSession()?.token ||
      epoch !== this._epoch ||
      showTurn !== this._showTurn ||
      revision !== this.revision ||
      current?.draft !== draft ||
      current?.caption !== caption
    )
      return;
    return this.perform(() =>
      s.api.request("/players/" + this.id + "/photos/" + id, "PUT", {
        revision,
        caption: draft,
      }),
    );
  },
  move(e) {
    if (this.data.uncertain || owned(this.id)) return;
    const ids = this.data.photos.map((p) => p.id),
      i = ids.indexOf(e.currentTarget.dataset.id),
      j = i + Number(e.currentTarget.dataset.delta);
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    return this.perform(
      () =>
        s.api.request("/players/" + this.id + "/photos/order", "PUT", {
          revision: this.revision,
          photoIds: ids,
        }),
      null,
      { order: true },
    );
  },
  upload() {
    let p = owned(this.id);
    if (p?.inFlight) return;
    if (this.data.uncertain && !p) {
      this._image = null;
      this.setData({ preview: "", caption: "", uncertain: false });
      return this.refresh();
    }
    if (!p) {
      if (!this._image || this.data.photos.length >= 9) return;
      p = {
        token: this._owner,
        playerId: this.id,
        requestId: key(),
        dataUrl: this._image,
        caption: this.data.caption,
        revision: this.revision,
        inFlight: false,
      };
    }
    return this.perform(
      async () => {
        owned(this.id);
        const receiptKey = this._guardKey;
        record(receiptKey, p.requestId);
        pendingByPlayer.set(this.id, p);
        p.inFlight = true;
        this.alertDraft();
        try {
          const result = await s.api.request(
            "/players/" + this.id + "/photos",
            "POST",
            {
              revision: p.revision,
              requestId: p.requestId,
              dataUrl: p.dataUrl,
              caption: p.caption,
            },
          );
          clear(receiptKey, p.requestId);
          drop(p);
          return result;
        } catch (e) {
          const status = e.status || e.statusCode || 0;
          if (status >= 400 && status < 500) {
            clear(receiptKey, p.requestId);
            drop(p);
          }
          if (!this._disposed && p.token === s.api.getSession()?.token)
            this.setData({ uncertain: owned(this.id) === p });
          throw e;
        } finally {
          p.inFlight = false;
        }
      },
      () => {
        this.releasePicture("pending:" + p.requestId);
        this._image = null;
        this.setData({ preview: "", caption: "", uncertain: false });
        this.alertDraft();
      },
    );
  },
  remove(e) {
    if (this.data.uncertain || owned(this.id)) return;
    const id = e.currentTarget.dataset.id,
      epoch = this._epoch;
    ui.showModal(this, {
      title: "移除照片",
      content: "从球员照片集中移除此照片？头像不受影响。",
      confirmText: "移除",
      success: (r) => {
        if (r.confirm && !this._disposed && epoch === this._epoch)
          this.perform(
            () =>
              s.api.request("/players/" + this.id + "/photos/" + id, "DELETE", {
                revision: this.revision,
              }),
            () => this.releasePicture("photo:" + id),
          );
      },
    });
  },
  cover(e) {
    if (this.data.uncertain || owned(this.id)) return;
    return this.perform(() =>
      s.api.request("/players/" + this.id + "/photos/cover", "PUT", {
        revision: this.revision,
        photoId: e.currentTarget.dataset.id,
      }),
    );
  },
  previewPhoto(e) {
    if (!this.readable()) return;
    const urls = this.data.photos.map((p) => p.src).filter(Boolean);
    const current = this.data.photos.find(
      (p) => p.id === e.currentTarget.dataset.id,
    )?.src;
    const epoch = this._epoch,
      token = this._owner;
    if (current)
      wx.previewImage({
        current,
        urls,
        fail: () => {
          if (this.readable() && epoch === this._epoch && token === this._owner)
            this.setData({ actionError: "照片预览失败，请重试" });
        },
      });
  },
  acknowledge() {
    if (
      !this.readable() ||
      !this.data.admin ||
      this.data.busy ||
      owned(this.id)
    )
      return;
    const epoch = this._epoch,
      token = this._owner,
      k = this._guardKey;
    ui.showModal(this, {
      title: "确认已核对",
      content:
        "请先核对照片列表，上次上传可能已经成功。解除后才能选择其他照片，不会自动重传。",
      confirmText: "已核对",
      success: (r) => {
        if (
          r.confirm &&
          this.readable() &&
          epoch === this._epoch &&
          token === this._owner
        ) {
          try {
            wx.removeStorageSync(k);
            if (receipt(k)) throw new Error("无法清除核对记录");
            this.setData({ recoveryBlocked: false });
          } catch (e) {
            this.setData({ actionError: e.message });
          }
        }
      },
    });
  },
  reload() {
    if (this.data.busy) return;
    const epoch = this._epoch;
    ui.showModal(this, {
      title: "重新载入",
      content: "将丢弃未保存的文字修改。未确认的上传仍会保留。",
      success: (r) => {
        if (r.confirm && !this._disposed && epoch === this._epoch)
          this.refresh(false);
      },
    });
  },
});
