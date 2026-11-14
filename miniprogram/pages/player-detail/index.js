const ui=require('../../utils/ui');
const s = require("../shared");
Page({onHide(){ui.abort(this);return s.hide.apply(this,arguments);},
  data: {
    loading: true,
    error: "",
    player: null,
    record: null,
    year: new Date().getFullYear(),
    scopeLabel: "",
  },
  onLoad(q) {
    this.id = q.id;
    this._scopeError='';
    const year=q.year,season=q.seasonId;
    if(year!==undefined&&season!==undefined)this._scopeError='请选择年份或赛季其中一种统计范围。';
    else if(season!==undefined){
      if(!/^[1-9]\d*$/.test(String(season))||!Number.isSafeInteger(Number(season)))this._scopeError='赛季编号不正确。';
      else this._scope='seasonId='+encodeURIComponent(season);
    }else if(year!==undefined){
      if(!/^\d{4}$/.test(String(year))||Number(year)<1900||Number(year)>9999)this._scopeError='统计年份不正确。';
      else {this._scope='year='+year;this.setData({year:Number(year)});}
    }else this._scope='year='+this.data.year;
  },
  onShow() {
    this.refresh();
  },
  onPullDownRefresh() {
    this.refresh();
  },
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  imageError: s.imageError,
  refresh() {
    return s.load(this, async () => {
      if(this._scopeError)throw new Error(this._scopeError);
      const [players, stats] = await Promise.all([
        s.api.request("/players"),
        s.api.request("/statistics?" + (this._scope||"year="+this.data.year)),
      ]);
      const p = players.find((p) => p.id === this.id);
      if (!p) throw new Error("未找到此球员，可能已不在当前球队");
      const r = stats.players.find((p) => p.playerId === this.id);
      return {
        player: s.playerView(p),
        scopeLabel: String(stats.filter?.label || "统计范围"),
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
