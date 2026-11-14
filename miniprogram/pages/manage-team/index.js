const ui=require('../../utils/ui');
const a = require("./admin");
Page({onHide(){ui.abort(this);},
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
    if (this.data.busy) return;
    this._imageEpoch = (this._imageEpoch || 0) + 1;
    this._imageData = null;
    this.setData({ crest: "" });
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
