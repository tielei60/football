// 真实页面控制器、独立模块重启、共享内存存储；不请求真实服务或位置。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {runPage}=require('./ui-fixture.cjs');
const source=fs.readFileSync(require.resolve('../pages/match-edit/index.js'),'utf8');
const identity=(id=1,token='A',origin='https://club.example',team=1)=>({token,serverOrigin:origin,user:{id,role:'admin'},team:{id:team}});
function boot(store=new Map(),options={}){
 let def,session=options.session||identity(),modal,calls=0;const events=[];
 const shared={dateLabel:x=>x,api:{getSession:()=>session,request:async(...args)=>{if(!args[1])return [];calls++;return options.request?options.request(...args):{id:7,revision:1};}},load:async(p,work)=>{try{p.setData({...await work(session),loading:false});}catch(e){p.setData({error:e.message,loading:false});}},unload(){this._disposed=true;},fail(p,e){events.push(e);}};
 const wx={getStorageSync:k=>{if(options.readFail&&store.has(k))throw Error('读回失败');return store.get(k);},setStorageSync:(k,v)=>{if(options.storageFail)throw Error('存储不可用');store.set(k,v);},removeStorageSync:k=>{if(options.removeFail)throw Error('删除提醒失败');store.delete(k);},switchTab(){events.push('back');},redirectTo(o){o.success?.();},showToast(){},showModal:o=>{modal=o;}};
 runPage(source,{Page:d=>def=d,require:n=>n.includes('location')?{markers:()=>[]}:shared,wx});
 const page={...def,data:structuredClone(def.data),setData:p=>Object.assign(page.data,p)};
 return {page,events,store,calls:()=>calls,session:s=>session=s,modal:()=>modal,confirm:v=>modal.success({confirm:v})};
}
async function prepared(store,options){const h=boot(store,options);await h.page.refresh();h.page.data.form.opponent='私密对手';h.page.data.form.date='2026-11-20';h.page.data.form.location='私密地址';return h;}
for(const error of [Error('offline'),Object.assign(Error('bad gateway'),{status:502}),Object.assign(Error('stale'),{status:401,staleSession:true})])test('未知回执跨进程阻止新建 '+error.message,async()=>{
 const store=new Map(),h=await prepared(store,{request:async()=>{throw error;}});await h.page.save();assert.equal(h.calls(),1);assert.equal(store.size,1);
 const text=JSON.stringify([...store]);assert.ok(!text.includes('私密'));assert.ok(!text.includes('"token"'));
 const next=await prepared(store,{session:identity(1,'A2')});assert.equal(next.page.data.uncertain,true);assert.match(next.page.data.actionError,/核对/);assert.match(next.page.data.actionError,/赛程和草稿/);await next.page.save();assert.equal(next.calls(),0);
 next.page.confirmAbsent();next.confirm(false);assert.equal(store.size,1);next.page.confirmAbsent();next.confirm(true);assert.equal(store.size,0);assert.equal(next.page.data.uncertain,false);
 await next.page.save();assert.equal(next.calls(),1);assert.equal(store.size,0);
});
test('请求前存储失败或空名称不发POST且可恢复',async()=>{
 const store=new Map(),h=await prepared(store,{storageFail:true});await h.page.save();assert.equal(h.calls(),0);assert.equal(store.size,0);assert.equal(h.page.data.busy,false);assert.match(h.page.data.actionError,/存储不可用/);
 const next=await prepared(store);next.page.data.form.opponent=' ';await next.page.save();assert.equal(next.calls(),0);assert.equal(store.size,0);next.page.data.form.opponent='修正';await next.page.save();assert.equal(next.calls(),1);
});
for(const variant of ['user','origin','team'])test('提醒隔离 '+variant,async()=>{
 const store=new Map(),h=await prepared(store,{request:async()=>{throw Error('lost');}});await h.page.save();const original=JSON.stringify([...store]);
 const other=await prepared(store,{session:variant==='user'?identity(2,'B'):variant==='origin'?identity(1,'B','https://other.example'):identity(1,'B','https://club.example',2)});
 assert.equal(other.page.data.uncertain,false);await other.page.save();assert.equal(other.calls(),1);assert.equal(JSON.stringify([...store]),original);
});
test('旧成功回执和旧确认不清新任务标记',async()=>{
 const store=new Map();let resolve;const h=await prepared(store,{request:()=>new Promise(r=>resolve=r)});const saving=h.page.save();const key=[...store.keys()][0];store.set(key,{taskId:'new-task',createdAt:2});resolve({id:7});await saving;assert.equal(store.get(key).taskId,'new-task');
 const next=await prepared(store);next.page.confirmAbsent();store.set(key,{taskId:'newer-task',createdAt:3});next.confirm(true);assert.equal(store.get(key).taskId,'newer-task');assert.equal(next.page.data.uncertain,true);
});
for(const status of [400,403,409])test('明确拒绝清本任务提醒 '+status,async()=>{const store=new Map(),h=await prepared(store,{request:async()=>{throw Object.assign(Error('rejected'),{status});}});await h.page.save();assert.equal(h.calls(),1);assert.equal(store.size,0);});
test('成功缺少id保留提醒且无新请求',async()=>{const store=new Map(),h=await prepared(store,{request:async()=>({})});await h.page.save();assert.equal(h.page.data.uncertain,true);assert.equal(store.size,1);await h.page.save();assert.equal(h.calls(),1);});

test('写入后读回失败不POST，存储恢复后可明确解除提醒',async()=>{
 const store=new Map(),options={readFail:true},h=await prepared(store,options);await h.page.save();
 assert.equal(h.calls(),0);assert.equal(store.size,1);assert.equal(h.page.data.busy,false);assert.match(h.page.data.actionError,/读回失败/);
 options.readFail=false;const next=await prepared(store);assert.equal(next.page.data.uncertain,true);
 next.page.confirmAbsent();next.confirm(true);assert.equal(store.size,0);await next.page.save();assert.equal(next.calls(),1);
});
test('成功写入但清理提醒失败保留未知状态，禁止重复添加',async()=>{
 const store=new Map(),options={removeFail:true},h=await prepared(store,options);await h.page.save();
 assert.equal(h.calls(),1);assert.equal(store.size,1);assert.equal(h.page.data.uncertain,true);assert.equal(h.page.data.busy,false);
 assert.match(h.page.data.actionError,/结果未确认/);await h.page.save();assert.equal(h.calls(),1);
 options.removeFail=false;const next=await prepared(store);next.page.confirmExists();next.confirm(true);assert.equal(store.size,0);assert.equal(next.calls(),0);assert.deepEqual(next.events,['back']);
});
test('比赛已存在核对取消不清除、确认仅解除提醒并返回，不写库',async()=>{
 const store=new Map(),h=await prepared(store,{request:async()=>{throw Error('lost');}});await h.page.save();
 const next=await prepared(store);next.page.confirmExists();next.confirm(false);assert.equal(store.size,1);assert.equal(next.page.data.uncertain,true);assert.equal(next.calls(),0);
 next.page.confirmExists();next.confirm(true);assert.equal(store.size,0);assert.equal(next.page.data.uncertain,false);assert.equal(next.calls(),0);assert.deepEqual(next.events,['back']);
});
test('同进程未完成请求重开时已存在确认也不能解除',async()=>{
 const store=new Map();let resolve;const h=await prepared(store,{request:()=>new Promise(r=>resolve=r)});const saving=h.page.save();
 // 同页面解除busy仅模拟重入载入待处理任务，pendingCreate仍在此模块中。
 h.page.data.busy=false;await h.page.refresh();h.page.confirmExists();assert.equal(h.modal(),undefined);
 assert.equal(store.size,1);assert.match(h.page.data.actionError,/仍在处理/);assert.equal(h.calls(),1);
 resolve({id:7});await saving;assert.equal(store.size,0);
});
for(const id of [0,-1,'7',null,1.5])test('异常成功id保留提醒 '+id,async()=>{
 const store=new Map(),h=await prepared(store,{request:async()=>({id})});await h.page.save();assert.equal(h.page.data.uncertain,true);assert.equal(store.size,1);assert.equal(h.page.data.savedId,null);await h.page.save();assert.equal(h.calls(),1);
});
for(const state of ['editing','saved','not-uncertain','hidden','disposed'])test('已存在解除拒绝错误状态 '+state,async()=>{
 const store=new Map(),h=await prepared(store,{request:async()=>{throw Error('lost');}});await h.page.save();
 if(state==='editing')h.page.id=9;if(state==='saved')h.page.data.savedId=7;if(state==='not-uncertain')h.page.data.uncertain=false;if(state==='hidden')h.page._hidden=true;if(state==='disposed')h.page._disposed=true;
 h.page.confirmExists();assert.equal(h.modal(),undefined);assert.equal(store.size,1);
});
test('确认打开后换号不解除旧账号提醒',async()=>{
 const store=new Map(),h=await prepared(store,{request:async()=>{throw Error('lost');}});await h.page.save();h.page.confirmExists();h.session(identity(2,'B'));h.confirm(true);assert.equal(store.size,1);assert.equal(h.calls(),1);
});
