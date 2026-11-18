// 仅内存真实共享函数回归，不代替原生未知结果验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(){
 let owner='fixture-A', result, failure=true;const requests=[],storage=new Map();
 const shared={api:{getSession:()=>({token:owner,serverOrigin:'https://club.example',user:{id:owner==='fixture-A'?1:2},team:{id:1}}),ensureSession:async()=>({user:{role:'admin'}}),request:async(...args)=>{requests.push(JSON.parse(JSON.stringify(args)));if(failure)throw Object.assign(new Error('fixture-unknown'),{status:502});return result;}},safeSetData:(p,v)=>p.setData(v)};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/manage-team/admin.js'),'utf8'),{module,require:n=>n.includes('/ui')?{}:shared,wx:{getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),stopPullDownRefresh(){}}});
 const a=module.exports;
 const make=(kind='player')=>({createKind:kind,data:{form:{name:'匿名恢复'},initial:'匿',status:'active',membershipConfirmed:true,membershipIndex:1,avatar:'',positionOptions:[],feet:[],footIndex:0},setData(v){Object.assign(this.data,v);}});
 const load=p=>a.load(p,async()=>({form:{name:''},initial:'球',status:'active',membershipConfirmed:true,membershipIndex:1}));
 return {a,make,load,requests,owner:v=>owner=v,succeed:v=>{failure=false;result=v;}};
}
for(const known of [false,true])test(`球员跨页${known?'已知成功回执':'未知创建'}恢复姓名与头像首字一致`,async()=>{
 const h=setup(),p=h.make();
 if(known){h.succeed({id:'fixture-player',revision:1});await h.a.createRequest(p,'/players',{});}else await assert.rejects(h.a.createRequest(p,'/players',{}));
 const next=h.make();await h.load(next);
 assert.equal(next.data.form.name,'匿名恢复');assert.equal(next.data.initial,'匿');
});
test('首字快照不跨账号恢复',async()=>{
 const h=setup(),p=h.make();await assert.rejects(h.a.createRequest(p,'/players',{}));h.owner('fixture-B');
 const next=h.make();await h.load(next);assert.equal(next.data.form.name,'');assert.equal(next.data.initial,'球');
});
test('非球员pending不保存球员首字投影',async()=>{
 const h=setup(),p=h.make('season');await assert.rejects(h.a.createRequest(p,'/seasons',{}));
 const next=h.make('season');await h.load(next);assert.equal(next.data.initial,'球');
});
