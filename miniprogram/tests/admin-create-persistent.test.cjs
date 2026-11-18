// 真实共享admin控制器；独立VM模拟重启，存储和传输全为匿名内存替身。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../pages/manage-team/admin.js'),'utf8');
const identity=(id=1,token='A',origin='https://club.example',team=1)=>({token,serverOrigin:origin,user:{id,role:'admin'},team:{id:team}});
function boot(store=new Map(),options={}){
 let session=options.session||identity(),modal,calls=0;const events=[];
 const api={getSession:()=>session,ensureSession:async()=>{if(options.preflightFail)throw Error('预检失败');return session;},request:async(...args)=>{calls++;return options.request?options.request(...args):{id:args[0]==='/seasons'?7:'player-7',revision:1};}};
 const s={api,safeSetData:(p,v)=>p.setData(v),fail:(p,e)=>{events.push('fail');p.setData({error:e.message});},unload(){this._disposed=true;}};
 const wx={getStorageSync:k=>{if(options.readFail&&store.has(k))throw Error('读回失败');return store.get(k);},setStorageSync:(k,v)=>{if(options.writeFail)throw Error('写入失败');store.set(k,v);},removeStorageSync:k=>{if(options.removeFail)throw Error('删除失败');store.delete(k);},stopPullDownRefresh(){}};
 const context={module:{exports:{}},require:n=>n.includes('/ui')?{abort(){},showToast(){events.push('toast');},showModal:(p,o)=>{modal=o;}}:s,wx};vm.runInNewContext(source,context);const a=context.module.exports;
 function page(kind){const p={createKind:kind,data:{form:{name:'私密姓名',note:'私密备注'},busy:false,uncertain:false,authorized:false},setData(v){Object.assign(this.data,v);},backToList(){events.push('back');},refresh(){return a.load(this,async()=>({form:{name:'',note:''},uncertain:false}));}};p.save=()=>a.act(p,()=>a.createRequest(p,kind==='season'?'/seasons':'/players',{name:p.data.form.name}),(r)=>{p.id=r.id;},true);p.exists=()=>a.confirmCreated.call(p);p.absent=()=>a.confirmNotCreated.call(p);return p;}
 return {page,events,a,api,calls:()=>calls,setSession:s=>session=s,confirm:v=>modal.success({confirm:v}),modal:()=>modal};
}
async function ready(h,kind){const p=h.page(kind);await p.refresh();p.data.form.name='私密姓名';p._imageData='私密照片';return p;}
for(const kind of ['player','season'])for(const outcome of ['network','502','stale'])test(kind+'跨运行/重登未知恢复 '+outcome,async()=>{
 const store=new Map(),h=boot(store,{request:async()=>{throw Object.assign(Error('回执未知'),outcome==='502'?{status:502}:outcome==='stale'?{status:401,staleSession:true}:{});}}),p=await ready(h,kind);await p.save();assert.equal(h.calls(),1);assert.equal(store.size,1);assert.ok(!JSON.stringify([...store]).includes('私密'));assert.ok(!JSON.stringify([...store]).includes('token'));
 const next=boot(store,{session:identity(1,'A2')}),q=next.page(kind);await q.refresh();assert.equal(q.data.uncertain,true);assert.match(q.data.actionError,/核对/);assert.equal(q._imageData,undefined);assert.equal(q.data.form.name,'');
 await q.save();assert.equal(next.calls(),0);q.exists();next.confirm(false);assert.equal(store.size,1);q.exists();next.confirm(true);assert.equal(store.size,0);assert.equal(next.calls(),0);assert.deepEqual(next.events,['back']);assert.ok(!h.events.includes('fail'));
});
test('两个kind互不阻挡，解除一个不清另一个',async()=>{
 const store=new Map(),h=boot(store,{request:async()=>{throw Error('lost');}});const p=await ready(h,'player'),q=await ready(h,'season');await p.save();await q.save();assert.equal(h.calls(),2);assert.equal(store.size,2);
 const next=boot(store);const r=await ready(next,'player');r.absent();next.confirm(true);assert.equal(store.size,1);const s=await ready(next,'season');assert.equal(s.data.uncertain,true);
});
for(const mode of ['user','origin','team'])test('账号范围隔离 '+mode,async()=>{
 const store=new Map(),a=boot(store,{request:async()=>{throw Error('lost');}});await(await ready(a,'player')).save();const baseline=JSON.stringify([...store]);
 const b=boot(store,{session:mode==='user'?identity(2,'B'):mode==='origin'?identity(1,'B','https://b.example'):identity(1,'B','https://club.example',2)});const p=await ready(b,'player');assert.equal(p.data.uncertain,false);await p.save();assert.equal(b.calls(),1);assert.equal(JSON.stringify([...store]),baseline);
});
for(const mode of ['writeFail','readFail','preflightFail'])test('发送前失败零POST且可恢复 '+mode,async()=>{
 const store=new Map(),opts={},h=boot(store,opts),p=await ready(h,'season');opts[mode]=true;await p.save();assert.equal(h.calls(),0);assert.equal(p.data.busy,false);if(mode!=='readFail')assert.equal(store.size,0);
 opts[mode]=false;const next=boot(store),q=await ready(next,'season');if(store.size){assert.equal(q.data.uncertain,true);q.absent();next.confirm(true);}await q.save();assert.equal(next.calls(),1);
});
test('本地序列化失败不写guard也不POST',async()=>{const store=new Map(),h=boot(store),p=await ready(h,'season');p.data.form.loop=p.data.form;await p.save();assert.equal(h.calls(),0);assert.equal(store.size,0);assert.equal(p.data.uncertain,false);assert.equal(p.data.busy,false);});
test('成功后清理失败不允许重复，恢复后核对已存在仅返回',async()=>{
 const store=new Map(),opts={removeFail:true},h=boot(store,opts),p=await ready(h,'player');await p.save();assert.equal(p.id,undefined);assert.equal(p.data.uncertain,true);await p.save();assert.equal(h.calls(),1);opts.removeFail=false;
 const next=boot(store),q=await ready(next,'player');q.exists();next.confirm(true);assert.equal(next.calls(),0);assert.equal(store.size,0);
});
for(const kind of ['player','season'])for(const id of [null,0,{},kind==='player'?7:'7'])test(kind+'异常成功ID不进入done '+JSON.stringify(id),async()=>{const store=new Map(),h=boot(store,{request:async()=>({id})}),p=await ready(h,kind);await p.save();assert.equal(p.id,undefined);assert.equal(p.data.uncertain,true);assert.equal(store.size,1);});
for(const status of [400,403,409])test('明确拒绝精确清除 '+status,async()=>{const store=new Map(),h=boot(store,{request:async()=>{throw Object.assign(Error('拒绝'),{status});}}),p=await ready(h,'season');await p.save();assert.equal(store.size,0);assert.equal(p.data.busy,false);});
test('旧回执和旧确认不能删除新标记',async()=>{const store=new Map();let resolve;const h=boot(store,{request:()=>new Promise(r=>resolve=r)}),p=await ready(h,'season');const work=p.save();await new Promise(r=>setImmediate(r));const key=[...store.keys()][0];store.set(key,{taskId:'new',createdAt:1});resolve({id:7});await work;assert.equal(store.get(key).taskId,'new');const next=boot(store),q=await ready(next,'season');q.exists();store.set(key,{taskId:'newer',createdAt:2});next.confirm(true);assert.equal(store.get(key).taskId,'newer');assert.equal(q.data.uncertain,true);});
for(const mode of ['hidden','disposed','editing','known-id','busy'])test('解除入口门禁 '+mode,async()=>{const store=new Map(),h=boot(store,{request:async()=>{throw Error('lost');}}),p=await ready(h,'season');await p.save();if(mode==='hidden')p._hidden=true;if(mode==='disposed')p._disposed=true;if(mode==='editing')p.id=7;if(mode==='known-id')p.data.id=7;if(mode==='busy')p.data.busy=true;p.exists();assert.equal(h.modal(),undefined);assert.equal(store.size,1);});
test('在途与旧确认换号不能解除',async()=>{const store=new Map();let resolve;const h=boot(store,{request:()=>new Promise(r=>resolve=r)}),p=await ready(h,'season');const work=p.save();await new Promise(r=>setImmediate(r));const q=await ready(h,'season');q.exists();assert.equal(h.modal(),undefined);assert.equal(store.size,1);resolve({id:7});await work;
 const first=boot(store,{request:async()=>{throw Error('lost');}}),r=await ready(first,'player');await r.save();r.exists();first.setSession(identity(2,'B'));first.confirm(true);assert.equal(store.size,1);
});

// 精确逆投影阶段40修改后仍固定旧共享业务摘要，不允许顺带改变其他逻辑。
test('共享admin创建恢复仅允许审定变更',()=>{
 const crypto=require('node:crypto'),changes=require('./admin-create-persistent-projection.json')['pages/manage-team/admin.js'];
 const normalize=value=>{for(const {before,after}of changes){assert.equal(value.split(after).length,2);value=value.replace(after,before);}return value;};
 assert.equal(crypto.createHash('sha256').update(normalize(source)).digest('hex'),'13ccc8d44228f2e6d3b3cf27391e8e11ef7bc7a28cb0cfd94a5c8480a77cfe58');
 assert.throws(()=>normalize(source+source));
 for(const {after}of changes)assert.throws(()=>normalize(source.replace(after,after.replace(/\S/,'!'))));
 assert.equal(normalize(source+'\n//extra'),normalize(source)+'\n//extra');
});
