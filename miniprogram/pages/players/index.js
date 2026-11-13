const s = require("../shared");
Page({
  data: {
    loading: true,
    error: "",
    players: [],
    visible: [],
    search: "",
    status: "active",
    positionIndex: 0,
    positions: ["全部位置"],
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
  openPlayer: s.openPlayer,
  refresh() {
    return s.load(this, async () => {
      const players = (await s.api.request("/players")).map(s.playerView);
      const positions = [
        "全部位置",
        ...new Set(players.flatMap((p) => p.positions || [])),
      ];
      return {
        players,
        positions,
        visible: this.filter(players, this.data.search, this.data.status),
      };
    });
  },
  filter(rows, q, status) {
    const needle = q.trim().toLowerCase();
    return rows
      .filter(
        (p) =>
          p.status === status &&
          (!this.data.positionIndex ||
            (p.positions || []).includes(
              this.data.positions[this.data.positionIndex],
            )) &&
          (!needle ||
            p.name.toLowerCase().includes(needle) ||
            String(p.number ?? "").includes(needle)),
      )
      .sort(
        (a, b) =>
          (a.number ?? 100000) - (b.number ?? 100000) ||
          a.name.localeCompare(b.name),
      );
  },
  search(e) {
    const search = e.detail.value;
    this.setData({
      search,
      visible: this.filter(this.data.players, search, this.data.status),
    });
  },
  position(e) {
    this.setData({ positionIndex: Number(e.detail.value) });
    this.setData({
      visible: this.filter(
        this.data.players,
        this.data.search,
        this.data.status,
      ),
    });
  },
  changeTab(e) {
    const status = e.currentTarget.dataset.status;
    this.setData({
      status,
      visible: this.filter(this.data.players, this.data.search, status),
    });
  },
});
