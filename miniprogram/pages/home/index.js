const s = require("../shared");
Page({
  data: {
    loading: true,
    error: "",
    team: {},
    next: null,
    recent: [],
    playerCount: 0,
    stats: null,
  },
  onShow() {
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh();
  },
  onUnload: s.unload,
  onHide: s.hide,
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
        .sort((a, b) => (a.date + a.kickoff).localeCompare(b.date + b.kickoff));
      return {
        team: s.teamView(session.team),
        playerCount: players.filter((p) => p.status === "active").length,
        stats: { team: { matches: stats.team.matches, wins: stats.team.wins } },
        next: upcoming[0]
          ? s.matchView(upcoming[0], session.user.playerId)
          : null,
        recent: matches
          .filter((m) => m.status === "completed")
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 3)
          .map((m) => s.matchView(m, session.user.playerId)),
      };
    });
  },
  schedule() {
    wx.switchTab({ url: "/pages/schedule/index" });
  },
});
