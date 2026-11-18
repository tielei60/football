// 真实 api/shared 控制器回归；不冒充微信原生操作。
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
function fixture(){
 let def;const identity={user:{id:1,username:'fixture-admin',teamId:1,role:'admin'},team:{id:1,name:'匿名球队'}};
 const stored={...identity,token:'native_'+'a'.repeat(64),expiresAt:Date.now()+60000,serverOrigin:'https://club.example'};
 const storage=new Map([['football.native.session.v1',stored]]),pending=[],redirects=[];
 const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),stopPullDownRefresh(){},redirectTo:o=>redirects.push(o.url),request:r=>{if(r.method==='PUT'){pending.push(r);return;}const u=new URL(r.url);const data=u.pathname.endsWith('/auth/native-login')?{...stored,token:'native_'+'b'.repeat(64)}:u.pathname.endsWith('/auth/me')?identity:u.pathname.endsWith('/players')?[]:{season:{name:'匿名赛季',revision:2},roster:[]};queueMicrotask(()=>r.success({statusCode:200,data}));}};
 const ac={module:{exports:{}},require:n=>n==='./media'?{clearImageCache(){}}:n==='./player-photo-cache'?{clearAll(){}}:{apiBaseUrl:'https://club.example'},wx};vm.runInNewContext(fs.readFileSync(path.join(root,'utils/api.js'),'utf8'),ac);const api=ac.module.exports;
 const sc={module:{exports:{}},require:n=>n.endsWith('/api')?api:{imageSource:x=>x},wx};vm.runInNewContext(fs.readFileSync(path.join(root,'pages/shared.js'),'utf8'),sc);
 vm.runInNewContext(fs.readFileSync(path.join(root,'pages/season-roster/index.js'),'utf8'),{Page:p=>def=p,require:n=>n.includes('/utils/ui')?{abort(){},showToast(){}}:sc.module.exports,wx});
 const p={...def,id:'1',data:structuredClone(def.data),setData:v=>Object.assign(p.data,v)};
 return{p,api,pending,redirects};
}
async function saving(f){const work=f.p.save();await new Promise(r=>setImmediate(r));assert.equal(f.pending.length,1);return {work};}
function reject(f){f.pending[0].success({statusCode:401,data:{message:'登录已过期'}});}
test('当前PUT401真实API先清会话，页面结束等待并跳登录',async()=>{const f=fixture();await f.p.refresh();const {work}=await saving(f);reject(f);await work;assert.equal(f.api.getSession(),null);assert.equal(f.p.data.busy,false);assert.equal(f.redirects.length,1);assert.equal(f.redirects[0],'/pages/login/index');});
test('隐藏时当前401不主动导航，返回后由真实ensure引导登录',async()=>{const f=fixture();await f.p.refresh();f.p._first=false;const {work}=await saving(f);f.p.onHide();reject(f);await work;assert.equal(f.redirects.length,0);assert.equal(f.p.data.busy,false);await f.p.onShow();assert.equal(f.redirects.length,1);});
test('卸载后当前401不能回写页面或导航',async()=>{const f=fixture();await f.p.refresh();const {work}=await saving(f);f.p.onUnload();reject(f);await work;assert.equal(f.redirects.length,0);});
test('真实API旧代次stale401不覆盖新页面忙态或导航',async()=>{const f=fixture();await f.p.refresh();const {work}=await saving(f);f.api.clearSession();f.p.data.error='新页面状态';f.p.data.busy=true;reject(f);await work;assert.equal(f.p.data.error,'新页面状态');assert.equal(f.p.data.busy,true);assert.equal(f.redirects.length,0);});
test('失去保存attempt归属的401不能释放后续busy',async()=>{const f=fixture();await f.p.refresh();const {work}=await saving(f);f.p._saveAttempt={};f.p.data.error='后续尝试';reject(f);await work;assert.equal(f.p.data.busy,true);assert.equal(f.p.data.error,'后续尝试');assert.equal(f.redirects.length,0);});

test('A的真实stale401迟到不能清B会话或释放B保存等待',async()=>{const f=fixture();await f.p.refresh();const {work}=await saving(f);await f.api.login('fixture-b','fixture-password');const token=f.api.getSession().token;f.p._owner=token;f.p.data.error='B的草稿';f.p.data.busy=true;reject(f);await work;assert.equal(f.api.getSession().token,token);assert.equal(f.p.data.error,'B的草稿');assert.equal(f.p.data.busy,true);assert.equal(f.redirects.length,0);});
const blocks=require('./season-roster-auth-projection.json');
function normalize(source){for(const {before,after} of blocks){assert.ok(before&&after);assert.equal(source.split(after).length,2);source=source.replace(after,before);}return source;}
test('认证恢复投影拒绝重复篡改且保留其它代码',()=>{const source=fs.readFileSync(path.join(root,'pages/season-roster/index.js'),'utf8');assert.throws(()=>normalize(source+source));assert.throws(()=>normalize(source.replace('this._saveAttempt!==attempt','false')));const extra='\n// 额外代码仍参与旧SHA\n';assert.equal(normalize(source+extra),normalize(source)+extra);});
