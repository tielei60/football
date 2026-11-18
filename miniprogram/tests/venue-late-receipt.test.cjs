// 纯内存替身验证生命周期，不访问真实球场、地图或账号。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {runPage}=require('./ui-fixture.cjs');
const source=fs.readFileSync(require.resolve('../pages/manage-venue/index.js'),'utf8');
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};}
function setup(){
 let definition,token='A';const storage=new Map();const events=[],requests=[],saving=deferred(),choosing=deferred();
 const venue={id:7,revision:2,name:'隔离球场',address:'地址',status:'active',latitude:30,longitude:120};
 const shared={api:{getSession:()=>({token,serverOrigin:'https://club.example',user:{id:token==='A'?1:2},team:{id:1}}),request:async(...args)=>{requests.push(args);return args[1]?saving.promise:venue;}},
 load:async(page,work)=>page.setData(await work({user:{role:'admin'}})),unload(){this._disposed=true;},
 fail(page,e){events.push(['fail',e.status]);}};
 runPage(source,{Page:d=>definition=d,require:n=>n.includes('location')?{choose:()=>choosing.promise,markers:v=>v.latitude?[{latitude:v.latitude}]:[]}:shared,
 wx:{getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),navigateBack(){events.push(['back']);},showToast(){events.push(['toast']);},showModal(o){o.success({confirm:true});}}});
 function page(){return{...definition,data:structuredClone(definition.data),_ownerToken:token,setData(p){for(const[k,v]of Object.entries(p)){if(k.startsWith('form.'))this.data.form[k.slice(5)]=v;else this.data[k]=v;}}};}
 const p=page();p.data.form.name=venue.name;
 return{p,page,events,requests,saving,choosing,venue,setToken:v=>token=v};
}
test('隐藏后的保存成功不导航，返回才处理一次，重复保存改为 PUT',async()=>{
 const h=setup(),saving=h.p.save();h.p.onHide();h.saving.resolve(h.venue);await saving;
 assert.deepEqual(h.events,[]);assert.equal(h.p.data.busy,true);
 h.p.onShow();assert.deepEqual(h.events,[['toast'],['back']]);assert.equal(h.p.id,7);assert.equal(h.p.data.revision,2);
 h.p.onShow();assert.equal(h.events.length,2);
 await h.p.save();assert.equal(h.requests[1][1],'PUT');
});
test('保存尚未结束即返回仍保持 busy，收到结果只导航一次',async()=>{
 const h=setup(),saving=h.p.save();h.p.onHide();h.p.onShow();assert.equal(h.p.data.busy,true);
 await h.p.save();assert.equal(h.requests.length,1);h.saving.resolve(h.venue);await saving;
 assert.deepEqual(h.events,[['toast'],['back']]);assert.equal(h.p.data.busy,false);
});
for(const status of [401,409,0])test('隐藏后的错误 '+status+' 不立即回填；返回当前会话才处理',async()=>{
 const h=setup(),saving=h.p.save();h.p.onHide();h.saving.reject(Object.assign(Error('隔离错误'),{status}));await saving;
 assert.equal(h.p.data.actionError,'');assert.deepEqual(h.events,[]);h.p.onShow();
 assert.equal(h.p.data.busy,false);assert.equal(h.p.data.conflict,status===409);assert.equal(h.p.data.uncertain,status===0);
 assert.deepEqual(h.events,status===401?[['fail',401]]:[]);
});
for(const rejected of [false,true])test('切换账号后忽略旧保存'+(rejected?'401':'成功')+'回执',async()=>{
 const h=setup(),saving=h.p.save();h.p.onHide();h.setToken('B');
 if(rejected)h.saving.reject(Object.assign(Error('旧401'),{status:401}));else h.saving.resolve(h.venue);
 await saving;h.p.onShow();assert.deepEqual(h.events,[]);assert.equal(h.p.data.busy,false);
 assert.equal(h.p.data.actionError,'');assert.equal(h.p.data.conflict,true);
});
for(const cancelled of [false,true])test('地图隐藏期间'+(cancelled?'取消':'选点')+'结果在返回后处理且保留草稿',async()=>{
 const h=setup();h.p.data.form.fieldNumber='A';const choosing=h.p.choose();h.p.onHide();
 h.choosing.resolve(cancelled?null:{name:'选中球场',latitude:31,longitude:121});await choosing;
 assert.equal(h.p.data.form.name,'隔离球场');h.p.onShow();assert.equal(h.p.data.busy,false);
 assert.equal(h.p.data.form.name,cancelled?'隔离球场':'选中球场');assert.equal(h.p.data.form.fieldNumber,'A');assert.deepEqual(h.events,[]);
});
test('地图回执不能跨账号回填',async()=>{
 const h=setup(),choosing=h.p.choose();h.p.onHide();h.setToken('B');h.choosing.resolve({name:'旧账号地点',latitude:31});await choosing;h.p.onShow();
 assert.equal(h.p.data.form.name,'隔离球场');assert.equal(h.p.data.busy,false);assert.deepEqual(h.events,[]);
});
test('卸载后已成功新建的重入消耗已知 ID，不允许重新 POST',async()=>{
 const h=setup(),saving=h.p.save();h.p.onUnload();h.saving.resolve(h.venue);await saving;assert.deepEqual(h.events,[]);
 const next=h.page();await next.refresh();assert.equal(next.id,7);assert.equal(next.data.editing,true);assert.equal(next.data.uncertain,false);
 await next.save();assert.equal(h.requests.filter(r=>r[1]==='POST').length,1);assert.equal(h.requests.at(-1)[1],'PUT');
});
test('重入等待中的新建稍后成功，确认未创建不能抹掉已知成功回执',async()=>{
 const h=setup(),saving=h.p.save();h.p.onUnload();const next=h.page();await next.refresh();assert.equal(next.data.uncertain,true);
 h.saving.resolve(h.venue);await saving;next.confirmAbsent();await new Promise(r=>setImmediate(r));
 assert.equal(next.id,7);assert.equal(next.data.uncertain,false);assert.equal(h.requests.filter(r=>r[1]==='POST').length,1);
});

for(const hidden of [false,true])test('当前401清空token后'+(hidden?'返回再':'立即')+'解除busy并进入认证恢复',async()=>{
 const h=setup(),saving=h.p.save();if(hidden)h.p.onHide();h.setToken(undefined);
 h.saving.reject(Object.assign(Error('会话已过期'),{status:401}));await saving;
 if(hidden){assert.deepEqual(h.events,[]);h.p.onShow();}
 assert.equal(h.p.data.busy,false);assert.deepEqual(h.events,[['fail',401]]);
});
test('标为旧会话的401不能借空token跳转登录',async()=>{
 const h=setup(),saving=h.p.save();h.setToken(undefined);
 h.saving.reject(Object.assign(Error('旧会话'),{status:401,staleSession:true}));await saving;
 assert.deepEqual(h.events,[]);h.p.onShow();assert.equal(h.p.data.busy,false);
});
