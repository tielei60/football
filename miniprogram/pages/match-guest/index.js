const guest = require('../../utils/match-guest-api');
const s = require('../shared');
const registrationRecovery='上次报名结果尚未核对，请重新微信登录确认。';
// 只保留本进程未核对写入；以签发源、会话、比赛隔离，不落盘私人凭据。
const pendingWrites=new Map();
Page({
  data:{loading:true,error:'',busy:false,match:null,profileRequired:false,realName:'',nickname:'',avatarPath:'',actionError:'',response:'',responseLabel:'未回应',authenticated:false,member:false,replyPending:false},
  onLoad(q){this._credential=guest.validInvite(q.shareToken)?q.shareToken:'';},
  onShow(){this._hidden=false;return this.refresh();},
  onHide(){
    this._replyAttempt=null;this._hidden=true;this._epoch=(this._epoch||0)+1;
    if(this._enrolling)this.resetRegistration(registrationRecovery);
    this.setData({busy:false});
  },
  onUnload(){this.onHide();this._disposed=true;this._registration=null;this._requestId=null;this._avatar='';},
  active(epoch){return !this._hidden&&!this._disposed&&epoch===this._epoch;},
  resetRegistration(actionError=''){
    this._registration=null;this._registrationExpires=0;this._requestId=null;this._avatar='';this._avatarTurn=(this._avatarTurn||0)+1;
    this.setData({profileRequired:false,realName:'',nickname:'',avatarPath:'',actionError});
  },
  async refresh(){
    const epoch=this._epoch=(this._epoch||0)+1;
    this.setData({loading:true,error:''});
    try {
      if(!this._credential)throw new Error('比赛邀请无效，请重新打开分享卡片');
      const member=s.api.getSession();
      const registration=!member&&guest.pendingRegistration(this._credential);
      if(registration){
        this.resetRegistration(registrationRecovery);
        this.setData({busy:false});
        await registration;
        if(!this.active(epoch))return;
      }
      const key=guest.identityKey(this._credential,member?.token), pending=pendingWrites.get(key);
      this.setData({replyPending:!!pending});
      if(pending)await pending.done;
      if(!this.active(epoch))return;
      if(s.api.getSession()?.token!==member?.token)throw new Error('登录身份已变化，请刷新比赛');
      const result=member?await s.api.request('/guest-matches/'+this._credential):await guest.request(this._credential);
      if(this.active(epoch)&&s.api.getSession()?.token!==member?.token)throw new Error('登录身份已变化，请刷新比赛');
      if(this.active(epoch)){
        if(pending&&pendingWrites.get(key)===pending)pendingWrites.delete(key);
        this.setData({replyPending:false});this._memberOwner=member?.token||null;
        const authenticated=!!member||!!guest.session(this._credential);
        if(authenticated&&(registration||this.data.profileRequired))this.resetRegistration();
        this.applyMatch(result,authenticated);
      }
    } catch(e){if(this.active(epoch))this.setData({error:e.message||'无法读取比赛，请重试'});}
    finally{if(this.active(epoch))this.setData({loading:false});}
  },
  applyMatch(raw,authenticated){
    // 公开接口不含球队名册、战术或其他人的报名信息。
    const match={id:raw.id,opponent:raw.opponent,competition:raw.competition,dateLabel:s.dateLabel(raw.date),kickoff:raw.kickoff||'时间待定',location:raw.location||raw.venueSnapshot?.name||'地点待定',notice:raw.notice||'',status:raw.status,statusLabel:({published:'待比赛',completed:'已完赛',cancelled:'已取消'})[raw.status]||'',canReply:raw.canReply===true,canJoin:raw.canJoin!==false,canRegister:raw.canRegister===true,teamName:raw.team?.name||'球队',teamCrest:s.assetUrl(raw.team?.crest),opponentCrest:s.assetUrl(raw.opponentSnapshot?.logo),yesCount:Number(raw.yesCount)||0,maxParticipants:raw.maxParticipants};
    this.setData({match,authenticated,member:!!this._memberOwner,response:raw.myResponse||'',responseLabel:s.replies[raw.myResponse]||'未回应'});
  },
  realName(e){if(!this.data.busy)this.setData({realName:String(e.detail.value||'').slice(0,40)});},
  nickname(e){if(!this.data.busy)this.setData({nickname:String(e.detail.value||'').slice(0,80)});},
  async chooseAvatar(e){
    if(this.data.busy)return;
    const path=e.detail?.avatarUrl, turn=this._avatarTurn=(this._avatarTurn||0)+1;
    try{const data=await guest.avatarData(path);if(!this._disposed&&turn===this._avatarTurn){this._avatar=data;this.setData({avatarPath:path,actionError:''});}}
    catch(error){if(!this._disposed&&turn===this._avatarTurn)this.setData({actionError:error.message});}
  },
  avatarError(){this._avatar='';this.setData({avatarPath:''});},
  crestError(e){const key=e.currentTarget.dataset.key;if(['teamCrest','opponentCrest'].includes(key))this.setData({['match.'+key]:''});},
  async login(){
    if(this._hidden||this._disposed||this.data.busy||this.data.loading||this.data.error||!this.data.match)return;
    if(s.api.getSession()){this.setData({actionError:'登录身份已变化，请刷新比赛'});return;}
    const epoch=this._epoch;
    this.setData({busy:true,actionError:''});
    try{
      const result=await guest.login(this._credential,()=>this.active(epoch)&&!s.api.getSession());
      if(!this.active(epoch))return;
      if(result.needsProfile){
        this.resetRegistration();
        this._registration=result.registrationToken;this._registrationExpires=result.expiresAt;
        this.setData({profileRequired:true});
      }
      else {this.resetRegistration();this.applyMatch(result.match,true);}
    }catch(e){if(this.active(epoch))this.setData({actionError:e.message||'微信登录未完成'});}
    finally{if(this.active(epoch))this.setData({busy:false});}
  },
  restartLogin(){if(this._hidden||this._disposed||this.data.busy||this.data.loading)return;this.resetRegistration();return this.login();},
  async register(){
    if(this._hidden||this._disposed||this.data.busy||this.data.loading||this.data.error||this.data.authenticated||!this.data.profileRequired)return;
    if(s.api.getSession()){this.setData({actionError:'登录身份已变化，请刷新比赛'});return;}
    if(guest.session(this._credential)){this.resetRegistration();return this.refresh();}
    if(!this._registration||this._registrationExpires<=Date.now()){this.resetRegistration('登记已过期，请重新微信登录');return;}
    const realName=this.data.realName.trim(),nickname=this.data.nickname.trim();
    if(!realName||!nickname||!this._avatar){this.setData({actionError:'请填写真实姓名、微信昵称并选择头像'});return;}
    const epoch=this._epoch;
    this._requestId=this._requestId||'guest-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
    const attempt={};this._enrolling=attempt;
    this.setData({busy:true,actionError:''});
    try{
      if(guest.pendingRegistration(this._credential)){this.resetRegistration(registrationRecovery);return;}
      const result=await guest.register(this._credential,{registrationToken:this._registration,requestId:this._requestId,realName,nickname,avatar:this._avatar},()=>this.active(epoch)&&!s.api.getSession());
      if(!this.active(epoch))return;
      this.resetRegistration();this.applyMatch(result.match,true);
    }catch(e){if(this.active(epoch)){
      if(!e.status||e.status>=500)this.resetRegistration(registrationRecovery);
      else if(e.status===401)this.resetRegistration(e.message);
      else this.setData({actionError:e.message});
    }}
    finally{if(this._enrolling===attempt){this._enrolling=null;if(this.active(epoch))this.setData({busy:false});}}
  },
  async reply(e){
    const response=e.currentTarget.dataset.response;
    if(!['yes','no','maybe'].includes(response)||this.data.busy||this.data.loading||this.data.error||this.data.replyPending||!this.data.authenticated||!this.data.match?.canReply)return;
    if(response===this.data.response)return;
    if(response==='yes'&&this.data.match.canJoin===false){this.setData({actionError:'本场比赛已停止新增参加报名'});return;}
    const epoch=this._epoch, owner=this._memberOwner, attempt={};
    this._replyAttempt=attempt;
    if((s.api.getSession()?.token||null)!==(owner||null)){this.setData({actionError:'登录已变化，请重新打开比赛'});return;}
    const key=guest.identityKey(this._credential,owner);
    if(pendingWrites.has(key)){this.setData({replyPending:true,actionError:'上一条报名正在核对，请稍候'});return;}
    this.setData({busy:true,replyPending:true,actionError:''});
    const entry={};pendingWrites.set(key,entry);
    const write=Promise.resolve(owner?s.api.request('/guest-matches/'+this._credential+'/rsvp','PUT',{response}):guest.request(this._credential,'/rsvp','PUT',{response}));
    entry.done=write.then(()=>undefined,()=>undefined);
    try{const raw=await write;
      if(pendingWrites.get(key)===entry)pendingWrites.delete(key);
      if(this.active(epoch)&&(!owner||s.api.getSession()?.token===owner)){this.setData({replyPending:false});this.applyMatch(raw,true);}
    }catch(e){if(this.active(epoch)){this.setData({actionError:e.message||'报名结果未确认，请刷新核对'});await this.refresh();}}
    finally{if(this._replyAttempt===attempt){this._replyAttempt=null;if(!this._disposed&&!this._hidden)this.setData({busy:false});}}
  },
  openMember(){if(this._memberOwner&&s.api.getSession()?.token===this._memberOwner&&this.data.match?.id)wx.navigateTo({url:'/pages/match-detail/index?id='+encodeURIComponent(this.data.match.id)});},
});
