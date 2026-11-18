// 只验证加载回执归属；不提交任何密码或访问真实账号。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 let definition,token='A',resolve,reject;const routes=[];
 const api={getSession:()=>token?{token}:null,ensureSession:()=>new Promise((r,j)=>{resolve=r;reject=j}),enterAuthenticated:()=>routes.push('home')};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/force-password/index.js'),'utf8'),{Page:p=>definition=p,require:r=>r.endsWith('/api')?api:{abort(){}},wx:{reLaunch:o=>routes.push(o.url)}});
 const p={...definition,data:structuredClone(definition.data),setData:v=>Object.assign(p.data,v)};
 return{p,routes,token:v=>token=v,resolve:v=>resolve(v),reject:e=>reject(e)};
}
for(const stale of [false,true])test('旧账号加载失败不得覆盖新账号显示 stale='+stale,async()=>{
 const h=fixture(),work=h.p.onShow();h.token('B');h.p.setData({loading:true,error:'新页面',errorSource:'load'});h.reject(Object.assign(Error('旧账号失败'),{status:401,staleSession:stale}));await work;
 assert.equal(h.p.data.error,'新页面');assert.equal(h.p.data.loading,true);assert.deepEqual(h.routes,[]);
});
for(const mode of ['hidden','unloaded','new-turn'])test('加载失败不影响'+mode,async()=>{
 const h=fixture(),work=h.p.onShow();h.token(null);if(mode==='hidden')h.p.onHide();if(mode==='unloaded')h.p.onUnload();if(mode==='new-turn')h.p._turn++;
 h.reject(Object.assign(Error('旧401'),{status:401}));await work;assert.equal(h.p.data.error,'');assert.deepEqual(h.routes,[]);
});
test('当前401清空会话仍结束骨架并转登录',async()=>{
 const h=fixture(),work=h.p.onShow();h.token(null);h.reject(Object.assign(Error('登录过期'),{status:401}));await work;
 assert.equal(h.p.data.loading,false);assert.equal(h.p.data.error,'登录过期');assert.deepEqual(h.routes,['/pages/login/index']);
});
test('旧会话标记401不能借空会话接管页面',async()=>{
 const h=fixture(),work=h.p.onShow();h.token(null);h.reject(Object.assign(Error('旧401'),{status:401,staleSession:true}));await work;
 assert.equal(h.p.data.error,'');assert.equal(h.p.data.loading,true);assert.deepEqual(h.routes,[]);
});
test('同账号普通初始化错误正常提示并结束等待',async()=>{
 const h=fixture(),work=h.p.onShow();h.reject(Error('网络失败'));await work;assert.equal(h.p.data.error,'网络失败');assert.equal(h.p.data.loading,false);assert.deepEqual(h.routes,[]);
});
test('旧账号加载成功也不能结束新账号的等待',async()=>{
 const h=fixture(),work=h.p.onShow();h.token('B');h.resolve({user:{mustChangePassword:true}});await work;
 assert.equal(h.p.data.loading,true);assert.deepEqual(h.routes,[]);
});
