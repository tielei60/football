const ui=require('../../utils/ui');
const s = require("../shared");
Page({
  openPhotos() {
    const loaded = this._photoContext;
    const current = s.api.getSession();
    if (this._disposed || this._hidden || this.data.loading || this.data.error || this.data.busy ||
        !loaded || !current || !current.token || loaded.token !== current.token ||
        loaded.origin !== current.serverOrigin || loaded.userId !== current.user.id ||
        loaded.teamId !== current.team.id || loaded.playerId !== this.id ||
        this.data.player?.id !== loaded.playerId) return;
    wx.navigateTo({url:'/pages/player-photos/index?id='+encodeURIComponent(loaded.playerId)});
  },
onHide(){ui.abort(this);return s.hide.apply(this,arguments);},
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
    const year=q.year,season=q.seasonId,all=q.all;
    if([year,season,all].filter(v=>v!==undefined).length>1)this._scopeError='请选择一种统计范围。';
    else if(all!==undefined){if(all!=='1')this._scopeError='统计范围不正确。';else this._scope='all=1';}
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
    this._photoContext = null;
    return s.load(this, async (session) => {
      const epoch = this._epoch;
      const playerId = this.id;
      const current = s.api.getSession();
      if (!current || !current.token || current.user.id !== session.user.id || current.team.id !== session.team.id)
        throw Object.assign(new Error('登录状态已改变，请重新加载。'), {staleSession:true});
      const context = {token:current.token,origin:current.serverOrigin,userId:current.user.id,teamId:current.team.id,playerId};
      if(this._scopeError)throw new Error(this._scopeError);
      const [players, stats] = await Promise.all([
        s.api.request("/players"),
        s.api.request("/statistics?" + (this._scope||"year="+this.data.year)),
      ]);
      const p = players.find((p) => p.id === playerId);
      if (!p) throw new Error("未找到此球员，可能已不在当前球队");
      const r = stats.players.find((p) => p.playerId === playerId);
      // Navigation belongs to the identity and player that produced this view.
      // Keep credentials private, never put them through setData.
      const latest = s.api.getSession();
      if (!latest || latest.token !== context.token || latest.serverOrigin !== context.origin ||
          latest.user.id !== context.userId || latest.team.id !== context.teamId)
        throw Object.assign(new Error('登录状态已改变，请重新加载。'), {staleSession:true});
      if (epoch === this._epoch && !this._disposed) this._photoContext = context;
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
