const s = require("../shared");
Page({
  data: {
    loading: true,
    error: "",
    player: null,
    record: null,
    year: new Date().getFullYear(),
  },
  onLoad(q) {
    this.id = q.id;
  },
  onShow() {
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh();
  },
  onUnload: s.unload,
  imageError: s.imageError,
  refresh() {
    return s.load(this, async () => {
      const [players, stats] = await Promise.all([
        s.api.request("/players"),
        s.api.request("/statistics?year=" + this.data.year),
      ]);
      const p = players.find((p) => p.id === this.id);
      if (!p) throw new Error("未找到此球员，可能已不在当前球队");
      const r = stats.players.find((p) => p.playerId === this.id);
      return {
        player: s.playerView(p),
        record: r
          ? {
              ...r,
              goalsLabel: s.value(r.goals),
              assistsLabel: s.value(r.assists),
            }
          : null,
      };
    });
  },
});
