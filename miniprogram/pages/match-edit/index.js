const ui=require('../../utils/ui');
const s = require("../shared");
// Unconfirmed creation drafts are process-only and bound to the issuing login.
let pendingCreateDraft = null;
// 仅持久化核对标识，不保存名称、地址、坐标或登录令牌。
function matchGuardKey() {
  const session=s.api.getSession(),origin=session?.serverOrigin;
  if(!origin||!Number.isSafeInteger(session?.user?.id)||!Number.isSafeInteger(session?.team?.id))throw new Error('无法确认比赛管理账号，请重新登录。');
  return 'football.native.match-create-guard.v1:'+encodeURIComponent(origin)+':'+session.user.id+':'+session.team.id;
}
function readMatchGuard(key) {
  const value=wx.getStorageSync(key);
  if(!value)return null;
  if(typeof value!=='object'||typeof value.taskId!=='string'||!value.taskId)throw new Error('比赛核对记录无法读取，请先检查本地存储。');
  return value;
}
function clearMatchGuard(key,taskId) {
  if(readMatchGuard(key)?.taskId===taskId){wx.removeStorageSync(key);if(readMatchGuard(key))throw new Error('无法清除比赛核对提醒，请重新打开核对。');}
}

const formats = [
  { label: "未设置", value: null },
  ...[5, 6, 7, 8, 9, 11].map((value) => ({ label: value + "人制", value })),
];
const sides = [
  { label: "未设置", value: "unknown" },
  { label: "主场", value: "home" },
  { label: "客场", value: "away" },
  { label: "中立场", value: "neutral" },
];
const statuses = [
  { label: "草稿", value: "draft" },
  { label: "发布报名", value: "published" },
  { label: "已完赛", value: "completed" },
  { label: "已取消", value: "cancelled" },
];
Page({openBusinessPicker(e){return require('../../utils/business-picker-bridge').open(this,e);},onHide(){ui.abort(this);this._hidden=true;this._wasShown=true;this._view=(this._view||0)+1;this._epoch=(this._epoch||0)+1;},
  async onShow(){
    this._hidden=false;
    if(!this._wasShown){this._wasShown=true;if(!pendingCreateDraft?.inFlight)return;}
    const owner=s.api.getSession()?.token,view=this._view||0;
    const op=this._saveAttempt||(pendingCreateDraft?.token===owner?pendingCreateDraft.operation:null);
    if(op?.owner===owner&&op.done)await op.done;
    if(this._hidden||this._disposed||(this._view||0)!==view||s.api.getSession()?.token!==owner)return;
    if(this._formToken&&this._formToken!==owner){
      this._saveAttempt=null;
      this.setData({form:{opponent:'',competition:'',date:'',kickoff:'',location:'',maxParticipants:'',homeScore:'',awayScore:'',analysis:''},savedId:null,busy:false,uncertain:false,conflict:false});
      return this.refresh();
    }
    const saved=(!this.id&&pendingCreateDraft?.token===owner?pendingCreateDraft.savedId:null)||(op?.owner===owner?op.savedId:null);
    if(saved){this.setData({savedId:saved,busy:false,loading:false,error:'',uncertain:false,actionError:'比赛已保存，请进入详情核对。'});return;}
    if(op?.owner===owner){this.setData({busy:false,uncertain:!!(!this.id&&pendingCreateDraft),conflict:!!op.conflict,actionError:op.error||''});}
    if(this.data.loading)return this.refresh();
  },
  data: {
    loading: true,
    editing: false,
    error: "",
    busy: false,
    actionError: "",
    conflict: false,
    uncertain: false,
    revision: null,
    savedId: null,
    formats,
    sides,
    statuses,
    seasons: [],
    venues: [],
    venueIndex: 0,
    formatIndex: 0,
    sideIndex: 0,
    statusIndex: 0,
    seasonIndex: 0,
    form: {
      opponent: "",
      competition: "",
      maxParticipants: "",
      date: "",
      kickoff: "",
      location: "",
      homeScore: "",
      awayScore: "",
      analysis: "",
    },
  },
  onLoad(q) {
    this._hidden=false;this._view=0;
    this.id = q.id;
    this.setData({ editing: !!q.id });
    this.refresh();
  },
  onUnload(){this.onHide();return s.unload.apply(this,arguments);},
  refresh() {
    this._formToken=s.api.getSession()?.token;
    return s.load(this, async (session) => {
      if (session.user.role !== "admin")
        throw new Error("仅管理员可以编辑比赛");
      const privateSession = s.api.getSession();
      const draftOwner = JSON.stringify([
        session.user.id,
        session.user.teamId,
        privateSession?.expiresAt,
      ]);
      const draft =
        !this.id &&
        pendingCreateDraft?.owner === draftOwner &&
        pendingCreateDraft.token === privateSession?.token
          ? pendingCreateDraft
          : null;
      if (
        pendingCreateDraft &&
        (pendingCreateDraft.owner !== draftOwner ||
          pendingCreateDraft.token !== privateSession?.token)
      )
        pendingCreateDraft = null;
      this._guardKey=matchGuardKey();
      const guard=!this.id?readMatchGuard(this._guardKey):null;
      const seasons = [
        { id: null, name: "未分配赛季" },
        ...(await s.api.request("/seasons")),
      ];
      const m = this.id
        ? await s.api.request("/matches/" + encodeURIComponent(this.id))
        : null;
      const venueId=m?.venueId??draft?.venueId??null;
      const allVenues=await s.api.request('/venues');
      const label=v=>[v.name,v.fieldNumber].filter(Boolean).join(' · ');
      const venues=[{id:null,displayName:'不关联球场 / 手填地点'},...allVenues.filter(v=>v.status==='active'||v.id===venueId).map(v=>({...v,displayName:label(v)}))];
      if(m?.venueId){const index=venues.findIndex(v=>v.id===m.venueId);if(index>0)venues[index]={...venues[index],displayName:label(m.venueSnapshot||venues[index])+'（本场留存）',locationLabel:m.location};}
      if(venueId && !venues.some(v=>v.id===venueId))venues.push({id:venueId,displayName:label(m?.venueSnapshot||{name:'历史球场'})+'（本场留存）',locationLabel:m?.location});
      return {
        venues,
        venueIndex:Math.max(0,venues.findIndex(v=>v.id===venueId)),
        draftOwner,
        uncertain: (!!draft&&!draft.savedId)||!!guard,
        savedId:draft?.savedId||null,
        revision: m?.revision ?? null,
        dateLabel: m
          ? s.dateLabel(m.date)
          : draft
            ? s.dateLabel(draft.form.date)
            : "",
        seasons,
        form: m
          ? {
              opponent: m.opponent,
              competition: m.competition,
              maxParticipants: m.maxParticipants == null ? "" : String(m.maxParticipants),
              date: m.date,
              kickoff: m.kickoff,
              location: m.location,
              homeScore: m.homeScore == null ? "" : String(m.homeScore),
              awayScore: m.awayScore == null ? "" : String(m.awayScore),
              analysis: m.analysis,
            }
          : draft
            ? { ...draft.form }
            : this.data.form,
        formatIndex: Math.max(
          0,
          formats.findIndex((f) => f.value === (m?.format ?? draft?.format)),
        ),
        sideIndex: Math.max(
          0,
          sides.findIndex((f) => f.value === (m?.side ?? draft?.side)),
        ),
        statusIndex: Math.max(
          0,
          statuses.findIndex((f) => f.value === (m?.status ?? draft?.status)),
        ),
        seasonIndex: Math.max(
          0,
          seasons.findIndex((f) => f.id === (m?.seasonId ?? draft?.seasonId)),
        ),
        conflict: false,
        actionError: draft?.savedId?"比赛已保存，请进入详情核对。":draft ? "上次创建结果尚未确认，请先核对赛程。" : guard ? "上次比赛创建结果待核对，请先查看赛程和草稿。" : "",
      };
    });
  },
  input(e) {
    if (this.data.busy) return;
    const key = e.currentTarget.dataset.field;
    this.setData({ ["form." + key]: e.detail.value });
  },
  pick(e) {
    if (this.data.busy) return;
    const key=e.currentTarget.dataset.field;const index=Number(e.detail.value);
    this.setData({ [key]: index });
    if(key==='venueIndex'&&this.data.venues[index]?.id){const v=this.data.venues[index];this.setData({'form.location':v.locationLabel??[v.name,v.fieldNumber,v.address].filter(Boolean).join(' · ').slice(0,500)});}
  },
  date(e) {
    this.setData({
      "form.date": e.detail.value,
      dateLabel: s.dateLabel(e.detail.value),
    });
  },
  time(e) {
    this.setData({ "form.kickoff": e.detail.value });
  },
  clearTime() {
    this.setData({ "form.kickoff": "" });
  },
  reload() {
    ui.showModal(this,{
      title: "重新载入最新比赛",
      content: "这会丢弃本页尚未保存的修改。是否继续？",
      success: (r) => {
        if (r.confirm) this.refresh();
      },
    });
  },
  checkSchedule() {
    wx.switchTab({ url: "/pages/schedule/index" });
  },
  confirmAbsent() {this.confirmRecovery(false);},
  confirmExists() {this.confirmRecovery(true);},
  confirmRecovery(exists) {
    if(this.data.busy||this._hidden||this._disposed||!this.data.uncertain||this.id||this.data.savedId)return;
    let key,guard;
    try{key=matchGuardKey();guard=readMatchGuard(key);}catch(e){this.setData({actionError:e.message});return;}
    const attempt = pendingCreateDraft;
    const token = s.api.getSession()?.token;
    if(this._hidden||this._disposed||(attempt&&attempt.token!==token))return;
    if(attempt?.savedId){this.setData({savedId:attempt.savedId,uncertain:false,actionError:"比赛已保存，请进入详情核对。"});return;}
    if (attempt?.inFlight) {
      this.setData({ actionError: "上次创建仍在处理中，请等待结果后再核对。" });
      return;
    }
    if (attempt && attempt.token !== token) return;
    ui.showModal(this,{
      title: exists ? "确认比赛已存在" : "确认未创建比赛",
      content: exists ? "确认已在赛程或草稿找到上次比赛？仅解除提醒，不会修改或创建比赛。" : "请先核对赛程和草稿。仅在确认没有上次比赛时继续，避免重复创建。",
      success: (result) => {
        if (result.confirm && !this._disposed && pendingCreateDraft === attempt && !attempt?.inFlight && !attempt?.savedId && !this._hidden && s.api.getSession()?.token === token) {
          try{
            if(key!==matchGuardKey()||readMatchGuard(key)?.taskId!==guard?.taskId)throw new Error('核对账号或任务已变化，请重新打开比赛核对。');
            if(guard)clearMatchGuard(key,guard.taskId);
            pendingCreateDraft = null;
            this.setData({ uncertain: false, actionError: "" });
            if(exists)this.checkSchedule();
          }catch(e){this.setData({actionError:e.message});}
        }
      },
    });
  },
  async save() {
    if (this._hidden || this._disposed || this.data.savedId || this.data.busy || this.data.conflict || this.data.uncertain) return;
    if (!this.id && pendingCreateDraft && pendingCreateDraft.token === s.api.getSession()?.token) {
      this.setData({ uncertain: true, actionError: pendingCreateDraft.inFlight ? "上次创建仍在处理中，请等待结果。" : "上次创建结果尚未确认，请先核对赛程。" });
      return;
    }
    const f = this.data.form;
    if (!f.opponent.trim() || !f.date) {
      this.setData({ actionError: "请填写对手并选择比赛日期" });
      return;
    }
    for (const key of ["homeScore", "awayScore"])
      if (f[key] !== "" && !/^\d+$/.test(f[key])) {
        this.setData({ actionError: "比分请填写非负整数，未知时留空" });
        return;
      }
    const capacity = String(f.maxParticipants ?? "").trim();
    if (capacity && (!/^\d+$/.test(capacity) || Number(capacity) < 1 || Number(capacity) > 10000)) {
      this.setData({ actionError: "报名人数请填写 1 至 10000 的整数，留空表示不限" });
      return;
    }
    const payload = {
      ...f,
      maxParticipants: capacity ? Number(capacity) : null,
      opponent: f.opponent.trim(),
      homeScore: f.homeScore === "" ? null : Number(f.homeScore),
      awayScore: f.awayScore === "" ? null : Number(f.awayScore),
      format: formats[this.data.formatIndex].value,
      side: sides[this.data.sideIndex].value,
      status: statuses[this.data.statusIndex].value,
      seasonId: this.data.seasons[this.data.seasonIndex].id,
      venueId: this.data.venues[this.data.venueIndex]?.id??null,
    };
    if (this.id) payload.revision = this.data.revision;
    const submissionToken = s.api.getSession()?.token;
    const operation={owner:submissionToken,view:this._view||0,savedId:null};
    operation.done=new Promise(resolve=>{operation.resolve=resolve;});
    this._saveAttempt=operation;
    const active=()=>this._saveAttempt===operation&&!this._disposed&&!this._hidden&&(this._view||0)===operation.view&&s.api.getSession()?.token===submissionToken;
    const attempt = !this.id ? {
      owner: this.data.draftOwner,
      token: submissionToken,
      form: { ...f },
      format: payload.format,
      side: payload.side,
      status: payload.status,
      seasonId: payload.seasonId,
      venueId: payload.venueId,
      inFlight: true,
      operation,
    } : null;
    let dispatched=false;
    this.setData({ busy: true, actionError: "" });
    try {
      if(attempt){
        const key=matchGuardKey();this._guardKey=key;
        if(readMatchGuard(key)){this.setData({uncertain:true,actionError:'上次比赛创建结果待核对，请先查看赛程和草稿。'});return;}
        const taskId=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
        wx.setStorageSync(key,{taskId,createdAt:Date.now()});
        if(readMatchGuard(key)?.taskId!==taskId)throw new Error('无法保存比赛核对记录，未发起创建。');
        attempt.guardKey=key;attempt.taskId=taskId;pendingCreateDraft=attempt;
      }
      dispatched=true;
      const result = await s.api.request(
        this.id ? "/matches/" + encodeURIComponent(this.id) : "/matches",
        this.id ? "PUT" : "POST",
        payload,
      );
      if(!Number.isSafeInteger(result?.id)||result.id<1||(this.id&&String(result.id)!==String(this.id)))throw new Error('保存响应编号异常，请先核对比赛结果。');
      if(attempt)clearMatchGuard(attempt.guardKey,attempt.taskId);
      operation.savedId=result.id;
      if(attempt&&pendingCreateDraft===attempt){attempt.savedId=result.id;attempt.inFlight=false;}
      if(active()){
        this.setData({savedId:result.id,uncertain:false,actionError:'比赛已保存，请进入详情核对。'});
        this.openSaved();
      }
    } catch (error) {
      const status = error.status || error.statusCode || 0;
      let uncertain = !this.id && dispatched && (error.staleSession===true || status === 0 || status >= 500);
      if(attempt&&dispatched&&!uncertain){try{clearMatchGuard(attempt.guardKey,attempt.taskId);}catch(_){uncertain=true;}}
      if (attempt && pendingCreateDraft === attempt) {
        if (uncertain) attempt.inFlight = false;
        else pendingCreateDraft = null;
      }
      operation.conflict=status===409||!!(this.id&&(status===0||status>=500));
      operation.error=error.message||"保存结果需要核对";
      // 当前请求 401 会清空会话，但仍须结束本页等待；旧视图/旧账号不接管。
      if (status === 401 && error.staleSession !== true && !s.api.getSession() &&
          this._saveAttempt === operation && !this._disposed && !this._hidden &&
          (this._view || 0) === operation.view) {
        this.setData({ busy: false, uncertain: false, actionError: error.message || "登录已过期" });
        s.fail(this, error);
        return;
      }
      if (active()) {
        const conflict = operation.conflict;
        this.setData({
          conflict,
          uncertain,
          actionError: uncertain
            ? "提交结果未确认，比赛可能已创建。请先核对赛程和草稿；确认未创建后，点“已核对，继续编辑”。"
            : conflict
              ? "比赛已被其他人修改。你的输入已保留，请核对后重新载入再编辑。"
              : error.message || "保存失败，请重试",
        });
        if ((error.status || error.statusCode) === 401) s.fail(this, error);
      }
    } finally {
      if(attempt)attempt.inFlight=false;
      operation.resolve();
      if (active()) this.setData({ busy: false });
    }
  },
  openSaved(){
    const id=this.data.savedId,owner=s.api.getSession()?.token,view=this._view||0;
    if(this._hidden||this._disposed||(this._formToken&&this._formToken!==owner)||!Number.isSafeInteger(id)||id<1||this._saveAttempt?.owner&&this._saveAttempt.owner!==owner)return;
    const draft=pendingCreateDraft;
    wx.redirectTo({url:'/pages/match-detail/index?id='+id,success:()=>{if(draft&&pendingCreateDraft===draft&&draft.token===owner&&draft.savedId===id)pendingCreateDraft=null;},fail:()=>{if(!this._hidden&&!this._disposed&&(this._view||0)===view&&s.api.getSession()?.token===owner)this.setData({actionError:'比赛已保存，但未能打开详情。请点击“进入已保存比赛”，不要重新创建。'});}});
  },

});
