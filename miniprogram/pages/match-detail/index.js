const s = require("../shared");
Page({
  data: {
    loading: true,
    error: "",
    match: null,
    team: {},
    admin: false,
    canReply: false,
    busy: false,
    actionError: "",
    replies: [],
    roster: [],
    snapshots: [],
  },
  onLoad(q) {
    this.id = q.id;
  },
  onShow() {
    this.refresh();
  },
  onPullDownRefresh() {
    if (!this.data.busy) this.refresh();
    else wx.stopPullDownRefresh();
  },
  onUnload: s.unload,
  imageError: s.imageError,
  refresh() {
    return s.load(this, async (session) => {
      const [raw, players] = await Promise.all([
        s.api.request("/matches/" + encodeURIComponent(this.id)),
        s.api.request("/players"),
      ]);
      const match = s.matchView(raw, session.user.playerId);
      const byId = new Map(players.map((p) => [p.id, p]));
      return {
        match,
        team: session.team,
        admin: session.user.role === "admin",
        canReply:
          session.user.role === "player" &&
          !!session.user.playerId &&
          match.status === "published",
        replies: raw.rsvps.map((r) => ({
          playerId: r.playerId,
          name: byId.get(r.playerId)?.name || "历史成员",
          label: s.replies[r.response],
        })),
        roster: raw.roster.map((r) => ({
          ...r,
          name: r.playerSnapshot?.name || "历史身份未记录",
          number: s.value(r.playerSnapshot?.number),
          selectionLabel:
            { starter: "首发", bench: "替补", unknown: "未确定" }[
              r.selection
            ] || "未确定",
          appearedLabel:
            r.appeared === true
              ? "已出场"
              : r.appeared === false
                ? "未出场"
                : "出场待确认",
          goalsLabel: s.value(r.goals),
          assistsLabel: s.value(r.assists),
        })),
        snapshots: (raw.tacticSnapshots || []).map((t) => ({
          id: t.sourceTacticId,
          name: t.tactic?.name || t.tactic?.title || "比赛战术",
          source: t.captureSource === "migration" ? "迁移时留存" : "关联时留存",
        })),
      };
    });
  },
  edit() {
    wx.navigateTo({
      url: "/pages/match-edit/index?id=" + encodeURIComponent(this.id),
    });
  },
  async reply(e) {
    if (this.data.busy || !this.data.canReply) return;
    const response = e.currentTarget.dataset.response;
    if (response === this.data.match.response) return;
    this._epoch = (this._epoch || 0) + 1;
    this.setData({ busy: true, actionError: "" });
    try {
      await s.api.request(
        "/matches/" + encodeURIComponent(this.id) + "/rsvp",
        "PUT",
        { response },
      );
      if (!this._disposed) {
        await this.refresh();
        wx.showToast({ title: "报名状态已更新", icon: "success" });
      }
    } catch (error) {
      if (!this._disposed) {
        this.setData({ actionError: error.message || "更新失败，请重试" });
        if ((error.status || error.statusCode) === 401) s.fail(this, error);
      }
    } finally {
      if (!this._disposed) this.setData({ busy: false });
    }
  },
});
