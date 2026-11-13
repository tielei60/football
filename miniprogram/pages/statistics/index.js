const s = require("../shared");
Page({
  data: {
    loading: true,
    error: "",
    seasons: [],
    seasonIndex: 0,
    selectedSeasonId: null,
    year: String(new Date().getFullYear()),
    stats: null,
    leaders: [],
    metric: "goals",
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
      const seasons = await s.api.request("/seasons");
      const options = [{ id: null, name: "按自然年" }, ...seasons];
      const selected =
        options.find((option) => option.id === this.data.selectedSeasonId) ||
        options[0];
      const stats = await s.api.request(
        "/statistics?" +
          (selected.id ? "seasonId=" + selected.id : "year=" + this.data.year),
      );
      return {
        seasons: options,
        selectedSeasonId: selected.id,
        seasonIndex: options.indexOf(selected),
        stats: {
          ...stats,
          team: {
            ...stats.team,
            goalsForLabel: s.value(stats.team.goalsFor),
            goalsAgainstLabel: s.value(stats.team.goalsAgainst),
          },
        },
        leaders: this.rank(stats.players, this.data.metric),
      };
    });
  },
  rank(players, metric) {
    return [...players]
      .sort(
        (a, b) =>
          (b[metric] ?? -1) - (a[metric] ?? -1) || a.name.localeCompare(b.name),
      )
      .map((p, i) => ({
        ...p,
        rank: i + 1,
        value: s.value(p[metric]),
        coverage:
          metric === "goals"
            ? p.goalsKnownMatches
            : metric === "assists"
              ? p.assistsKnownMatches
              : null,
      }));
  },
  season(e) {
    const seasonIndex = Number(e.detail.value);
    this.setData({
      seasonIndex,
      selectedSeasonId: this.data.seasons[seasonIndex]?.id ?? null,
    });
    this.refresh();
  },
  year(e) {
    this.setData({ year: e.detail.value.slice(0, 4) });
    this.refresh();
  },
  metric(e) {
    const metric = e.currentTarget.dataset.metric;
    this.setData({
      metric,
      leaders: this.rank(this.data.stats?.players || [], metric),
    });
  },
});
