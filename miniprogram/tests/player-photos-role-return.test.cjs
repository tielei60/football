// 只使用内存账号、照片元数据与图片缓存替身。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../pages/player-photos/index.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(initial='admin'){
 let role=initial,definition,select;const store=new Map(),calls=[];
 const session=()=>({token:'A',user:{id:1,role},team:{id:1},serverOrigin:'http://isolated.invalid'});
 const api={getSession:session,ensureSession:async()=>session(),request:async(url,method)=>{calls.push({url,method});return url.endsWith('/photos')?{player:{id:'p'},revision:1,photos:[{id:1,caption:'已保存说明'}],coverPhotoId:1}:{dataUrl:'synthetic'};}};
 const shared={api,safeSetData:(p,v)=>p.setData(v),fail:(p,e)=>p.setData({error:e.message}),unload(){this._disposed=true;}};
 const cache={createScope:()=>({}),dispose(){},put:()=> 'wxfile://isolated',remove(){}};
 vm.runInNewContext(source,{Page:p=>definition=p,require:r=>r.endsWith('/shared')?shared:r.endsWith('/player-photo-cache')?cache:r.endsWith('/text-draft')?require('../utils/text-draft'):{abort(){}},wx:{getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v),removeStorageSync:k=>store.delete(k),stopPullDownRefresh(){},enableAlertBeforeUnload(){},disableAlertBeforeUnload(){},chooseMedia(o){select=o;},getFileSystemManager(){return{readFile(o){o.success({data:'iVBORw0KGgoBAgME'});}}}}});
 const p={...definition,data:structuredClone(definition.data),id:'p',setData(v){for(const[k,x]of Object.entries(v)){const parts=k.replace(/\[(\d+)\]/g,'.$1').split('.');let o=this.data;for(const a of parts.slice(0,-1))o=o[a];o[parts.at(-1)]=x;}}};
 return{p,api,calls,setRole:r=>role=r,select:()=>select};
}
test('照片同token降权返回立即取消管理能力并重读',async()=>{
 const h=fixture();await h.p.onShow();h.p.onHide();h.setRole('player');await h.p.onShow();
 assert.equal(h.p.data.admin,false);assert.equal(h.p.editable(),false);assert.equal(h.calls.filter(c=>c.url.endsWith('/photos')).length,2);
});
test('照片同token升权返回重新读取后恢复管理',async()=>{
 const h=fixture('player');await h.p.onShow();h.p.onHide();h.setRole('admin');await h.p.onShow();
 assert.equal(h.p.data.admin,true);assert.equal(h.p.editable(),true);assert.equal(h.calls.filter(c=>c.url.endsWith('/photos')).length,2);
});
test('同角色系统选图hide/show保留合法回调与文字草稿',async()=>{
 const h=fixture();await h.p.onShow();h.p.captionInput({currentTarget:{dataset:{id:1}},detail:{value:'本地草稿'}});
 h.p.choose();h.p.onHide();await h.p.onShow();h.select().success({tempFiles:[{tempFilePath:'wxfile://picked',size:20}]});
 assert.equal(h.p.data.preview,'wxfile://picked');assert.equal(h.p.data.photos[0].draft,'本地草稿');
 assert.equal(h.calls.filter(c=>c.url.endsWith('/photos')).length,1);
});
test('角色变化使旧选图回调失效，不把旧图片写回只读页',async()=>{
 const h=fixture();await h.p.onShow();h.p.choose();h.p.onHide();h.setRole('player');await h.p.onShow();
 h.select().success({tempFiles:[{tempFilePath:'wxfile://old',size:20}]});assert.equal(h.p.data.preview,'');assert.equal(h.p.data.admin,false);
});
for(const failed of [false,true])test('写入中返回降权，旧'+(failed?'失败':'成功')+'结束后完成只读重读而不卡住',async()=>{
 const h=fixture();await h.p.onShow();const d=deferred();const working=h.p.perform(()=>d.promise);await tick();h.p.onHide();h.setRole('player');await h.p.onShow();
 assert.equal(h.p.data.admin,false);assert.equal(h.p.data.loading,false);assert.equal(h.p.editable(),false);
 if(failed)d.reject(Object.assign(Error('冲突'),{status:409}));else d.resolve({});
 await working;assert.equal(h.p.data.busy,false);assert.equal(h.p.data.loading,false);assert.equal(h.p.data.admin,false);
 assert.ok(h.calls.filter(c=>c.url.endsWith('/photos')).length>=2);
});
