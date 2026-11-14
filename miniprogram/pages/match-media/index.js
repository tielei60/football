const ui=require('../../utils/ui');
const s=require('../shared');
const {imageSource}=require('../../utils/media');
const pendingByMatch=new Map(); let pendingOwner;
function owned(id){const token=s.api.getSession()?.token;if(pendingOwner!==token){pendingByMatch.clear();pendingOwner=token;}return pendingByMatch.get(id)||null;}
function drop(p){if(pendingByMatch.get(p.matchId)===p)pendingByMatch.delete(p.matchId);}
function key(){return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const n=Math.floor(Math.random()*16);return (c==='x'?n:(n&3)|8).toString(16);});}
Page({
 data:{loading:true,error:'',admin:false,busy:false,conflict:false,actionError:'',notice:'',photos:[],coverPhotoId:null,preview:'',caption:'',uncertain:false},
 onLoad(q){this.id=q.id;},
 onHide(){ui.abort(this);this._showTurn=(this._showTurn||0)+1;this._picturesTurn=(this._picturesTurn||0)+1;this._hidden=true;this.setData({loading:true});},
 async onShow(){
  this._hidden=false;
  const showTurn=this._showTurn=(this._showTurn||0)+1,token=s.api.getSession()?.token;
  if(!this._loaded)return this.refresh();
  const epoch=this._epoch;
  try{await s.api.ensureSession();if(this._disposed||this._hidden||epoch!==this._epoch||showTurn!==this._showTurn)return;
   owned(this.id);
   if(this._owner!==s.api.getSession()?.token){this._image=null;this.setData({photos:[],notice:'',preview:'',caption:'',loading:false,error:'登录已变化，请重新打开比赛。'});return;}
   if(this._needsRefresh){this._needsRefresh=false;return this.refresh();}
   this.setData({loading:false});this.loadPictures();
  }catch(e){if(!this._disposed&&!this._hidden&&epoch===this._epoch&&showTurn===this._showTurn){const current=s.api.getSession();if(current?.token===token||((e.status||e.statusCode)===401&&!current)){this.setData({loading:false});s.fail(this,e);}}}
 },
 alertDraft(){const dirty=this.data.notice!==this._savedNotice||!!this._image||!!owned(this.id);if(dirty){wx.enableAlertBeforeUnload?.({message:'有未保存内容或待确认上传，确定离开？'});}else wx.disableAlertBeforeUnload?.();},
 onUnload(){ui.abort(this);this._imageEpoch=(this._imageEpoch||0)+1;s.unload.call(this);},
 async refresh(preserve=true){
  if(this.data.busy)return;
  this._imageEpoch=(this._imageEpoch||0)+1;
  const token=s.api.getSession()?.token,showTurn=this._showTurn;
  const local=this._loaded&&preserve&&this._owner===token?{notice:this.data.notice,preview:this.data.preview,caption:this.data.caption}:null;
  const epoch=this._epoch=(this._epoch||0)+1;
  this._disposed=false;
  const active=()=>!this._disposed&&!this._hidden&&epoch===this._epoch&&showTurn===this._showTurn;
  const ownedResponse=()=>active()&&token===s.api.getSession()?.token;
  this.setData({loading:true,error:''});
  try{
   const session=await s.api.ensureSession();
   if(!ownedResponse())return;
   const [match,list]=await Promise.all([s.api.request('/matches/'+this.id),s.api.request('/matches/'+this.id+'/photos')]);
   if(!ownedResponse())return;
   const p=owned(this.id);
   s.safeSetData(this,{admin:session.user.role==='admin',notice:local?local.notice:p?.notice??match.notice??'',
    photos:list.photos.map(x=>({id:x.id,caption:x.caption||'',src:'',loading:true,imageError:''})),coverPhotoId:list.coverPhotoId,
    conflict:false,actionError:'',preview:p?imageSource(p.dataUrl):local?.preview||'',caption:p?.caption??local?.caption??'',uncertain:!!p});
   this._owner=token;this.revision=Number.isInteger(match.revision)?Math.min(match.revision,list.revision):list.revision;
   this._savedNotice=match.notice||'';this._loaded=true;
   if(p)this._image=p.dataUrl;else if(!local)this._image=null;
   this.alertDraft();
  }catch(e){
   if(active()){
    const current=s.api.getSession();
    if(current?.token===token||((e.status||e.statusCode)===401&&!current))s.fail(this,e);
   }
  }finally{
   if(active()&&(token===s.api.getSession()?.token||!s.api.getSession())){
    this.setData({loading:false});
    if(ownedResponse()&&!this.data.error)this.loadPictures();
   }
   wx.stopPullDownRefresh();
  }
 },
 pictureCurrent(epoch,token,turn){return !this._disposed&&!this._hidden&&epoch===this._epoch&&token===this._owner&&token===s.api.getSession()?.token&&turn===this._picturesTurn;},
 async loadPictures(retryId){
  if(this._disposed||this._hidden||this.data.loading||this.data.error||this._owner!==s.api.getSession()?.token)return;
  const epoch=this._epoch,token=this._owner,turn=this._picturesTurn=(this._picturesTurn||0)+1;
  const photos=this.data.photos.filter(p=>!p.src&&(!p.imageError||p.id===retryId));
  for(const photo of photos){
   if(!this.pictureCurrent(epoch,token,turn))return;
   const update=patch=>{if(!this.pictureCurrent(epoch,token,turn))return;const i=this.data.photos.findIndex(p=>p.id===photo.id);if(i>=0){const data={};for(const k in patch)data['photos['+i+'].'+k]=patch[k];this.setData(data);}};
   update({loading:true,imageError:''});
   try{const result=await s.api.request('/matches/'+this.id+'/photos/'+photo.id);if(!this.pictureCurrent(epoch,token,turn))return;const src=imageSource(result.dataUrl);if(!src)throw new Error('照片暂时无法显示，请重试');update({src,loading:false,imageError:''});}
   catch(e){if(!this._disposed&&!this._hidden&&epoch===this._epoch&&turn===this._picturesTurn&&(e.status||e.statusCode)===401&&!s.api.getSession()){s.fail(this,e);return;}if(!this.pictureCurrent(epoch,token,turn))return;update({loading:false,imageError:'照片加载失败，请重试'});}
  }
 },
 retryPhoto(e){if(!this.readable())return;const id=e.currentTarget.dataset.id;if(this.data.photos.some(p=>p.id===id&&!p.loading))return this.loadPictures(id);},
 readable(){return !this._disposed&&!this._hidden&&!this.data.loading&&!this.data.error&&this._owner===s.api.getSession()?.token;},
 photoError(e){if(!this.readable())return;const i=this.data.photos.findIndex(p=>p.id===e.currentTarget.dataset.id);if(i>=0)this.setData({['photos['+i+'].src']:'',['photos['+i+'].loading']:false,['photos['+i+'].imageError']:'照片显示失败，请重试'});},
 input(e){if(this.data.busy||this.data.uncertain)return;const field=e.currentTarget.dataset.field;if(['notice','caption'].includes(field)&&this.editable()){this.setData({[field]:e.detail.value});this.alertDraft();}},
 choose(){if(!this.editable()||this.data.uncertain)return;const epoch=this._epoch,turn=this._imageEpoch=(this._imageEpoch||0)+1;wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album'],success:r=>{if(this._disposed||epoch!==this._epoch||turn!==this._imageEpoch||this._owner!==s.api.getSession()?.token)return;const f=r.tempFiles?.[0];if(!f)return;if(f.size>2097152){this.setData({actionError:'请选择 2 MB 内的 PNG 或 JPG'});return;}wx.getFileSystemManager().readFile({filePath:f.tempFilePath,encoding:'base64',success:result=>{if(this._disposed||epoch!==this._epoch||turn!==this._imageEpoch||this._owner!==s.api.getSession()?.token)return;const data=result.data;const mime=data.startsWith('iVBORw0KGgo')?'png':data.startsWith('/9j/')?'jpeg':null;if(!mime||data.length*3/4>2097154){this.setData({actionError:'请选择 2 MB 内的 PNG 或 JPG'});return;}this._image='data:image/'+mime+';base64,'+data;this.setData({preview:f.tempFilePath,actionError:''});this.alertDraft();},fail:()=>{if(!this._disposed&&turn===this._imageEpoch)this.setData({actionError:'图片读取失败，请重选'});}});},fail:e=>{if(!this._disposed&&epoch===this._epoch&&turn===this._imageEpoch&&!/cancel/.test(e.errMsg||''))this.setData({actionError:'无法选择图片，请检查相册授权'});}});},
 editable(){return this.data.admin&&!this.data.busy&&!this.data.conflict&&!this.data.loading&&!this.data.error&&!this._hidden&&!this._disposed&&this._owner===s.api.getSession()?.token;},
 async perform(work,done){if(!this.editable())return;const epoch=this._epoch,token=this._owner,showTurn=this._showTurn,attempt=this._writeAttempt={};this.setData({busy:true,actionError:''});this._imageEpoch=(this._imageEpoch||0)+1;try{const session=await s.api.ensureSession();if(session.user.role!=='admin'||this._owner!==s.api.getSession()?.token)throw new Error('登录已变化，请重新载入');if(this._disposed||this._hidden||epoch!==this._epoch||showTurn!==this._showTurn)return;const result=await work();if(!this._disposed&&epoch===this._epoch&&this._owner===s.api.getSession()?.token){if(done)done(result);this.setData({busy:false});if(this._hidden)this._needsRefresh=true;else await this.refresh();}}catch(e){if(!this._disposed&&!this._hidden&&epoch===this._epoch&&showTurn===this._showTurn){const current=s.api.getSession();if((e.status||e.statusCode)===401&&!current)s.fail(this,e);else if(current?.token===token&&this._owner===token)this.setData({conflict:(e.status||e.statusCode)===409,actionError:(e.status||e.statusCode)===409?'比赛已被修改，内容已保留，请重新载入核对。':e.message});}}finally{if(!this._disposed&&epoch===this._epoch&&this._writeAttempt===attempt)this.setData({busy:false});}},
 saveNotice(){if(this.data.uncertain)return;const notice=this.data.notice;return this.perform(()=>s.api.request('/matches/'+this.id,'PUT',{revision:this.revision,notice}),()=>{this._savedNotice=notice;this.alertDraft();});},
 upload(){let p=owned(this.id);if(p?.inFlight)return;if(this.data.uncertain&&!p){this._image=null;this.setData({preview:'',caption:'',uncertain:false});return this.refresh();}if(!p){if(!this._image||this.data.photos.length>=9)return;p={token:this._owner,matchId:this.id,requestId:key(),dataUrl:this._image,caption:this.data.caption,notice:this.data.notice,revision:this.revision,inFlight:false};}return this.perform(async()=>{owned(this.id);pendingByMatch.set(this.id,p);p.inFlight=true;this.alertDraft();try{const result=await s.api.request('/matches/'+this.id+'/photos','POST',{revision:p.revision,requestId:p.requestId,dataUrl:p.dataUrl,caption:p.caption});drop(p);return result;}catch(e){const status=e.status||e.statusCode||0;if(status>=400&&status<500)drop(p);if(!this._disposed&&p.token===s.api.getSession()?.token)this.setData({uncertain:owned(this.id)===p});throw e;}finally{p.inFlight=false;}},()=>{this._image=null;this.setData({preview:'',caption:'',uncertain:false});this.alertDraft();});},
 remove(e){if(this.data.uncertain)return;const id=e.currentTarget.dataset.id,epoch=this._epoch;ui.showModal(this,{title:'移除照片',content:'从这场比赛移除此照片？',confirmText:'移除',success:r=>{if(r.confirm&&!this._disposed&&epoch===this._epoch)this.perform(()=>s.api.request('/matches/'+this.id+'/photos/'+id,'DELETE',{revision:this.revision}));}});},
 cover(e){if(this.data.uncertain)return;return this.perform(()=>s.api.request('/matches/'+this.id+'/photos/cover','PUT',{revision:this.revision,photoId:e.currentTarget.dataset.id}));},
 previewPhoto(e){if(!this.readable())return;const urls=this.data.photos.map(p=>p.src).filter(Boolean);const current=this.data.photos.find(p=>p.id===e.currentTarget.dataset.id)?.src;const epoch=this._epoch,token=this._owner;if(current)wx.previewImage({current,urls,fail:()=>{if(this.readable()&&epoch===this._epoch&&token===this._owner)this.setData({actionError:'照片预览失败，请重试'});}});},
 reload(){if(this.data.busy)return;const epoch=this._epoch;ui.showModal(this,{title:'重新载入',content:'将丢弃未保存的文字修改。未确认的上传仍会保留。',success:r=>{if(r.confirm&&!this._disposed&&epoch===this._epoch)this.refresh(false);}});}
});
