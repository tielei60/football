const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function fixture(name){
 let definition,token='A',redirects=0;const requests=[];
 const api={getSession:()=>token?{token}:null,ensureSession:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),request:async()=>{throw Error('不应读取业务');}};
 const wx={redirectTo(){redirects++;},stopPullDownRefresh(){}};
 const context=vm.createContext({wx,Page:d=>definition=d,Map,Set,Date,Math,Number,JSON,Promise,encodeURIComponent});
 const shared={exports:{}};vm.runInContext('(function(require,module,exports){'+fs.readFileSync(path.join(root,'pages/shared.js'),'utf8')+'\n})',context)(p=>p.includes('api')?api:{},shared,shared.exports);
 vm.runInContext('(function(require){'+fs.readFileSync(path.join(root,'pages',name,'index.js'),'utf8')+'\n})',context)(p=>p==='../shared'?shared.exports:p.endsWith('/ui')?{abort(){}}:{});
 const page={...definition,data:structuredClone(definition.data),setData(d){Object.assign(this.data,d)},draw(){},resize(){},paint(){}};page.onLoad({id:'1'});
 return {page,requests,api,redirects:()=>redirects,token:t=>token=t};
}
for(const name of ['tactic-compose','tactic-setup']){
 test(name+' 旧show错误不清新show加载，当前成功恢复缓存草稿',async()=>{
  const f=fixture(name),p=f.page;const old=p.onShow();p.onHide();const fresh=p.onShow();f.requests[0].reject(Object.assign(Error('旧网络错误'),{status:500}));await old;assert.equal(p.data.loading,true);assert.equal(p.data.error,'');
  const model={title:'未保存草稿'};p[name==='tactic-compose'?'_model':'_tactic']=model;p._owner='A';f.requests[1].resolve({user:{role:'admin'}});await fresh;assert.equal(p.data.loading,false);assert.equal(p[name==='tactic-compose'?'_model':'_tactic'],model);assert.equal(f.redirects(),0);
 });
 test(name+' 旧show成功不能启动新刷新，账号迟到401不导航',async()=>{
  const f=fixture(name),p=f.page;const old=p.onShow();p.onHide();const fresh=p.onShow();f.requests[0].resolve({user:{role:'admin'}});await old;assert.equal(f.requests.length,2);assert.equal(p.data.loading,true);f.token('B');f.requests[1].reject(Object.assign(Error('旧身份'),{status:401,staleSession:true}));await fresh;assert.equal(f.redirects(),0);assert.equal(p.data.error,'');
 });
 test(name+' 旧refresh finally不清重入加载状态',async()=>{
  const f=fixture(name),p=f.page;const old=p.refresh();p.onHide();const fresh=p.onShow();f.requests[0].reject(Object.assign(Error('旧请求'),{status:500}));await old;assert.equal(p.data.loading,true);assert.equal(p.data.error,'');p.onUnload();f.requests[1].reject(Object.assign(Error('卸载'),{status:401,staleSession:true}));await fresh;assert.equal(f.redirects(),0);
 });
 for(const status of [401,403])test(name+' 当前'+status+'清会话后仍显示失效',async()=>{
  const f=fixture(name),p=f.page;const task=p.onShow();f.token(null);f.requests[0].reject(Object.assign(Error('真实失效'),{status}));await task;assert.equal(p.data.error,'真实失效');assert.equal(p.data.loading,false);assert.equal(f.redirects(),status===401?1:0);
 });
}
