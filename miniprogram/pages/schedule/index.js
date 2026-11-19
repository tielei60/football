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
  onHide(){ui.abort(this);this.setData({admin:false});return s.hide.apply(this,arguments);},
  imageError: s.imageError,
  openMatch: s.openMatch,
  refresh() {
    const owner = s.api.getSession()?.token;
    this.setData({ admin: false });
    return s.load(this, async (session) => {
      if (!owner || owner !== s.api.getSession()?.token) return {};
      const admin = session.user.role === "admin";
      const tab = !admin && this.data.tab === "draft" ? "upcoming" : this.data.tab;
      if (!admin) this.setData({ tab });
      const matches = (await s.api.request("/matches")).map((m) =>
        s.matchView(m, session.user.playerId),
      );
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
      // All tabs use kickoff descending; equal timestamps retain source order.
      // Unknown kickoff stays after known times on the same date.
      .sort((a, b) =>
        (b.date + (b.kickoff || "")).localeCompare(a.date + (a.kickoff || "")),
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
    if (this._disposed || this._hidden || this.data.loading || this.data.error ||
        !["upcoming", "past", "draft"].includes(tab) || (tab === "draft" && !this.data.admin)) return;
    this.setData({ tab, visible: this.filter(this.data.matches, tab) });
  },
  create() {
    if (this._disposed || this._hidden || this.data.loading || this.data.error || !this.data.admin) return;
    wx.navigateTo({ url: "/pages/match-edit/index" });
  },
});
