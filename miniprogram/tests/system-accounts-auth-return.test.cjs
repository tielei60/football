// 当前认证恢复的纯内存测试；不创建或修改真实账号。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};}
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 let page,token='A';const routes=[];
 const api={getSession:()=>token?{token}:null,ensureSession:async()=>({user:{id:1,systemAdmin:true}}),request:async()=>[{id:2,username:'fixture-member',role:'player',playerId:'p',enabled:true,revision:1}]};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/system-accounts/index.js'),'utf8'),{Page:p=>page=p,require:r=>r.endsWith('/api')?api:{abort(){},showModal:async()=>({confirm:true})},wx:{reLaunch:o=>routes.push(o.url)},console});
 const p={...page,data:structuredClone(page.data),setData:v=>Object.assign(p.data,v)};
 return{p,api,routes,setToken:t=>token=t};
}
async function start(h,kind,d){
 await h.p.onShow();h.p.setData({username:'fixture-admin',password:'fixture-password'});
 if(kind==='refresh-auth')h.api.ensureSession=()=>d.promise;else h.api.request=()=>d.promise;
 let work;
 if(kind.startsWith('refresh'))work=h.p.refresh();
 else if(kind==='create')work=h.p.create();
 else work=h.p.update({currentTarget:{dataset:{id:2,kind:'enabled'}}});
 await tick();return{work};
}
for(const kind of ['refresh-auth','refresh-list','create','update'])test(kind+' 当前401清会话恢复登录并清除敏感页面状态',async()=>{
 const h=fixture(),d=deferred(),{work}=await start(h,kind,d);h.setToken(null);d.reject(Object.assign(Error('认证已过期'),{status:401}));await work;
 assert.equal(h.p.data.loading,false);assert.equal(h.p.data.busy,false);assert.equal(h.p.data.authorized,false);assert.equal(h.p.data.accounts.length,0);assert.equal(h.p.data.password,'');assert.equal(h.p.data.uncertain,false);assert.deepEqual(h.routes,['/pages/login/index']);
});
for(const kind of ['refresh-auth','create','update'])for(const mode of ['new-account','hidden','unloaded','new-turn','stale'])test(kind+' 旧401不接管 '+mode,async()=>{
 const h=fixture(),d=deferred(),{work}=await start(h,kind,d);h.setToken(mode==='new-account'?'B':null);
 if(mode==='hidden')h.p.onHide();if(mode==='unloaded')h.p.onUnload();if(mode==='new-turn')h.p._turn++;
 d.reject(Object.assign(Error('旧401'),{status:401,staleSession:mode==='stale'}));await work;
 assert.deepEqual(h.routes,[]);assert.notEqual(h.p.data.error,'旧401');
});
test('statusCode形式的当前401也清理创建防重锁',async()=>{
 const h=fixture(),d=deferred(),{work}=await start(h,'create',d);h.setToken(null);d.reject(Object.assign(Error('过期'),{statusCode:401}));await work;
 assert.equal(h.p.data.uncertain,false);assert.equal(h.p.data.busy,false);assert.deepEqual(h.routes,['/pages/login/index']);
});
