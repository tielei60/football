const ui=require('../../utils/ui');
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
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  onHide(){ui.abort(this);return s.hide.apply(this,arguments);},
  imageError: s.imageError,
  openMatch: s.openMatch,
  refresh() {
    return s.load(this, async (session) => {
      const matches = (await s.api.request("/matches")).map((m) =>
        s.matchView(m, session.user.playerId),
      );
      const admin = session.user.role === "admin";
      // Tab pages can survive account switches. A player must not inherit the
      // hidden admin-only draft filter and see an apparently empty schedule.
      const tab = !admin && this.data.tab === "draft" ? "upcoming" : this.data.tab;
      return {
        matches,
        team: s.teamView(session.team),
        admin,
        tab,
        visible: this.filter(matches, tab),
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
        dayLabel: m.date.slice(8, 10),
        weekdayLabel: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(m.date + "T12:00:00").getDay()] || "",
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
