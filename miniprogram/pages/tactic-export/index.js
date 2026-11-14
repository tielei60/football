const ui=require('../../utils/ui');
const s=require('../shared'),renderer=require('../../utils/tactic-canvas'),pdf=require('../../utils/tactic-pdf');
const WIDTH=1652,HEIGHT=2660;
Page({
 data:{loading:true,error:'',busy:false,title:'',source:'',actionError:'',message:'',ready:false,format:'',pngPath:''},
 onLoad(q){this.query=q;this._files=new Set();},
 onHide(){ui.abort(this);this._hidden=true;this._epoch=(this._epoch||0)+1;this.setData({loading:true,busy:false});},
 async onShow(){
  this._hidden=false;this._disposed=false;
  if(!this._model)return this.refresh();
  const epoch=this._epoch;
  try{const account=await s.api.ensureSession();if(epoch!==this._epoch||this._hidden||this._disposed)return;
   if(account.user.role!=='admin'||this._owner!==s.api.getSession()?.token){this.cleanup();this._model=null;this.setData({loading:false,ready:false,pngPath:'',title:'',error:'登录已变化，请重新打开页面。'});return;}
   this.setData({loading:false});
  }catch(e){if(epoch===this._epoch&&!this._disposed){this.cleanup();this.setData({loading:false,ready:false,pngPath:''});s.fail(this,e);}}
 },
 onUnload(){ui.abort(this);s.unload.call(this);this.cleanup();this._model=null;},
 cleanFile(path){if(!path)return;try{wx.getFileSystemManager().unlinkSync(path);}catch(_){}this._files?.delete(path);},
 cleanup(){for(const path of this._files||[])this.cleanFile(path);this._path=null;},
 active(epoch,owner){return !this._disposed&&!this._hidden&&epoch===this._epoch&&owner===s.api.getSession()?.token;},
 async refresh(){
  if(this.data.busy)return;
  const epoch=this._epoch=(this._epoch||0)+1;this._disposed=false;this.setData({loading:true,error:''});
  try{
   const account=await s.api.ensureSession(),owner=s.api.getSession()?.token;
   if(account.user.role!=='admin')throw new Error('仅管理员可以导出战术文件。');
   const q=this.query||{};let tactic,source='当前模板';
   if(q.matchId){const match=await s.api.request('/matches/'+encodeURIComponent(q.matchId));const snapshot=(match.tacticSnapshots||[]).find(x=>String(x.sourceTacticId)===String(q.sourceId));
    if(!snapshot)throw new Error('未找到本场历史战术，不能使用当前模板代替。');
    tactic=snapshot.tactic;source=(snapshot.captureSource==='migration'?'迁移时留存':'关联时留存')+' · 历史只读';
   }else{if(!/^[1-9]\d*$/.test(q.id||''))throw new Error('请选择有效战术。');const result=await s.api.request('/tactics/'+encodeURIComponent(q.id)+'/commands');tactic=result.tactic;}
   const scene=renderer.scene(tactic.board);
   if(scene.skipped||(tactic.board.markings||[]).some(m=>m.kind==='text'&&String(m.label||'').split('\n').length>20))throw new Error('该战术含原生画布不支持或会缩略的内容，请使用网页端完整导出。');
   if(!this.active(epoch,owner))return;
   this.cleanup();this._owner=owner;this._model=tactic;
   this.setData({title:tactic.title||'球队战术',source,ready:false,pngPath:'',actionError:''});
  }catch(e){if(epoch===this._epoch&&!this._disposed){this._model=null;s.fail(this,e);}}
  finally{if(epoch===this._epoch&&!this._disposed&&!this._hidden)this.setData({loading:false});}
 },
 png(){return this.generate('PNG');},pdf(){return this.generate('PDF');},
 async generate(format){
  if(this.data.loading||this.data.busy||this.data.error||!this._model||this._hidden||this._disposed)return;
  const epoch=this._epoch,owner=this._owner;this.setData({busy:true,actionError:'',message:''});
  let temp,created;
  try{
   const account=await s.api.ensureSession();
   if(account.user.role!=='admin'||!this.active(epoch,owner))return;
   const node=await new Promise((resolve,reject)=>wx.createSelectorQuery().in(this).select('#export-canvas').fields({node:true,size:true}).exec(r=>r?.[0]?.node?resolve(r[0].node):reject(new Error('无法初始化导出画布，请重试。'))));
   if(!this.active(epoch,owner))return;
   node.width=WIDTH;node.height=HEIGHT;const ctx=node.getContext('2d');
   ctx.fillStyle='#ffffff';ctx.fillRect(0,0,WIDTH,HEIGHT);
   ctx.save();ctx.translate(0,80);const report=renderer.draw(ctx,this._model.board,WIDTH,2500,-1);ctx.restore();
   if(report.skipped)throw new Error('原生绘制有内容缺失，请改用网页端导出。');
   ctx.fillStyle='#292431';ctx.textAlign='center';ctx.font='bold 32px sans-serif';ctx.fillText(this.data.title,WIDTH/2,48,WIDTH-80);
   ctx.font='24px sans-serif';ctx.fillText(this.data.source+' · '+new Date().toISOString().slice(0,10),WIDTH/2,2625,WIDTH-80);
   temp=await new Promise((resolve,reject)=>wx.canvasToTempFilePath({canvas:node,x:0,y:0,width:WIDTH,height:HEIGHT,destWidth:WIDTH,destHeight:HEIGHT,fileType:format==='PDF'?'jpg':'png',quality:.94,success:r=>resolve(r.tempFilePath),fail:()=>reject(new Error('生成图片失败，请检查当前微信客户端支持。'))},this));
   if(!this.active(epoch,owner)){this.cleanFile(temp);return;}
   const fs=wx.getFileSystemManager();
   const stat=fs.statSync(temp);const size=stat.size??stat.stats?.size;
   if(!Number.isFinite(size)||size>8*1024*1024)throw new Error('导出文件超过 8 MiB，请使用网页端处理。');
   const root=wx.env?.USER_DATA_PATH;if(!root)throw new Error('当前客户端无法创建本地文件。');
   created=root+'/football-board-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.'+format.toLowerCase();
   if(format==='PDF')fs.writeFileSync(created,pdf.jpegToPdf(fs.readFileSync(temp)));
   else fs.copyFileSync(temp,created);
   if(!this.active(epoch,owner)){this.cleanFile(created);return;}
   this.cleanup();this._files.add(created);this._path=created;
   this.setData({ready:true,format,pngPath:format==='PNG'?created:'',message:'临时文件已生成，请另存；未分享或上传。'});
  }catch(e){if(this.active(epoch,owner))this.setData({actionError:e.message||'导出失败'});if(created&&created!==this._path)this.cleanFile(created);}
  finally{if(temp)this.cleanFile(temp);if(this.active(epoch,owner))this.setData({busy:false});}
 },
 preview(){
  if(!this._path||this._hidden||this.data.busy||this._owner!==s.api.getSession()?.token)return;
  if(this.data.format==='PNG')wx.previewImage({current:this._path,urls:[this._path]});
  else wx.openDocument({filePath:this._path,fileType:'pdf',showMenu:false,fail:()=>{if(!this._disposed)this.setData({actionError:'当前客户端无法预览 PDF，请另存后使用本地阅读器打开。'});}});
 },
 saveLocal(){
  if(!this._path||this._hidden||this.data.busy||this._owner!==s.api.getSession()?.token)return;
  if(typeof wx.saveFileToDisk!=='function'){this.setData({actionError:'当前客户端不支持本地另存，请使用桌面微信或网页端。不自动分享到聊天。'});return;}
  const owner=this._owner;
  wx.saveFileToDisk({filePath:this._path,success:()=>{if(!this._disposed&&owner===s.api.getSession()?.token)this.setData({message:'已完成系统保存。'});},fail:e=>{if(!this._disposed&&!/cancel/.test(e.errMsg||''))this.setData({actionError:/开发者工具|not support|not supported|不支持.*调试/i.test(e.errMsg||'')?'开发者工具暂不支持系统另存，请用真机或桌面微信。临时文件尚未保存到系统目录。':'系统另存未完成，临时文件仍只在当前页面有效。'});}});
 }
});
