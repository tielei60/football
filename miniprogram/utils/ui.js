// Explicit per-page business UI. Native permission/file/map APIs are untouched.
// Lifecycle abort resolves promises but never invokes stale business callbacks.
const states=new WeakMap();
let serial=0;
const identity=()=>{try{return require('./api').getSession()?.token||null;}catch(_){return null;}};
const clip=(value,max)=>String(value==null?'':value).slice(0,max);
function snapshot(page){return {token:identity(),epoch:page._epoch,generation:page._generation,view:page._viewEpoch};}
function current(page,stamp){return !page._disposed&&!page._hidden&&identity()===stamp.token&&page._epoch===stamp.epoch&&page._generation===stamp.generation&&page._viewEpoch===stamp.view;}
function callbacks(task,result,kind='success'){
 try{task.options[kind]?.(result);}finally{task.options.complete?.(result);}
}
function attach(page){
 if(states.has(page))return states.get(page);
 const host=page.selectComponent?.('#business-dialog');
 if(!host||typeof host.present!=='function')return null;
 const state={host,queue:[],settling:new Set(),modal:null,transient:null,timer:null,blocking:false,version:0};states.set(page,state);
 host.connect({confirm:(id,value)=>settle(page,id,true,value),cancel:id=>settle(page,id,false,''),detach:()=>abort(page)});
 return state;
}
function render(page,state,onCommitted){
 const visible=!!(state.modal||state.transient?.view.mask);
 state.host.present({modal:state.modal?.view||null,transient:state.transient?.view||null});
 if(state.blocking===visible){onCommitted?.();return;}
 state.blocking=visible;const version=++state.version;
 page.setData({businessUiBlocking:visible},()=>{
  if(states.get(page)!==state||state.version!==version)return;
  if(!visible&&!page._disposed&&!page._hidden)page.onBusinessUiClosed?.();
  onCommitted?.();
 });
 if(visible&&!page._disposed&&!page._hidden)page.onBusinessUiOpen?.();
}
function pump(page,state){
 while(!state.modal&&!state.settling.size&&state.queue.length){
  const task=state.queue.shift();
  if(!current(page,task.stamp)){task.resolve({confirm:false,cancel:true,aborted:true});continue;}
  state.modal=task;
 }
 render(page,state);
}
function settle(page,id,confirmed,value){
 const state=states.get(page),task=state?.modal;
 if(!task||task.view.id!==id)return;
 if(!current(page,task.stamp)){abort(page);return;}
 if(!confirmed&&!task.view.showCancel)return;
 state.modal=null;state.host.clearInput?.();
 const result={confirm:confirmed,cancel:!confirmed,content:confirmed&&task.view.editable?clip(value,task.view.maxlength):'',errMsg:task.view.kind==='picker'?'showPicker:ok':'showModal:ok'};
 if(task.view.kind==='picker'&&confirmed)result.value=value;
 state.settling.add(task);
 // Release overlay before invoking callbacks: business edit guards depend on it.
 if(state.timer)clearTimeout(state.timer);state.timer=null;
 state.transient?.resolve({aborted:true});state.transient=null;
 render(page,state,()=>{
  state.settling.delete(task);
  if(!current(page,task.stamp)){task.resolve({confirm:false,cancel:true,aborted:true});pump(page,state);return;}
  task.resolve(result);
  try{callbacks(task,result);}finally{pump(page,state);}
 });
}
function unavailable(page,options,method){
 const result={confirm:false,cancel:true,aborted:true,errMsg:method+':fail business UI unavailable'};
 // Missing host must not fall back to native chrome or invoke navigation callbacks.
 return Promise.resolve(result);
}
function showModal(page,options={}){
 const state=attach(page);if(!state||page._disposed||page._hidden)return unavailable(page,options,'showModal');
 if(state.queue.length>=10)return unavailable(page,options,'showModal');
 const stamp=snapshot(page);
 return new Promise(resolve=>{
  state.queue.push({options,stamp,resolve,view:{
   id:++serial,kind:options._pickerState?'picker':'modal',pickerState:options._pickerState||null,title:clip(options.title||'提示',120),content:clip(options.content,20000),
   showCancel:options.showCancel!==false,confirmText:clip(options.confirmText||'确定',40),cancelText:clip(options.cancelText||'取消',40),
   danger:options.danger===true||/删除|移除|归档/.test(options.confirmText||options.title||''),
   editable:!!options.editable,placeholderText:clip(options.placeholderText,200),value:clip(options.defaultValue,10000),
   password:!!options.password,maxlength:Math.max(1,Math.min(10000,Number.isInteger(options.maxlength)?options.maxlength:500)),
  }});
  pump(page,state);
 });
}
function hideTransient(page,type,aborted=false){
 const state=states.get(page),task=state?.transient;if(!task||type&&task.view.type!==type)return;
 if(state.timer)clearTimeout(state.timer);state.timer=null;state.transient=null;render(page,state);
 task.resolve({aborted,errMsg:task.method+':ok'});
}
function transient(page,options,type){
 const state=attach(page);if(!state||page._disposed||page._hidden)return unavailable(page,options,type);
 hideTransient(page,null,true);
 const stamp=snapshot(page),method=type==='loading'?'showLoading':'showToast';
 return new Promise(resolve=>{
  const task={stamp,options,method,resolve,view:{type,id:++serial,title:clip(options.title,1000),icon:['success','error','none'].includes(options.icon)?options.icon:'none',mask:!!options.mask}};
  state.transient=task;render(page,state);
  if(current(page,stamp))callbacks(task,{errMsg:method+':ok'});
  if(type==='toast'&&state.transient===task){
   const duration=Math.max(500,Math.min(10000,Number.isFinite(options.duration)?options.duration:1500));
   state.timer=setTimeout(()=>{if(!current(page,stamp)){abort(page);return;}if(state.transient===task)hideTransient(page,'toast');},duration);
  }
 });
}
function abort(page){
 const state=states.get(page);if(!state)return;
 if(state.timer)clearTimeout(state.timer);state.timer=null;
 const result={confirm:false,cancel:true,aborted:true};
 for(const task of [state.modal,...state.queue,...state.settling,state.transient])task?.resolve(result);
 state.modal=null;state.queue=[];state.settling.clear();state.transient=null;state.host.clearInput?.();
 // Do not redraw detached canvas or execute old business callbacks.
 state.blocking=false;state.version++;state.host.present({modal:null,transient:null});
 if(!page._disposed)page.setData({businessUiBlocking:false});
}
function showPicker(page,options={}){
 try{const model=require('./picker-model');const pickerState=model.create(options);return showModal(page,{...options,title:options.title||pickerState.title||'请选择',editable:false,_pickerState:pickerState});}
 catch(error){return Promise.resolve({confirm:false,cancel:true,aborted:true,error:error.message});}
}
module.exports={attach,abort,showModal,showPicker,showToast:(page,options={})=>transient(page,options,'toast'),showLoading:(page,options={})=>transient(page,options,'loading'),hideToast:page=>hideTransient(page,'toast'),hideLoading:page=>hideTransient(page,'loading')};
