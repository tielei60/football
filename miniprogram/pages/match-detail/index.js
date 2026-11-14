const ui=require('../../utils/ui');
const s = require("../shared");
const location = require("../../utils/location");
// Same-process, same-session serialization. This is not a multi-device CAS.
const pendingReplies=new Map();
const replyKey=(token,id)=>JSON.stringify([token,String(id)]);
function settleReply(entry,error){
  if(entry.settled)return;
  entry.settled=true;entry.error=error||null;entry.resolve();
  const status=error?.status||error?.statusCode;
  if(((status>=400&&status<500)||s.api.getSession()?.token!==entry.owner)&&pendingReplies.get(entry.key)===entry)pendingReplies.delete(entry.key);
}
Page({onHide(){this._hidden=true;this._replyAttempt=null;this._epoch=(this._epoch||0)+1;this.setData({busy:false});ui.abort(this);},
  data: {
    loading: true,
    error: "",
    match: null,
    team: {},
    admin: false,
    canReply: false,
    busy: false,
    replyPending:false,
    reconciling:false,
    actionError: "",
    replies: [],
    roster: [],
    snapshots: [],
    venueLocation: location.matchVenue(null),
    hasLocation:false,
  },
  onLoad(q) {
    this.id = q.id;
  },
  onShow() {
    this._hidden=false;
    this.refresh();
  },
  onPullDownRefresh() {
    if (!this.data.busy) this.refresh();
    else wx.stopPullDownRefresh();
  },
  onUnload(){ui.abort(this);return s.unload.apply(this,arguments);},
  imageError: s.imageError,
  async refresh() {
    const expected=(this._epoch||0)+1;
    const pending=pendingReplies.get(replyKey(s.api.getSession()?.token,this.id));
    this.setData({replyPending:!!pending,reconciling:!!pending});
    await s.load(this, async (session) => {
      const owner=s.api.getSession()?.token;
      const active=()=>!this._hidden&&!this._disposed&&this._epoch===expected&&s.api.getSession()?.token===owner;
      if(pending)await pending.done;
      if(!active())throw new Error('页面或登录已变化，请重新打开比赛。');
      const [raw, players] = await Promise.all([
        s.api.request("/matches/" + encodeURIComponent(this.id)),
        s.api.request("/players"),
      ]);
      if(!active())throw new Error('页面或登录已变化，请重新打开比赛。');
      const match = s.matchView(raw, session.user.playerId, true);
      let cover="";
      if(raw.coverPhotoId){try{const photo=await s.api.request("/matches/"+encodeURIComponent(this.id)+"/photos/"+raw.coverPhotoId);cover=s.assetUrl(photo.dataUrl);}catch(e){if(e.status===401)throw e;}}
      if(!active())throw new Error('页面或登录已变化，请重新打开比赛。');
      if(pending&&pending.settled&&pendingReplies.get(pending.key)===pending)pendingReplies.delete(pending.key);
      const byId = new Map(players.map((p) => [p.id, p]));
      return {
        match,
        replyPending:false,
        reconciling:false,
        cover,
        notice:raw.notice||"",
        hasLocation:!!location.point(raw.venueSnapshot),
        venueLocation:location.matchVenue(raw),
        team: { name: session.team.name },
        admin: session.user.role === "admin",
        canReply:
          session.user.role === "player" &&
          !!session.user.playerId &&
          match.status === "published",
        replies: raw.rsvps.map((r) => ({
          playerId: r.playerId,
          name: byId.get(r.playerId)?.name || "历史成员",
          label: s.replies[r.response],
        })),
        roster: raw.roster.map((r) => ({
          playerId: r.playerId,
          position: r.position,
          snapshotSource: r.snapshotSource,
          name: r.playerSnapshot?.name || "历史身份未记录",
          number: s.value(r.playerSnapshot?.number),
          selectionLabel:
            { starter: "首发", bench: "替补", unknown: "未确定" }[
              r.selection
            ] || "未确定",
          appearedLabel:
            r.appeared === true
              ? "已出场"
              : r.appeared === false
                ? "未出场"
                : "出场待确认",
          goalsLabel: s.value(r.goals),
          assistsLabel: s.value(r.assists),
        })),
        snapshots: (raw.tacticSnapshots || []).map((t) => ({
          id: t.sourceTacticId,
          name: t.tactic?.name || t.tactic?.title || "比赛战术",
          source: t.captureSource === "migration" ? "迁移时留存" : "关联时留存",
        })),
      };
    });
    if(expected===this._epoch&&!this._disposed&&!this._hidden)this.setData({reconciling:false});
  },
  media(){wx.navigateTo({url:"/pages/match-media/index?id="+encodeURIComponent(this.id)});},
  tactic(e){wx.navigateTo({url:"/pages/tactic-board/index?matchId="+encodeURIComponent(this.id)+"&sourceId="+encodeURIComponent(e.currentTarget.dataset.id)});},
  rosterEdit(){if(this.data.admin)wx.navigateTo({url:'/pages/match-roster/index?id='+encodeURIComponent(this.id)});},
  async openLocation(){
    if(this.data.loading||this.data.error||this._hidden||this._disposed||this._openingLocation)return;
    const snapshot=this.data.match?.venueSnapshot, info=location.matchVenue(this.data.match);
    if(!info.valid){this.setData({actionError:info.message});return;}
    const epoch=this._epoch,owner=s.api.getSession()?.token,attempt={};this._openingLocation=attempt;
    try{await location.open(snapshot);}catch(e){if(!this._disposed&&!this._hidden&&epoch===this._epoch&&owner===s.api.getSession()?.token)this.setData({actionError:e.message});}
    finally{if(this._openingLocation===attempt)this._openingLocation=null;}
  },
  edit() {
    wx.navigateTo({
      url: "/pages/match-edit/index?id=" + encodeURIComponent(this.id),
    });
  },
  async reply(e) {
    if(this._hidden||this._disposed||this.data.busy||!this.data.canReply)return;
    const response=e.currentTarget.dataset.response;
    if(!['yes','no','maybe'].includes(response)||response===this.data.match.response)return;
    const session=s.api.getSession();if(!session)return;
    const key=replyKey(session.token,this.id);
    if(pendingReplies.has(key)){await this.refresh();return;}
    const entry={key,owner:session.token,settled:false};entry.done=new Promise(resolve=>{entry.resolve=resolve;});
    pendingReplies.set(key,entry);
    const attempt={owner:session.token,epoch:(this._epoch||0)+1};
    this._epoch=attempt.epoch;this._replyAttempt=attempt;
    const visible=()=>this._replyAttempt===attempt&&!this._disposed&&!this._hidden&&this._epoch===attempt.epoch;
    const owned=()=>visible()&&s.api.getSession()?.token===attempt.owner;
    this.setData({busy:true,replyPending:true,actionError:''});
    try{
      await s.api.request('/matches/'+encodeURIComponent(this.id)+'/rsvp','PUT',{response});
      settleReply(entry);
      if(!owned())return;
      const refreshing=this.refresh();attempt.epoch=this._epoch;
      await refreshing;
      if(owned()&&!this.data.error)ui.showToast(this,{title:'报名状态已更新',icon:'success'});
    }catch(error){
      settleReply(entry,error);
      const status=error.status||error.statusCode;
      if(!visible()||!(s.api.getSession()?.token===attempt.owner||(status===401&&!s.api.getSession())))return;
      this.setData({replyPending:pendingReplies.get(key)===entry,actionError:(!status||status>=500)?'报名结果尚未确认，请先核对报名状态。':error.message||'更新失败，请重试'});
      if(status===401)s.fail(this,error);
    }finally{
      if(this._replyAttempt===attempt){this._replyAttempt=null;const current=s.api.getSession();if(!this._disposed&&!this._hidden&&(!current||current.token===attempt.owner))this.setData({busy:false});}
    }
  },
});
