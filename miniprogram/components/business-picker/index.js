const bridge = require("../../utils/business-picker-bridge");
const identity = () => require("../../utils/api").getSession()?.token || null;
Component({
  options: { styleIsolation: "isolated" },
  properties: {
    mode: { type: String, value: "selector" },
    range: { type: Array, value: [] },
    rangeKey: { type: String, value: "" },
    value: { type: null, value: null },
    start: { type: String, value: "" },
    end: { type: String, value: "" },
    fields: { type: String, value: "day" },
    disabled: { type: Boolean, value: false },
    title: { type: String, value: "" },
  },
  data: { defaultLabel: "选择选项，当前未选择" },
  observers: {
    "mode,range,rangeKey,value,fields,title": function () {
      this.updateLabel();
    },
  },
  lifetimes: {
    attached() {
      this._dead = false;
      this.updateLabel();
    },
    detached() {
      this._dead = true;
      this._openEpoch = (this._openEpoch || 0) + 1;
      bridge.cancel(this._ticket);
    },
  },
  methods: {
    updateLabel() {
      const p = this.properties;
      const prefix =
        p.mode === "time"
          ? "选择时间"
          : p.mode === "date"
            ? p.fields === "year"
              ? "选择年份"
              : p.fields === "month"
                ? "选择月份"
                : "选择日期"
            : "选择选项";
      let value = p.value;
      if (!p.mode || p.mode === "selector") {
        const i = Number(p.value),
          item = Number.isInteger(i) && i >= 0 ? p.range?.[i] : undefined;
        value =
          p.rangeKey && item && typeof item === "object"
            ? item[p.rangeKey]
            : item && typeof item === "object"
              ? undefined
              : item;
      }
      const current =
        value === undefined || value === null || String(value) === ""
          ? "未选择"
          : String(value);
      this.setData({ defaultLabel: `${p.title || prefix}，当前${current}` });
    },
    async open() {
      if (this.properties.disabled || this._pending || this._dead) return;
      const signature = JSON.stringify(this.properties),
        config = JSON.parse(signature),
        owner = identity(),
        epoch = (this._openEpoch || 0) + 1;
      this._openEpoch = epoch;
      this._pending = true;
      try {
        const task = bridge.request(this, config);
        this._ticket = task.requestId;
        const r = await task.promise;
        if (
          this._dead ||
          epoch !== this._openEpoch ||
          owner !== identity() ||
          this.properties.disabled ||
          JSON.stringify(this.properties) !== signature
        )
          return;
        if (r.confirm && !r.aborted)
          this.triggerEvent("change", { value: r.value });
        else if (!r.aborted) this.triggerEvent("cancel", {});
      } finally {
        if (epoch === this._openEpoch) {
          this._pending = false;
          this._ticket = null;
        }
      }
    },
  },
});
