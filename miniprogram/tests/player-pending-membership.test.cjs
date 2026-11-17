// 仅内存真实共享函数回归，不代替原生未知结果验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(){
 let owner='fixture-A', result, failure=true;const requests=[];
 const shared={api:{getSession:()=>({token:owner}),ensureSession:async()=>({user:{role:'admin'}}),request:async(...args)=>{requests.push(JSON.parse(JSON.stringify(args)));if(failure)throw Object.assign(new Error('fixture-unknown'),{status:502});return result;}},safeSetData:(p,v)=>p.setData(v)};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/manage-team/admin.js'),'utf8'),{module,require:n=>n.includes('/ui')?{}:shared,wx:{stopPullDownRefresh(){}}});
 const a=module.exports;
 const make=(kind='player')=>({createKind:kind,data:{form:{name:'fixture'},status:'active',membershipConfirmed:true,membershipIndex:1,avatar:'',positionOptions:[],feet:[],footIndex:0},setData(v){Object.assign(this.data,v);}});
 const load=p=>a.load(p,async()=>({form:{name:''},status:'active',membershipConfirmed:true,membershipIndex:1}));
 return {a,make,load,requests,owner:v=>owner=v,succeed:v=>{failure=false;result=v;}};
}
for(const [status,confirmed,index]of[['active',false,0],['inactive',true,2],['active',true,1]])test(`球员未知新建恢复成员三态${index}且保留防重`,async()=>{
 const h=setup(),p=h.make();Object.assign(p.data,{status,membershipConfirmed:confirmed,membershipIndex:index});
 const payload={name:'fixture',status,membershipConfirmed:confirmed};
 await assert.rejects(h.a.createRequest(p,'/players',payload));
 const next=h.make();await h.load(next);
 assert.equal(next.data.status,status);assert.equal(next.data.membershipConfirmed,confirmed);assert.equal(next.data.membershipIndex,index);assert.equal(next.data.uncertain,true);
 assert.equal(next.data.form.name,'fixture');await assert.rejects(h.a.createRequest(next,'/players',payload));
 assert.equal(h.requests.length,1);assert.deepEqual(h.requests[0],['/players','POST',payload]);
});
test('球员pending不跨账号恢复',async()=>{
 const h=setup(),p=h.make();Object.assign(p.data,{status:'inactive',membershipIndex:2});await assert.rejects(h.a.createRequest(p,'/players',{}));h.owner('fixture-B');const next=h.make();await h.load(next);assert.equal(next.data.status,'active');assert.equal(next.data.membershipIndex,1);assert.equal(next.data.form.name,'');assert.notEqual(next.data.uncertain,true);
});
test('已成功但未消费的新建回执恢复一次，后续不残留成员状态',async()=>{
 const h=setup(),p=h.make();Object.assign(p.data,{status:'inactive',membershipIndex:2});h.succeed({id:'fixture-id',revision:1});await h.a.createRequest(p,'/players',{});
 const next=h.make();await h.load(next);assert.equal(next.id,'fixture-id');assert.equal(next.data.status,'inactive');assert.equal(next.data.membershipIndex,2);assert.equal(next.data.uncertain,false);
 const empty=h.make();await h.load(empty);assert.equal(empty.data.status,'active');assert.equal(empty.data.form.name,'');assert.equal(empty.id,undefined);
});
test('非球员新建不引入成员状态快照',async()=>{
 const h=setup(),p=h.make('season');Object.assign(p.data,{status:'inactive',membershipIndex:2});await assert.rejects(h.a.createRequest(p,'/seasons',{}));const next=h.make('season');await h.load(next);assert.equal(next.data.membershipIndex,1);assert.equal(next.data.status,'active');assert.equal(next.data.form.name,'fixture');
});
