// 内存运行真实 API 请求代次逻辑，不访问服务器、不修改账号。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function fixture(){
 const stored={token:'native_'+ 'a'.repeat(64),expiresAt:Date.now()+60000,serverOrigin:'https://club.example',user:{id:1,teamId:1,role:'admin',mustChangePassword:true},team:{id:1}};
 const storage=new Map([['football.native.session.v1',stored]]),requests=[],routes=[];
 const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),request:r=>requests.push(r),reLaunch:r=>routes.push(r.url)};
 const context={module:{exports:{}},require:n=>n==='./media'?{clearImageCache(){}}:n==='./player-photo-cache'?{clearAll(){}}:{apiBaseUrl:'https://club.example'},wx,Date,Number,Promise,Error};
 vm.runInNewContext(fs.readFileSync(path.join(root,'utils/api.js'),'utf8'),context);const api=context.module.exports;let def;
 vm.runInNewContext(fs.readFileSync(path.join(root,'pages/force-password/index.js'),'utf8'),{Page:p=>def=p,require:n=>n.endsWith('/api')?api:{abort(){}},wx});
 const p={...def,data:structuredClone(def.data),setData:v=>Object.assign(p.data,v),_owner:api.getSession().token,_turn:1};
 p.setData({loading:false,currentPassword:'fictional-old',newPassword:'fictional-new-123',confirmation:'fictional-new-123'});
 return{api,p,routes,requests,complete:(status=401)=>requests[0].success({statusCode:status,data:status===200?{}:{error:'登录过期'}})};
}
for(const response of [200,401])test('真实API：已清空会话后迟到'+response+'转stale401，不接管页面',async()=>{
 const f=fixture(),work=f.p.submit();f.api.clearSession();f.p.setData({busy:true,error:'新的页面状态',currentPassword:'new-draft'});f.complete(response);await work;
 assert.deepEqual(f.routes,[]);assert.equal(f.p.data.busy,true);assert.equal(f.p.data.currentPassword,'new-draft');assert.equal(f.p.data.error,'新的页面状态');
});
for(const mode of ['hidden','unloaded','returned'])test('真实API：'+mode+'迟到回执不结束新视图',async()=>{
 const f=fixture(),work=f.p.submit();if(mode==='unloaded')f.p.onUnload();else f.p.onHide();if(mode==='returned'){f.p._hidden=false;f.p._turn++;}f.p.setData({busy:true,currentPassword:'new-draft'});f.complete();await work;
 assert.deepEqual(f.routes,[]);assert.equal(f.p.data.busy,true);assert.equal(f.p.data.currentPassword,'new-draft');
});
test('当前真实401清空session后结束等待、清输入并登录',async()=>{const f=fixture(),work=f.p.submit();f.complete();await work;assert.equal(f.api.getSession(),null);assert.equal(f.p.data.busy,false);assert.equal(f.p.data.currentPassword,'');assert.deepEqual(f.routes,['/pages/login/index']);});
test('当前成功仍清session与输入并登录',async()=>{const f=fixture(),work=f.p.submit();f.complete(200);await work;assert.equal(f.api.getSession(),null);assert.equal(f.p.data.busy,false);assert.equal(f.p.data.newPassword,'');assert.deepEqual(f.routes,['/pages/login/index']);});
test('当前普通失败仍显示错误结束等待',async()=>{const f=fixture(),work=f.p.submit();f.complete(500);await work;assert.ok(f.p.data.error);assert.equal(f.p.data.busy,false);assert.deepEqual(f.routes,[]);});
for(const response of [200,401])test('真实API：B已登录后旧A '+response+'不清除B表单或会话',async()=>{
 const f=fixture(),work=f.p.submit();const login=f.api.beginLogin('fictional-b','fictional');
 f.requests[1].success({statusCode:200,data:{token:'native_'+'b'.repeat(64),expiresAt:Date.now()+60000,user:{id:2,teamId:1,role:'admin',mustChangePassword:true},team:{id:1}}});await login.promise;
 f.p.setData({busy:true,currentPassword:'B-draft',error:'B-state'});f.complete(response);await work;
 assert.equal(f.api.getSession().user.id,2);assert.equal(f.p.data.currentPassword,'B-draft');assert.equal(f.p.data.busy,true);assert.equal(f.p.data.error,'B-state');assert.deepEqual(f.routes,[]);
});
