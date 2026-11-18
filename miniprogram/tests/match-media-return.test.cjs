// 纯内存比赛元数据与账号；不访问正式比赛、微信地图或系统相册。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../pages/match-media/index.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(initial='admin'){
 let role=initial,token='A',definition,select;const calls=[];
 const session=()=>({token,user:{id:1,role},team:{id:1}});
 const api={getSession:session,ensureSession:async()=>session(),request:async(url,method)=>{calls.push({url,method});return url.endsWith('/photos')?{revision:1,photos:[{id:1,caption:'第一张'},{id:2,caption:'第二张'}],coverPhotoId:1}:url==='/matches/1'?{notice:'已保存须知',revision:1}:{dataUrl:'synthetic'};}};
 const shared={api,safeSetData:(p,v)=>p.setData(v),fail:(p,e)=>p.setData({error:e.message}),unload(){this._disposed=true;}};
 vm.runInNewContext(source,{Page:p=>definition=p,require:r=>r.endsWith('/shared')?shared:r.endsWith('/media')?{imageSource:()=> 'wxfile://isolated'}:r.endsWith('/text-draft')?require('../utils/text-draft'):{abort(){}},wx:{stopPullDownRefresh(){},enableAlertBeforeUnload(){},disableAlertBeforeUnload(){},chooseMedia(o){select=o;},getFileSystemManager(){return{readFile(o){o.success({data:'iVBORw0KGgoBAgME'});}}}}});
 const p={...definition,data:structuredClone(definition.data),id:'1',setData(v){for(const[k,x]of Object.entries(v)){const parts=k.replace(/\[(\d+)\]/g,'.$1').split('.');let o=this.data;for(const a of parts.slice(0,-1))o=o[a];o[parts.at(-1)]=x;}}};
 return{p,api,calls,setRole:r=>role=r,setToken:t=>token=t,select:()=>select};
}
test('比赛相册降权返回及时只读并重新读取',async()=>{
 const h=fixture();await h.p.onShow();h.p.onHide();h.setRole('player');await h.p.onShow();
 assert.equal(h.p.data.admin,false);assert.equal(h.p.editable(),false);assert.equal(h.calls.filter(c=>c.url.endsWith('/photos')).length,2);
});
test('比赛相册升权返回读取后恢复管理',async()=>{
 const h=fixture('player');await h.p.onShow();h.p.onHide();h.setRole('admin');await h.p.onShow();
 assert.equal(h.p.data.admin,true);assert.equal(h.p.editable(),true);assert.equal(h.calls.filter(c=>c.url.endsWith('/photos')).length,2);
});
test('同角色系统相册返回保留选图、须知与说明草稿',async()=>{
 const h=fixture();await h.p.onShow();h.p.input({currentTarget:{dataset:{field:'notice'}},detail:{value:'须知草稿'}});
 h.p.input({currentTarget:{dataset:{field:'caption'}},detail:{value:'说明草稿'}});h.p.choose();h.p.onHide();await h.p.onShow();
 h.select().success({tempFiles:[{tempFilePath:'wxfile://picked',size:20}]});
 assert.equal(h.p.data.preview,'wxfile://picked');assert.equal(h.p.data.notice,'须知草稿');assert.equal(h.p.data.caption,'说明草稿');
 assert.equal(h.calls.filter(c=>c.url.endsWith('/photos')).length,1);
});
test('降权后旧选图回调不得写入只读页面',async()=>{
 const h=fixture();await h.p.onShow();h.p.choose();h.p.onHide();h.setRole('player');await h.p.onShow();
 h.select().success({tempFiles:[{tempFilePath:'wxfile://old',size:20}]});assert.equal(h.p.data.preview,'');
});
for(const failed of [false,true])test('在途写入'+(failed?'失败':'成功')+'期间降权返回，结束后完成重读',async()=>{
 const h=fixture();await h.p.onShow();const d=deferred();const working=h.p.perform(()=>d.promise);await tick();
 h.p.onHide();h.setRole('player');await h.p.onShow();assert.equal(h.p.data.admin,false);assert.equal(h.p.data.loading,false);
 if(failed)d.reject(Object.assign(Error('冲突'),{status:409}));else d.resolve({});
 await working;assert.equal(h.p.data.busy,false);assert.equal(h.p.data.loading,false);assert.equal(h.p.data.admin,false);assert.ok(h.calls.filter(c=>c.url.endsWith('/photos')).length>=2);
});
for(const status of [0,500])test('排序隐藏后返回收到未知结果 '+status+' 仍锁定核对',async()=>{
 const h=fixture();await h.p.onShow();const d=deferred();h.api.request=()=>d.promise;
 const work=h.p.move({currentTarget:{dataset:{id:1,delta:1}}});await tick();h.p.onHide();await h.p.onShow();
 d.reject(Object.assign(Error('未知结果'),{status}));await work;
 assert.equal(h.p.data.busy,false);assert.equal(h.p.data.conflict,true);assert.match(h.p.data.actionError,/排序结果尚未确认/);assert.equal(h.p.editable(),false);
});
test('排序在隐藏期间失败，返回自动只读核对后恢复服务端顺序',async()=>{
 const h=fixture();await h.p.onShow();const d=deferred(),read=h.api.request;h.api.request=(u,m,...rest)=>m?d.promise:read(u,m,...rest);
 const work=h.p.move({currentTarget:{dataset:{id:1,delta:1}}});await tick();h.p.onHide();d.reject(Error('未知结果'));await work;
 assert.equal(h.p._needsRefresh,true);await h.p.onShow();assert.deepEqual(Array.from(h.p.data.photos,p=>p.id),[1,2]);assert.equal(h.p.data.busy,false);
 assert.equal(h.calls.filter(c=>c.url.endsWith('/photos')).length,2);
});
test('排序旧账号未知响应不得污染新账号状态',async()=>{
 const h=fixture();await h.p.onShow();const d=deferred();h.api.request=()=>d.promise;
 const work=h.p.move({currentTarget:{dataset:{id:1,delta:1}}});await tick();h.setToken('B');d.reject(Error('旧结果'));await work;
 assert.equal(h.p.data.conflict,false);assert.equal(h.p.data.actionError,'');
});
test('待确认上传跨角色往返保留原请求编号和须知，不自动重传',async()=>{
 const h=fixture();await h.p.onShow();h.p._image='data:image/png;base64,synthetic';h.p.setData({preview:'wxfile://picked',caption:'说明',notice:'须知草稿'});
 const read=h.api.request,ids=[];h.api.request=async(url,method,payload)=>{if(method==='POST'){ids.push(payload.requestId);if(ids.length===1)throw Error('未知');return{revision:2};}return read(url,method,payload);};
 await h.p.upload();assert.equal(h.p.data.uncertain,true);
 h.p.onHide();h.setRole('player');await h.p.onShow();assert.equal(ids.length,1);assert.equal(h.p.data.admin,false);assert.equal(h.p.data.uncertain,true);
 h.p.onHide();h.setRole('admin');await h.p.onShow();assert.equal(ids.length,1);assert.equal(h.p.data.notice,'须知草稿');
 await h.p.upload();assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
});
