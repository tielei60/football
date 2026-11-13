const s = require("../shared");
const formats = [
  { label: "未设置", value: null },
  ...[5, 6, 7, 8, 9, 11].map((value) => ({ label: value + "人制", value })),
];
const sides = [
  { label: "未设置", value: "unknown" },
  { label: "主场", value: "home" },
  { label: "客场", value: "away" },
  { label: "中立场", value: "neutral" },
];
const statuses = [
  { label: "草稿", value: "draft" },
  { label: "发布报名", value: "published" },
  { label: "已完赛", value: "completed" },
  { label: "已取消", value: "cancelled" },
];
Page({
  data: {
    loading: true,
    error: "",
    busy: false,
    actionError: "",
    conflict: false,
    revision: null,
    formats,
    sides,
    statuses,
    seasons: [],
    formatIndex: 0,
    sideIndex: 0,
    statusIndex: 0,
    seasonIndex: 0,
    form: {
      opponent: "",
      competition: "",
      date: "",
      kickoff: "",
      location: "",
      homeScore: "",
      awayScore: "",
      analysis: "",
    },
  },
  onLoad(q) {
    this.id = q.id;
    this.refresh();
  },
  onUnload: s.unload,
  refresh() {
    return s.load(this, async (session) => {
      if (session.user.role !== "admin")
        throw new Error("仅管理员可以编辑比赛");
      const seasons = [
        { id: null, name: "未分配赛季" },
        ...(await s.api.request("/seasons")),
      ];
      const m = this.id
        ? await s.api.request("/matches/" + encodeURIComponent(this.id))
        : null;
      return {
        revision: m?.revision ?? null,
        dateLabel: m ? s.dateLabel(m.date) : "",
        seasons,
        form: m
          ? {
              opponent: m.opponent,
              competition: m.competition,
              date: m.date,
              kickoff: m.kickoff,
              location: m.location,
              homeScore: m.homeScore == null ? "" : String(m.homeScore),
              awayScore: m.awayScore == null ? "" : String(m.awayScore),
              analysis: m.analysis,
            }
          : this.data.form,
        formatIndex: Math.max(
          0,
          formats.findIndex((f) => f.value === m?.format),
        ),
        sideIndex: Math.max(
          0,
          sides.findIndex((f) => f.value === m?.side),
        ),
        statusIndex: Math.max(
          0,
          statuses.findIndex((f) => f.value === m?.status),
        ),
        seasonIndex: Math.max(
          0,
          seasons.findIndex((f) => f.id === m?.seasonId),
        ),
        conflict: false,
        actionError: "",
      };
    });
  },
  input(e) {
    if (this.data.busy) return;
    const key = e.currentTarget.dataset.field;
    this.setData({ ["form." + key]: e.detail.value });
  },
  pick(e) {
    if (this.data.busy) return;
    this.setData({ [e.currentTarget.dataset.field]: Number(e.detail.value) });
  },
  date(e) {
    this.setData({
      "form.date": e.detail.value,
      dateLabel: s.dateLabel(e.detail.value),
    });
  },
  time(e) {
    this.setData({ "form.kickoff": e.detail.value });
  },
  clearTime() {
    this.setData({ "form.kickoff": "" });
  },
  reload() {
    wx.showModal({
      title: "重新载入最新比赛",
      content: "这会丢弃本页尚未保存的修改。是否继续？",
      success: (r) => {
        if (r.confirm) this.refresh();
      },
    });
  },
  async save() {
    if (this.data.busy || this.data.conflict) return;
    const f = this.data.form;
    if (!f.opponent.trim() || !f.date) {
      this.setData({ actionError: "请填写对手并选择比赛日期" });
      return;
    }
    for (const key of ["homeScore", "awayScore"])
      if (f[key] !== "" && !/^\d+$/.test(f[key])) {
        this.setData({ actionError: "比分请填写非负整数，未知时留空" });
        return;
      }
    const payload = {
      ...f,
      opponent: f.opponent.trim(),
      homeScore: f.homeScore === "" ? null : Number(f.homeScore),
      awayScore: f.awayScore === "" ? null : Number(f.awayScore),
      format: formats[this.data.formatIndex].value,
      side: sides[this.data.sideIndex].value,
      status: statuses[this.data.statusIndex].value,
      seasonId: this.data.seasons[this.data.seasonIndex].id,
    };
    if (this.id) payload.revision = this.data.revision;
    this.setData({ busy: true, actionError: "" });
    try {
      const result = await s.api.request(
        this.id ? "/matches/" + encodeURIComponent(this.id) : "/matches",
        this.id ? "PUT" : "POST",
        payload,
      );
      if (!this._disposed) {
        wx.showToast({ title: "比赛已保存", icon: "success" });
        wx.redirectTo({ url: "/pages/match-detail/index?id=" + result.id });
      }
    } catch (error) {
      if (!this._disposed) {
        const conflict = (error.status || error.statusCode) === 409;
        this.setData({
          conflict,
          actionError: conflict
            ? "比赛已被其他人修改。你的输入已保留，请核对后重新载入再编辑。"
            : error.message || "保存失败，请重试",
        });
        if ((error.status || error.statusCode) === 401) s.fail(this, error);
      }
    } finally {
      if (!this._disposed) this.setData({ busy: false });
    }
  },
});
