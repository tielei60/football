const ui=require('../../utils/ui');
const s = require("../shared");
// Unconfirmed creation drafts are process-only and bound to the issuing login.
let pendingCreateDraft = null;
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
Page({openBusinessPicker(e){return require('../../utils/business-picker-bridge').open(this,e);},onHide(){ui.abort(this);},
  data: {
    loading: true,
    editing: false,
    error: "",
    busy: false,
    actionError: "",
    conflict: false,
    uncertain: false,
    revision: null,
    formats,
    sides,
    statuses,
    seasons: [],
    venues: [],
    venueIndex: 0,
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
    this.setData({ editing: !!q.id });
    this.refresh();
  },
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  refresh() {
    return s.load(this, async (session) => {
      if (session.user.role !== "admin")
        throw new Error("仅管理员可以编辑比赛");
      const privateSession = s.api.getSession();
      const draftOwner = JSON.stringify([
        session.user.id,
        session.user.teamId,
        privateSession?.expiresAt,
      ]);
      const draft =
        !this.id &&
        pendingCreateDraft?.owner === draftOwner &&
        pendingCreateDraft.token === privateSession?.token
          ? pendingCreateDraft
          : null;
      if (
        pendingCreateDraft &&
        (pendingCreateDraft.owner !== draftOwner ||
          pendingCreateDraft.token !== privateSession?.token)
      )
        pendingCreateDraft = null;
      const seasons = [
        { id: null, name: "未分配赛季" },
        ...(await s.api.request("/seasons")),
      ];
      const m = this.id
        ? await s.api.request("/matches/" + encodeURIComponent(this.id))
        : null;
      const venueId=m?.venueId??draft?.venueId??null;
      const allVenues=await s.api.request('/venues');
      const venues=[{id:null,name:'不关联球场 / 手填地点'},...allVenues.filter(v=>v.status==='active'||v.id===venueId)];
      if(m?.venueId){const index=venues.findIndex(v=>v.id===m.venueId);if(index>0)venues[index]={...venues[index],name:(m.venueSnapshot?.name||venues[index].name)+'（本场留存）',locationLabel:m.location};}
      if(venueId && !venues.some(v=>v.id===venueId))venues.push({id:venueId,name:m?.venueSnapshot?.name||'历史球场',locationLabel:m?.location});
      return {
        venues,
        venueIndex:Math.max(0,venues.findIndex(v=>v.id===venueId)),
        draftOwner,
        uncertain: !!draft,
        revision: m?.revision ?? null,
        dateLabel: m
          ? s.dateLabel(m.date)
          : draft
            ? s.dateLabel(draft.form.date)
            : "",
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
          : draft
            ? { ...draft.form }
            : this.data.form,
        formatIndex: Math.max(
          0,
          formats.findIndex((f) => f.value === (m?.format ?? draft?.format)),
        ),
        sideIndex: Math.max(
          0,
          sides.findIndex((f) => f.value === (m?.side ?? draft?.side)),
        ),
        statusIndex: Math.max(
          0,
          statuses.findIndex((f) => f.value === (m?.status ?? draft?.status)),
        ),
        seasonIndex: Math.max(
          0,
          seasons.findIndex((f) => f.id === (m?.seasonId ?? draft?.seasonId)),
        ),
        conflict: false,
        actionError: draft ? "上次创建结果尚未确认，请先核对赛程。" : "",
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
    const key=e.currentTarget.dataset.field;const index=Number(e.detail.value);
    this.setData({ [key]: index });
    if(key==='venueIndex'&&this.data.venues[index]?.id){const v=this.data.venues[index];this.setData({'form.location':v.locationLabel??[v.name,v.address].filter(Boolean).join(' · ').slice(0,500)});}
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
    ui.showModal(this,{
      title: "重新载入最新比赛",
      content: "这会丢弃本页尚未保存的修改。是否继续？",
      success: (r) => {
        if (r.confirm) this.refresh();
      },
    });
  },
  checkSchedule() {
    wx.switchTab({ url: "/pages/schedule/index" });
  },
  confirmAbsent() {
    const attempt = pendingCreateDraft;
    if (attempt?.inFlight) {
      this.setData({ actionError: "上次创建仍在处理中，请等待结果后再核对。" });
      return;
    }
    const token = s.api.getSession()?.token;
    if (attempt && attempt.token !== token) return;
    ui.showModal(this,{
      title: "确认未创建比赛",
      content: "请先核对赛程和草稿。仅在确认没有上次比赛时继续，避免重复创建。",
      success: (result) => {
        if (result.confirm && !this._disposed && pendingCreateDraft === attempt && !attempt?.inFlight && s.api.getSession()?.token === token) {
          pendingCreateDraft = null;
          this.setData({ uncertain: false, actionError: "" });
        }
      },
    });
  },
  async save() {
    if (this.data.busy || this.data.conflict || this.data.uncertain) return;
    if (!this.id && pendingCreateDraft && pendingCreateDraft.token === s.api.getSession()?.token) {
      this.setData({ uncertain: true, actionError: pendingCreateDraft.inFlight ? "上次创建仍在处理中，请等待结果。" : "上次创建结果尚未确认，请先核对赛程。" });
      return;
    }
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
      venueId: this.data.venues[this.data.venueIndex]?.id??null,
    };
    if (this.id) payload.revision = this.data.revision;
    const submissionToken = s.api.getSession()?.token;
    const attempt = !this.id ? {
      owner: this.data.draftOwner,
      token: submissionToken,
      form: { ...f },
      format: payload.format,
      side: payload.side,
      status: payload.status,
      seasonId: payload.seasonId,
      venueId: payload.venueId,
      inFlight: true,
    } : null;
    if (attempt) pendingCreateDraft = attempt;
    this.setData({ busy: true, actionError: "" });
    try {
      const result = await s.api.request(
        this.id ? "/matches/" + encodeURIComponent(this.id) : "/matches",
        this.id ? "PUT" : "POST",
        payload,
      );
      if (attempt && pendingCreateDraft === attempt) pendingCreateDraft = null;
      if (!this._disposed) {
        ui.showToast(this,{ title: "比赛已保存", icon: "success" });
        wx.redirectTo({ url: "/pages/match-detail/index?id=" + result.id });
      }
    } catch (error) {
      const status = error.status || error.statusCode || 0;
      const uncertain = !this.id && (status === 0 || status >= 500);
      if (attempt && pendingCreateDraft === attempt) {
        if (uncertain) attempt.inFlight = false;
        else pendingCreateDraft = null;
      }
      if (!this._disposed) {
        const conflict = status === 409;
        this.setData({
          conflict,
          uncertain,
          actionError: uncertain
            ? "提交结果未确认，比赛可能已创建。请先核对赛程和草稿；确认未创建后，点“已核对，继续编辑”。"
            : conflict
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
