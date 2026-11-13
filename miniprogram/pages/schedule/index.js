const s = require("../shared");
Page({
  data: {
    loading: true,
    error: "",
    tab: "upcoming",
    matches: [],
    visible: [],
    admin: false,
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
      const matches = (await s.api.request("/matches")).map((m) =>
        s.matchView(m, session.user.playerId),
      );
      return {
        matches,
        admin: session.user.role === "admin",
        visible: this.filter(matches, this.data.tab),
      };
    });
  },
  filter(rows, tab) {
    return rows
      .filter((m) =>
        tab === "upcoming"
          ? m.status === "published"
          : tab === "past"
            ? m.status === "completed" || m.status === "cancelled"
            : m.status === "draft",
      )
      .sort((a, b) =>
        tab === "upcoming"
          ? (a.date + a.kickoff).localeCompare(b.date + b.kickoff)
          : (b.date + b.kickoff).localeCompare(a.date + a.kickoff),
      )
      .map((m, i, rows) => ({
        ...m,
        monthHeading:
          i === 0 || m.date.slice(0, 7) !== rows[i - 1].date.slice(0, 7)
            ? m.date.slice(0, 7).replace("-", "年") + "月"
            : "",
      }));
  },
  changeTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab, visible: this.filter(this.data.matches, tab) });
  },
  create() {
    wx.navigateTo({ url: "/pages/match-edit/index" });
  },
});
