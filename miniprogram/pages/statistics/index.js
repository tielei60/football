const ui=require('../../utils/ui');
const s = require("../shared");
Page({openBusinessPicker(e){return require('../../utils/business-picker-bridge').open(this,e);},
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
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  onHide(){ui.abort(this);return s.hide.apply(this,arguments);},
  imageError: s.imageError,
  openPlayer(e) {
    if(this.data.loading||this.data.error)return;
    const scope=this.data.selectedSeasonId!==null?'seasonId='+encodeURIComponent(this.data.selectedSeasonId):'year='+encodeURIComponent(this.data.year);
    wx.navigateTo({url:'/pages/player-detail/index?id='+encodeURIComponent(e.currentTarget.dataset.id)+'&'+scope});
  },
  refresh() {
    return s.load(this, async () => {
      const seasons = await s.api.request("/seasons");
      const options = [{ id: null, name: "按自然年" }, ...seasons];
      const selected = options.find((option) => option.id === this.data.selectedSeasonId);
      if(!selected)throw new Error('所选赛季已不可用，请重新选择统计范围。');
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
  resetYearScope() {
    if(this.data.loading||!this.data.error||this.data.selectedSeasonId===null)return;
    this.setData({selectedSeasonId:null,seasonIndex:0});
    return this.refresh();
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
