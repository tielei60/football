const ui=require('../../utils/ui');
const s = require("../shared");
const resultView = require("../../utils/match-result-view");
Page({
  data: {
    shortcuts: [
      { page: "schedule", label: "比赛", icon: "/assets/schedule-shortcut.png" },
      { page: "players", label: "球员", icon: "/assets/players-shortcut.png" },
      { page: "statistics", label: "数据", icon: "/assets/statistics-shortcut.png" },
      { page: "tactics", label: "战术", icon: "/assets/tactics-shortcut.png" },
    ],
    loading: true,
    error: "",
    team: {},
    roleLabel: "",
    next: null,
    moreUpcoming: [],
    recent: [],
    playerCount: 0,
    unconfirmedCount: 0,
    stats: null,
  },
  onShow() {
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh();
  },
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  onHide(){ui.abort(this);this.setData({moreUpcoming:[]});return s.hide.apply(this,arguments);},
  imageError: s.imageError,
  openMatch: s.openMatch,
  refresh() {
    return s.load(this, async (session) => {
      const [matches, players, stats] = await Promise.all([
        s.api.request("/matches"),
        s.api.request("/players"),
        s.api.request("/statistics?year=" + new Date().getFullYear()),
      ]);
      const today = new Date();
      const date = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0"),
      ].join("-");
      const upcoming = matches
        .filter((m) => m.status === "published" && m.date >= date)
        .sort((a, b) => (b.date + (b.kickoff || "")).localeCompare(a.date + (a.kickoff || "")));
      return {
        team: s.teamView(session.team),
        roleLabel: session.user.role === "admin" ? "管理端" : session.user.role === "player" ? "球员端" : "",
        playerCount: players.filter((p) => p.membershipKind !== "guest" && p.status === "active" && p.membershipConfirmed !== false).length,
        unconfirmedCount: players.filter((p) => p.membershipKind !== "guest" && p.membershipConfirmed === false).length,
        stats: { team: { matches: stats.team.matches, wins: stats.team.wins } },
        next: upcoming[0]
          ? s.matchView(upcoming[0], session.user.playerId)
          : null,
        moreUpcoming: upcoming.slice(1, 3).map((m) => s.matchView(m, session.user.playerId)),
        recent: matches
          .filter((m) => m.status === "completed")
          .sort((a, b) => (b.date + (b.kickoff || "")).localeCompare(a.date + (a.kickoff || "")))
          .slice(0, 3)
          .map((m) => ({ ...s.matchView(m, session.user.playerId), ...resultView(m) })),
      };
    });
  },
  shortcut(e) {
    if (this._hidden || this._disposed || this.data.loading || this.data.error) return;
    const page = e.currentTarget.dataset.page;
    if (page === "tactics") wx.navigateTo({ url: "/pages/tactics/index" });
    else if (["schedule", "players", "statistics"].includes(page)) wx.switchTab({ url: "/pages/" + page + "/index" });
  },
  schedule() {
    wx.switchTab({ url: "/pages/schedule/index" });
  },
});
