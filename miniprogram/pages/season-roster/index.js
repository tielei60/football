const ui=require('../../utils/ui');
const s = require('../shared');
const clone = x => JSON.parse(JSON.stringify(x));
function row(saved, player) {
 return { playerId: saved?.playerId || player.id, name: saved?.name ?? player?.name ?? '历史成员',
 number: (saved ? saved.number : player?.number) == null ? '' : String(saved ? saved.number : player.number),
 positions: (saved?.positions || player?.positions || []).join(' / '),
 status: player?.status || 'unknown', historical: !!saved };
}
Page({openBusinessPicker(e){return require('../../utils/business-picker-bridge').open(this,e);},
 data: {loading:true,error:'',busy:false,conflict:false,actionError:'',admin:false,name:'',revision:null,rows:[],players:[],candidates:[],candidateIndex:0},
 onLoad(q) {this.id=q.id;this._first=true;this.refresh();},
 onHide() {ui.abort(this);this._hidden=true;this.setData({loading:true});},
 async onShow() {
  this._hidden=false;
  if(this._first){this._first=false;return;}
  const epoch=this._epoch;
  try {
   const session=await s.api.ensureSession();
   if(this._disposed||this._hidden||epoch!==this._epoch)return;
   // 首次加载尚未建立草稿归属，按发起加载时的账号核对，不能误判为切换账号。
   const owner=this._owner===undefined?this._loadingOwner:this._owner;
   if(owner!==s.api.getSession()?.token){
    this._outcome=null;
    this.setData({admin:false,busy:false,rows:[],players:[],candidates:[],loading:false,error:'登录已变化，请重新打开赛季阵容。'});return;
   }
   const admin=session.user.role==='admin';
   const previousAdmin=this._loadPending?this._loadAdmin:this.data.admin;
   if(previousAdmin!==undefined&&admin!==previousAdmin){
    // 权限变化时重新读服务器；旧编辑草稿不能伪装成已保存的只读阵容。
    this._outcome=null;
    this.setData({admin:false,busy:false,rows:[],players:[],candidates:[],candidateIndex:0});
    return this.refresh();
   }
   if(this._loadPending)return;
   if(!this._loaded)return this.refresh();
   if(this._outcome){const outcome=this._outcome;this._outcome=null;this.applyOutcome(outcome);}
   this.setData({loading:false});
  } catch(e){if(!this._disposed&&!this._hidden&&epoch===this._epoch){this.setData({loading:false});s.fail(this,e);}}
 },
 onUnload(){ui.abort(this);s.unload.call(this);this._outcome=null;this._original=null;},
 async refresh(){
  if(this.data.busy)return;
  let owner, original;
  this._loadingOwner=s.api.getSession()?.token;
  this._loadPending=true;
  const promise=s.load(this,async session=>{
   owner=s.api.getSession()?.token;
   this._loadAdmin=session.user.role==='admin';
   const [result,players]=await Promise.all([s.api.request('/seasons/'+encodeURIComponent(this.id)+'/roster'),s.api.request('/players')]);
   if(owner!==s.api.getSession()?.token)throw new Error("登录已变化，请重新打开页面");
   const projected=players.map(p=>({id:p.id,name:p.name,number:p.number??null,positions:p.positions||[],status:p.status}));
   original=clone(result.roster);
   const rows=result.roster.map(r=>row(r,projected.find(p=>p.id===r.playerId)));
   const admin=session.user.role==='admin';
   return {name:result.season.name,revision:result.season.revision,rows,players:admin?projected:[],admin,
    candidates:admin?this.candidates(rows,projected):[],candidateIndex:0,conflict:false,actionError:''};
  });
  const epoch=this._epoch;
  await promise;
  if(!this._disposed&&epoch===this._epoch){
   this._loadPending=false;
   this._loaded=!this.data.error;
   if(this._loaded){this._owner=owner;this._original=original;}
  }
  if(this._hidden&&!this._disposed)this.setData({loading:true});
 },
 candidates(rows,players=this.data.players){
  const ids=new Set(rows.map(r=>r.playerId));
  return players.filter(p=>!ids.has(p.id)).map(p=>({id:p.id,label:(p.number??'—')+' · '+p.name+(p.status==='inactive'?' · 已归档':'')}));
 },
 editable(){return this.data.admin&&!this.data.busy&&!this.data.loading&&!this.data.error&&!this.data.conflict&&!this._disposed&&!this._hidden&&this._owner===s.api.getSession()?.token;},
 choose(e){if(this.editable())this.setData({candidateIndex:Number(e.detail.value)});},
 add(){
  if(!this.editable())return;
  const c=this.data.candidates[this.data.candidateIndex],p=this.data.players.find(p=>p.id===c?.id);if(!p)return;
  const saved=(this._original||[]).find(r=>r.playerId===p.id);
  const rows=[...this.data.rows,row(saved,p)];
  s.safeSetData(this,{rows,candidates:this.candidates(rows),candidateIndex:0});
 },
 number(e){
  if(!this.editable())return;
  const index=this.data.rows.findIndex(r=>r.playerId===e.currentTarget.dataset.id);
  if(index>=0)this.setData({['rows['+index+'].number']:e.detail.value});
 },
 remove(e){
  if(!this.editable())return;
  const id=e.currentTarget.dataset.id;
  ui.showModal(this,{title:'移出赛季阵容',content:'保存后移出本赛季阵容，不删除历史比赛数据。移出保存后再加入会采用最新球员资料。',success:r=>{
   if(!r.confirm||!this.editable())return;
   const rows=this.data.rows.filter(r=>r.playerId!==id);
   s.safeSetData(this,{rows,candidates:this.candidates(rows),candidateIndex:0});
  }});
 },
 reload(){
  if(this.data.busy)return;
  ui.showModal(this,{title:'重新载入',content:'未保存的阵容修改将丢弃，是否继续？',success:r=>{if(r.confirm&&!this._disposed&&!this._hidden)this.refresh();}});
 },
 applyOutcome(outcome){
  if(outcome.result){
   const result=outcome.result;
   this._original=clone(result.roster);
   const rows=result.roster.map(r=>row(r,this.data.players.find(p=>p.id===r.playerId)));
   s.safeSetData(this,{rows,revision:result.season.revision,candidates:this.candidates(rows),candidateIndex:0,busy:false,conflict:false,actionError:''});
   ui.showToast(this,{title:'赛季阵容已保存'});
  } else {
   const e=outcome.error;
   this.setData({busy:false,conflict:(e.status||e.statusCode)===409,actionError:(e.status||e.statusCode)===409?'赛季已被修改，输入已保留，请重新载入核对。':e.message||'保存失败'});
   if((e.status||e.statusCode)===401)s.fail(this,e);
  }
 },
 async save(){
  if(!this.editable())return;
  if(this.data.rows.some(r=>r.number!==''&&(!/^\d+$/.test(r.number)||Number(r.number)>9999))){this.setData({actionError:'号码为 0–9999 的整数，未知请留空'});return;}
  const payload={revision:this.data.revision,roster:this.data.rows.map(r=>({playerId:r.playerId,number:r.number===''?null:Number(r.number)}))};
  const epoch=this._epoch,owner=this._owner;
  this.setData({busy:true,actionError:''});
  let outcome;
  try {
   const session=await s.api.ensureSession();
   if(session.user.role!=='admin'||s.api.getSession()?.token!==owner)throw new Error('登录身份已变化，请重新打开页面');
   if(this._disposed||epoch!==this._epoch)return;
   outcome={result:await s.api.request('/seasons/'+encodeURIComponent(this.id)+'/roster','PUT',payload)};
  } catch(error){outcome={error};}
  if(this._disposed||epoch!==this._epoch)return;
  if(owner!==s.api.getSession()?.token){this.setData({busy:false,loading:false,rows:[],players:[],candidates:[],error:'登录身份已变化，请重新打开页面'});return;}
  if(this._hidden)this._outcome=outcome;
  else this.applyOutcome(outcome);
 }
});
