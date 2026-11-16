const ui=require('../../utils/ui');
const a = require("./admin");
Page({onHide(){a.hide.call(this);},
  data: {
    loading: true,
    error: "",
    authorized: false,
    busy: false,
    conflict: false,
    uncertain: false,
    actionError: "",
    revision: null,
    form: { name: "" },
    crest: "",
  },
  onShow() { return a.show.call(this); },
  onLoad() {
    this.refresh();
  },
  onUnload(){ui.abort(this);return a.unload.apply(this,arguments);},
  refresh() {
    if (this.data.busy) return;
    this._imageData = undefined;
    return a.load(this, async () => {
      const t = await a.s.api.request("/team");
      return {
        revision: t.revision,
        form: { name: t.name },
        crest: a.s.assetUrl(t.crest),
        conflict: false,
        uncertain: false,
        actionError: "",
      };
    });
  },
  input: a.input,
  reload() {
    a.reload(this);
  },
  choose() {
    a.choosePicture(this, "crest");
  },
  remove() {
    if (this.data.loading || this.data.busy || !this.data.authorized || !this.data.crest || this._disposed || this._hidden || this._crestRemoval) return;
    const attempt = { epoch: this._epoch, view: this._adminView, imageEpoch: this._imageEpoch, crest: this.data.crest, owner: a.s.api.getSession()?.token };
    this._crestRemoval = attempt;
    const current = () => this._crestRemoval === attempt && !this._disposed && !this._hidden && !this.data.busy && this.data.authorized && this._epoch === attempt.epoch && this._adminView === attempt.view && this._imageEpoch === attempt.imageEpoch && this.data.crest === attempt.crest && a.s.api.getSession()?.token === attempt.owner;
    const finish = () => { if (this._crestRemoval === attempt) this._crestRemoval = null; };
    try {
      const pending = ui.showModal(this, {
        title: "移除队徽",
        content: "确定移除当前队徽？点击保存设置后才会更新球队，取消不会修改。",
        confirmText: "移除",
        success: (result) => {
          if (!result.confirm || !current()) return;
          this._imageEpoch = (this._imageEpoch || 0) + 1;
          this._imageData = null;
          this.setData({ crest: "" });
        },
        fail: () => { if (current()) this.setData({ actionError: "未能打开确认，请重试。" }); },
        complete: finish,
      });
      // abort/unavailable只结束Promise，不调用业务回调，也必须释放本地锁。
      if (pending && typeof pending.finally === "function") return pending.finally(finish);
    } catch (_) {
      if (current()) this.setData({ actionError: "未能打开确认，请重试。" });
      finish();
    }
  },
  imageError() {
    this.setData({ crest: "" });
  },
  save() {
    if (!this.data.form.name.trim()) {
      this.setData({ actionError: "请输入球队名称" });
      return;
    }
    const payload = {
      revision: this.data.revision,
      name: this.data.form.name.trim(),
    };
    if (this._imageData !== undefined) payload.crest = this._imageData;
    return a.act(
      this,
      () => a.s.api.request("/team", "PUT", payload),
      (t) => {
        this._imageData = undefined;
        this.setData({
          revision: t.revision,
          form: { name: t.name },
          crest: a.s.assetUrl(t.crest),
        });
        ui.showToast(this,{ title: "球队已更新" });
      },
    );
  },
});
