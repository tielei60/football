const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const flush = async () => { for(let i=0;i<8;i++) await Promise.resolve(); };
function setup() {
  let owner='A', role='admin', definition;
  const records=deferred(), capability=deferred();
  let count=0;
  const api={getSession:()=>({token:owner}),ensureSession:async()=>({user:{role},team:{id:'team'}}),request:()=>records.promise,capabilities:()=>{count++;return capability.promise;}};
  const s={api,assetUrl:()=>'',safeSetData:(p,v)=>p.setData(v),fail:(p,e)=>p.setData({error:e.message}),unload(){this._disposed=true;this._epoch=(this._epoch||0)+1;}};
  const ui={abort(){}}; const wx={stopPullDownRefresh(){}};
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/manage-team/admin.js'),'utf8'),{module,require:id=>id.includes('/ui')?ui:s,wx});
  vm.runInNewContext(fs.readFileSync(path.join(root,'pages/manage-player/index.js'),'utf8'),{Page:d=>definition=d,require:id=>id.includes('/ui')?ui:module.exports,wx});
  const p={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,structuredClone(v));}};
  return {p,api,records,capability, count:()=>count,setOwner:v=>owner=v,setRole:v=>role=v,player:{id:'p1',name:'匿名球员',status:'active',revision:1}};
}
test('真实 onLoad + onShow 并发顺序首载在权限完成后显示微信入口',async()=>{
  const h=setup(), session=deferred(); h.api.ensureSession=()=>session.promise;
  const loading=h.p.onLoad({id:'p1'}); await h.p.onShow();
  assert.equal(h.p.data.authorized,false); assert.equal(h.count(),0);
  session.resolve({user:{role:'admin'},team:{id:'team'}}); await flush();
  h.records.resolve([h.player]); await flush(); assert.equal(h.count(),1);
  h.capability.resolve({wechat:true}); await loading;
  assert.equal(h.p.data.loading,false); assert.equal(h.p.data.authorized,true); assert.equal(h.p.data.wechatEnabled,true);
});
for(const mode of ['disabled','error']) test('能力'+mode+'不阻断原球员管理且不显示微信入口',async()=>{
  const h=setup(); const loading=h.p.onLoad({id:'p1'});await h.p.onShow();h.records.resolve([h.player]);await flush();
  if(mode==='error')h.capability.reject(Error('离线'));else h.capability.resolve({wechat:false});
  await loading;assert.equal(h.p.data.authorized,true);assert.equal(h.p.data.wechatEnabled,false);assert.equal(h.p.data.error,'');
});
test('首载能力迟到在 hide 后不提交，返回后通过正常 refresh 恢复',async()=>{
  const h=setup();const loading=h.p.onLoad({id:'p1'});await h.p.onShow();h.records.resolve([h.player]);await flush();h.p.onHide();h.capability.resolve({wechat:true});await loading;
  assert.equal(h.p.data.authorized,false);assert.equal(h.p.data.wechatEnabled,false);
  await h.p.onShow();assert.equal(h.p.data.authorized,true);assert.equal(h.p.data.wechatEnabled,true);
});
test('A 首载迟到能力不可写入 B，B 返回后重新鉴权读取',async()=>{
  const h=setup();const loading=h.p.onLoad({id:'p1'});await h.p.onShow();h.records.resolve([h.player]);await flush();h.setOwner('B');h.capability.resolve({wechat:true});await loading;
  assert.equal(h.p.data.authorized,false);assert.equal(h.p.data.wechatEnabled,false);
  h.api.capabilities=async()=>({wechat:false});await h.p.onShow();assert.equal(h.p.data.authorized,true);assert.equal(h.p.data.wechatEnabled,false);
});
test('非管理员首载拒绝权限且不读取管理入口能力',async()=>{
  const h=setup();h.setRole('player');await h.p.onLoad({id:'p1'});await h.p.onShow();assert.equal(h.p.data.authorized,false);assert.equal(h.count(),0);assert.match(h.p.data.error,/管理员/);
});
