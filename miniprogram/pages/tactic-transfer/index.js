const ui=require('../../utils/ui');
const s=require('../shared');
const transfer=require('../../utils/tactic-transfer');
let pending=null;
function pendingFor(token){if(pending&&pending.token!==token)pending=null;return pending;}
function guardKey(session){
 const origin=session?.serverOrigin||require('../../config').apiBaseUrl;
 const uid=session?.user?.id,team=session?.team?.id;
 if(!Number.isSafeInteger(uid)||!Number.isSafeInteger(team)||!origin)throw new Error('无法确认导入账号，请重新登录。');
 return 'football.native.import-guard.v1:'+encodeURIComponent(origin)+':'+uid+':'+team;
}
function readGuard(key){const value=wx.getStorageSync(key);if(!value)return null;if(typeof value!=='object'||typeof value.taskName!=='string')throw new Error('导入核对记录无法读取，请先检查本地存储。');return value;}
function writeGuard(key,taskName){wx.setStorageSync(key,{taskName,createdAt:Date.now()});if(readGuard(key)?.taskName!==taskName)throw new Error('无法保存导入核对记录，未发起导入。');}
function clearGuard(key,taskName){if(readGuard(key)?.taskName===taskName){wx.removeStorageSync(key);if(readGuard(key))throw new Error('无法清除核对记录，请重新打开后核对。');}}
function name(){return 'native-import-'+Date.now().toString(36)+'-'+Array.from({length:4},()=>Math.random().toString(36).slice(2)).join('');}
Page({
 data:{loading:true,error:'',admin:false,busy:false,actionError:'',message:'',fileName:'',tacticCount:0,versionCount:0,pending:false,exportReady:false,recoveryBlocked:false},
 onLoad(){},
 onHide(){ui.abort(this);this._showTurn=(this._showTurn||0)+1;this._hidden=true;this.setData({loading:true});},
 onShow(){this._hidden=false;return this.refresh();},
 onUnload(){ui.abort(this);this._turn=(this._turn||0)+1;this.cleanup();this._collection=null;s.unload.call(this);},
 cleanup(){if(this._exportPath){try{wx.getFileSystemManager().unlinkSync(this._exportPath);}catch(_){}this._exportPath=null;}},
 async refresh(){
  const turn=this._turn=(this._turn||0)+1,showTurn=this._showTurn,requestToken=s.api.getSession()?.token;this._disposed=false;
  const active=()=>!this._disposed&&!this._hidden&&turn===this._turn&&showTurn===this._showTurn;
  const owned=()=>active()&&requestToken===s.api.getSession()?.token;this.setData({loading:true,error:''});
  try{
   const session=await s.api.ensureSession(),token=s.api.getSession()?.token;
   if(!owned())return;
   if(session.user.role!=='admin')throw new Error('仅管理员可以导入或导出战术。');
   if(this._owner&&this._owner!==token){this.cleanup();this._collection=null;this._selection=(this._selection||0)+1;this.setData({fileName:'',tacticCount:0,versionCount:0,message:'',actionError:'',busy:false,exportReady:false,pending:false});}
   this._owner=token;this._guardKey=guardKey(s.api.getSession());const guard=readGuard(this._guardKey),task=pendingFor(token);
   this.setData({recoveryBlocked:!!guard&&!task});
   if(task){this._collection=task.collection;this.setData({fileName:task.fileName,tacticCount:task.collection.tactics.length,versionCount:task.collection.versions.length,pending:true});}
   if(!task&&this.data.pending){this._collection=null;this.setData({fileName:"",pending:false,message:"上次导入已结束，请到战术列表核对结果。"});}
   this.setData({admin:true});
  }catch(e){const current=s.api.getSession();if(!e.staleSession&&active()&&(current?.token===requestToken||([401,403].includes(e.status||e.statusCode)&&!current))){this._collection=null;this.cleanup();this.setData({admin:false,fileName:'',tacticCount:0,versionCount:0,message:'',exportReady:false});s.fail(this,e);}}
  finally{if(owned()||(active()&&!s.api.getSession()))this.setData({loading:false});}
 },
 valid(token=this._owner){return !this._disposed&&this._owner===token&&s.api.getSession()?.token===token;},
 ready(){return this.valid()&&this.data.admin&&!this.data.busy&&!this.data.loading&&!this.data.error&&!this._hidden;},
 choose(){
  if(!this.ready()||this.data.recoveryBlocked||pendingFor(this._owner))return;
  try{if(readGuard(this._guardKey)){this.setData({recoveryBlocked:true});return;}}catch(e){this.setData({actionError:e.message});return;}
  if(typeof wx.chooseMessageFile!=='function'){this.setData({actionError:'此客户端不支持选择文件，请使用网页端。'});return;}
  const owner=this._owner,selection=this._selection=(this._selection||0)+1;
  const current=()=>this.valid(owner)&&selection===this._selection;
  wx.chooseMessageFile({count:1,type:'file',extension:['json'],success:r=>{
   if(!current())return;
   const file=r.tempFiles?.[0];if(!file)return;
   this._collection=null;this.setData({fileName:'',tacticCount:0,versionCount:0,message:'',actionError:'',pending:false,busy:false});
   if(!/\.json$/i.test(file.name||'')||!Number.isFinite(file.size)||file.size<=0||file.size>transfer.MAX_BYTES){this.setData({actionError:'请选择不超过 8 MiB 的 JSON 备份。'});return;}
   this.setData({busy:true,actionError:''});
   wx.getFileSystemManager().readFile({filePath:file.path,encoding:'utf8',success:r=>{
    if(!current())return;
    try{this._collection=transfer.parse(r.data);this.setData({fileName:file.name,tacticCount:this._collection.tactics.length,versionCount:this._collection.versions.length,pending:false,message:'已在本地校验，尚未导入。'});}
    catch(e){this._collection=null;this.setData({fileName:'',tacticCount:0,versionCount:0,message:'',actionError:e.message});}
   },fail:()=>{if(current())this.setData({actionError:'无法读取文件，请重新选择。'});},
   complete:()=>{if(current())this.setData({busy:false});}});
  },fail:e=>{if(current()&&!/cancel/.test(e.errMsg||''))this.setData({actionError:'无法打开文件选择器。'});}});
 },
 importFile(){
  if(!this.ready()||this.data.recoveryBlocked||!this._collection)return;
  const owner=this._owner,collection=this._collection;
  ui.showModal(this,{title:'追加导入战术',content:'将新增 '+collection.tactics.length+' 套战术及 '+collection.versions.length+' 个历史版本，不覆盖现有模板。是否继续？',success:r=>{
   if(r.confirm&&this.ready()&&this.valid(owner)&&collection===this._collection)this.executeImport();
  }});
 },
 async executeImport(){
  if(!this.ready()||this.data.recoveryBlocked||!this._collection)return;
  const owner=this._owner;let task=pendingFor(owner);
  if(task?.inFlight)return;
  if(this.data.pending&&!task){this._collection=null;this.setData({pending:false,fileName:"",message:"上次导入已结束，请到战术列表核对。"});return;}
  if(!task)task={token:owner,fileName:this.data.fileName,collection:this._collection,collectionName:name(),inFlight:false};
  this.setData({busy:true,actionError:'',message:''});
  let dispatched=false;
  try{
   const account=await s.api.ensureSession();
   if(!this.valid(owner)||account.user.role!=='admin')throw new Error('登录已变化，请重新打开页面。');
   if(this._hidden)return;
   task.guardKey=guardKey(s.api.getSession());
   const existing=readGuard(task.guardKey);
   if(existing&&existing.taskName!==task.collectionName){this.setData({recoveryBlocked:true});throw new Error('有待核对的导入，请先到战术列表确认。');}
   if(!existing)writeGuard(task.guardKey,task.collectionName);
   pending=task;task.inFlight=true;dispatched=true;
   const result=await s.api.request('/tactic-collections','POST',{...task.collection,collectionName:task.collectionName});
   clearGuard(task.guardKey,task.collectionName);
   if(pending===task)pending=null;
   task.result=result;
   if(this.valid(owner)){
    const message=result.receiptVerification==='legacy-unverified'
     ?'历史导入记录已存在，本次未重复导入。请到战术列表核对内容，勿重复选择同一备份。'
     :result.receiptVerification==='verified'&&result.repeated
      ?'此前导入已确认，本次未重复新增战术。'
      :!result.receiptVerification&&result.importedCount===0
       ?'本次未新增战术，无法核验历史内容。请到战术列表核对。'
       :'导入已确认，新增 '+result.importedCount+' 套战术。';
    this._collection=null;this.setData({fileName:'',pending:false,message});
   }
  }catch(e){
   const code=e.status||e.statusCode||0;
   if(dispatched&&code>=400&&code<500&&!task.hadUncertain){
    try{clearGuard(task.guardKey,task.collectionName);if(pending===task)pending=null;}catch(_){}
   }else if(dispatched)task.hadUncertain=true;
   if(this.valid(owner)){this.setData({pending:pending===task,actionError:pending===task?'导入结果未确认，请使用同一任务重试，勿重新选择文件。':e.message});if(code===401)s.fail(this,e);}
  }finally{task.inFlight=false;if(this.valid(owner))this.setData({busy:false});}
 },
 checkList(){if(!this.ready())return;wx.navigateTo({url:'/pages/tactics/index'});},
 resolveRecovery(){
  if(!this.ready()||!this.data.recoveryBlocked)return;
  const owner=this._owner,key=this._guardKey;
  let guard;try{guard=readGuard(key);}catch(e){this.setData({actionError:e.message});return;}
  ui.showModal(this,{title:'确认已核对导入结果',content:'请先在战术列表核对。若上次已导入，不要再次选择同一备份。解除提醒不会撤销或删除任何已导入战术。确认已核对并允许开始新的导入？',confirmText:'已核对',
   success:r=>{if(!r.confirm||!this.ready()||!this.valid(owner))return;
    try{if(guard)clearGuard(key,guard.taskName);this._collection=null;this.setData({recoveryBlocked:false,fileName:'',pending:false,message:'核对提醒已解除，已有战术未作任何改动。'});}
    catch(e){this.setData({actionError:e.message});}
   }});
 },
 async exportFile(){
  if(!this.ready())return;
  const owner=this._owner,showTurn=this._showTurn;
  const active=()=>this.valid(owner)&&!this._hidden&&showTurn===this._showTurn;
  this.setData({busy:true,actionError:'',message:''});
  try{
   const account=await s.api.ensureSession();
   if(!active()||account.user.role!=='admin')return;
   const result=await s.api.request('/tactic-collections');
   if(!active())return;
   const content=transfer.serialize(result);
   const root=wx.env?.USER_DATA_PATH;if(!root)throw new Error('当前客户端无法写入本地文件。');
   this.cleanup();const path=root+'/football-tactics-'+Date.now()+'.json';
   wx.getFileSystemManager().writeFileSync(path,content,'utf8');
   this._exportPath=path;this.setData({exportReady:true,message:'已生成临时备份，离开此页会清理；请点击保存到本机完成另存。'});
  }catch(e){if(active())this.setData({actionError:e.message});}
  finally{if(this.valid(owner))this.setData({busy:false});}
 },
 saveLocal(){
  if(!this.ready()||!this._exportPath)return;
  if(typeof wx.saveFileToDisk!=='function'){this.setData({actionError:'此客户端不支持本地另存，请在桌面微信或网页端导出。不会自动转发文件。'});return;}
  const owner=this._owner;
  wx.saveFileToDisk({filePath:this._exportPath,success:()=>{if(this.valid(owner))this.setData({message:'已完成系统保存。'});},fail:e=>{if(this.valid(owner)&&!/cancel/.test(e.errMsg||''))this.setData({actionError:/开发者工具|not support|not supported|不支持.*调试/i.test(e.errMsg||'')?'开发者工具暂不支持系统另存，请用真机或桌面微信。临时文件尚未保存到系统目录。':'系统保存未完成，请使用网页端导出。'});}});
 }
});
