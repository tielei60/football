// 纯内存身份/请求替身，使用真实 shared.load；不访问账号、数据库或微信工具。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function deferred(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};}
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(){
 let definition,role='admin',token='A',request;
 const calls=[],events=[];
 const saved={season:{name:'隔离赛季',revision:1},roster:[{playerId:'p1',name:'已保存球员',number:0,positions:['后卫']}]};
 const players=[{id:'p1',name:'当前球员',number:9,status:'active'},{id:'p2',name:'候选球员',number:2,status:'active'}];
 const api={getSession:()=>token?{token,user:{role}}:null,ensureSession:async()=>({user:{role}}),
 request:async(...args)=>{calls.push(args);return request?request(...args):args[0]==='/players'?players:saved;}};
 const wx={stopPullDownRefresh(){},redirectTo(o){events.push(['redirect',o]);}};
 const sharedModule={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'pages/shared.js'),'utf8'),{module:sharedModule,require:n=>n.endsWith('/api')?api:n.endsWith('/media')?{imageSource:x=>x}:{playerInitial:()=>''},wx,console});
 const shared=sharedModule.exports;
 vm.runInNewContext(fs.readFileSync(path.join(root,'pages/season-roster/index.js'),'utf8'),{Page:d=>definition=d,require:n=>n==='../shared'?shared:{abort(){},showToast(){events.push(['toast']);}},wx,console});
 const p={...definition,data:structuredClone(definition.data),id:'1',setData(patch){for(const[k,v]of Object.entries(patch)){const parts=k.replace(/\[(\d+)\]/g,'.$1').split('.');let o=this.data;for(const a of parts.slice(0,-1))o=o[a];o[parts.at(-1)]=v;}}};
 return{p,api,saved,players,calls,events,setRole:v=>role=v,setToken:v=>token=v,setRequest:v=>request=v};
}
test('首次慢加载隐藏返回不误报账号变化，不重复请求或提前解除骨架',async()=>{
 const h=fixture(),d=deferred();h.setRequest(url=>url==='/players'?h.players:d.promise);
 const loading=h.p.refresh();await tick();h.p.onHide();await h.p.onShow();
 assert.equal(h.p.data.error,'');assert.equal(h.p.data.loading,true);assert.equal(h.calls.length,2);
 d.resolve(h.saved);await loading;
 assert.equal(h.p.data.error,'');assert.equal(h.p.data.loading,false);assert.equal(h.p._owner,'A');assert.equal(h.p.data.rows[0].number,'0');
});
test('相同账号相同权限返回保留未保存草稿且不重读',async()=>{
 const h=fixture();await h.p.refresh();h.p.number({currentTarget:{dataset:{id:'p1'}},detail:{value:'88'}});
 h.p.onHide();await h.p.onShow();assert.equal(h.p.data.rows[0].number,'88');assert.equal(h.calls.length,2);assert.equal(h.p.editable(),true);
});
test('降权立即移除编辑候选，重新加载成功后呈现服务端只读阵容',async()=>{
 const h=fixture();await h.p.refresh();h.p.number({currentTarget:{dataset:{id:'p1'}},detail:{value:'88'}});
 const d=deferred();h.setRequest(url=>url==='/players'?h.players:d.promise);h.p.onHide();h.setRole('player');
 const showing=h.p.onShow();await tick();
 assert.equal(h.p.data.admin,false);assert.equal(h.p.data.players.length,0);assert.equal(h.p.data.candidates.length,0);assert.equal(h.p.editable(),false);
 d.resolve(h.saved);await showing;
 assert.equal(h.p.data.rows[0].number,'0');assert.equal(h.p.data.admin,false);assert.equal(h.p.data.loading,false);
});
test('只读账号升权返回重新读取候选并恢复管理能力',async()=>{
 const h=fixture();h.setRole('player');await h.p.refresh();assert.equal(h.p.data.players.length,0);
 h.p.onHide();h.setRole('admin');await h.p.onShow();
 assert.equal(h.calls.length,4);assert.equal(h.p.data.admin,true);assert.equal(h.p.data.candidates.length,1);assert.equal(h.p.editable(),true);
});
test('首次加载期间角色变化重读，较早管理员响应不能覆盖只读状态',async()=>{
 const h=fixture(),old=deferred();h.setRequest(url=>url==='/players'?h.players:old.promise);
 const loading=h.p.refresh();await tick();h.p.onHide();h.setRole('player');h.setRequest(url=>url==='/players'?h.players:h.saved);
 await h.p.onShow();old.resolve(h.saved);await loading;
 assert.equal(h.p.data.admin,false);assert.equal(h.p.data.players.length,0);assert.equal(h.p.data.error,'');assert.equal(h.p.editable(),false);
});
test('保存未完成时降权，旧成功不能覆盖重读后的只读状态',async()=>{
 const h=fixture();await h.p.refresh();const d=deferred();
 h.setRequest((url,method)=>method==='PUT'?d.promise:url==='/players'?h.players:h.saved);
 const saving=h.p.save();await tick();h.p.onHide();h.setRole('player');await h.p.onShow();
 d.resolve({season:{revision:9},roster:[{playerId:'p1',name:'旧回执',number:99,positions:[]}]});await saving;
 assert.equal(h.p.data.admin,false);assert.equal(h.p.data.rows[0].number,'0');assert.equal(h.p.data.revision,1);assert.equal(h.p.data.busy,false);assert.deepEqual(h.events,[]);
});
test('首次加载期间切换账号不能把新账号当作原草稿拥有者',async()=>{
 const h=fixture(),d=deferred();h.setRequest(url=>url==='/players'?h.players:d.promise);
 const loading=h.p.refresh();await tick();h.p.onHide();h.setToken('B');await h.p.onShow();
 assert.match(h.p.data.error,/登录已变化/);assert.equal(h.p.data.admin,false);
 d.resolve(h.saved);await loading;assert.equal(h.p.data.rows.length,0);assert.equal(h.p.editable(),false);
});
test('身份检查尚未返回时隐藏再返回，加载归属已捕获且不误清空',async()=>{
 const h=fixture(),auth=deferred(),data=deferred();h.api.ensureSession=()=>auth.promise;
 h.setRequest(url=>url==='/players'?h.players:data.promise);
 const loading=h.p.refresh();h.p.onHide();const showing=h.p.onShow();
 assert.equal(h.p._loadingOwner,'A');assert.equal(h.p._loadAdmin,undefined);
 auth.resolve({user:{role:'admin'}});await showing;
 assert.equal(h.p.data.error,'');assert.equal(h.p.data.loading,true);assert.equal(h.calls.length,2);
 data.resolve(h.saved);await loading;
 assert.equal(h.p.data.error,'');assert.equal(h.p.data.rows[0].number,'0');assert.equal(h.p.editable(),true);
});
