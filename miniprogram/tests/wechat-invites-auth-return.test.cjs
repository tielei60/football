const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../pages/wechat-invites/logic.js'), 'utf8').replace('module.exports = {', 'Page({').replace(/};\s*$/, '});');
function setup(options = {}) {
  let session = { token: 'fictional-admin', user: { id: 1, role: 'admin' }, team: {id:1} }, definition;
  const requests = [], modals = [], clipboard = [], failures = [];
  const active = { id: 'a'.repeat(32), status: 'pending', revision: 1, expiresAt: 2000000000000 };
  let list = { items: [], activeInvite: null, nextCursor: null };
  const api = {
    getSession: () => session, ensureSession: async () => ({user: session.user, team: session.team}),
    capabilities: async () => ({ wechat: true }),
    request: async (url, method, body) => {
      requests.push({ url, method, body });
      if (options.request) return options.request(url, method, body);
      if (url === '/players') return [{ id: 'p1', name: '模拟球员', status: 'active' }];
      if (url.endsWith('binding')) return { bound: false, revision: 0, passwordEnabled: false };
      if (method === 'POST' && url.endsWith('invites')) { list = { items: [active], activeInvite: active, nextCursor: null }; return { ...active, credential: 'b'.repeat(64) }; }
      return list;
    }, ...options.api
  };
  const ui = { abort() {}, showToast() {}, showModal(page, config) { modals.push(config); } };
  vm.runInNewContext(source, {
    require: name => name === '../shared' ? { api, fail(page, error) { failures.push(error); page.setData({ error: error.message }); } } : ui,
    Page: value => { definition = value; },
    wx: { setClipboardData(config) { clipboard.push(config.data); config.success(); } },
    console, Date, Math, Map, Number, String, encodeURIComponent
  });
  const page = { ...definition, route: "pages/wechat-invites/index", options: {}, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, structuredClone(value)); } };
  page.onLoad({ id: 'p1' });
  return { page, requests, modals, clipboard, failures, api, active, setList(value) { list = value; }, setSession(value) { session = value; } };
}

for (const operation of ['create', 'mutate', 'more', 'generateCard']) {
  for (const context of ['current', 'new-account', 'hidden', 'unloaded', 'stale']) {
    test(`${operation} 401：${context} 保持认证恢复归属`, async () => {
      const f = setup(); await f.page.onShow();
      if (operation === 'more') f.page._cursor = 'cursor';
      if (operation === 'generateCard') {
        f.page._credential = { id: f.active.id, value: 'b'.repeat(64) };
        f.page.setData({canCopy:true,activeInvite:f.active});
      }
      let reject;
      f.api.request = () => new Promise((resolve, fail) => { reject = fail; });
      const pending = operation === 'mutate' ? f.page.mutate('/test', {}) : f.page[operation]();
      f.setSession(context === 'new-account' ? { token:'other', user:{id:2,role:'admin'},team:{id:1} } : null);
      if (context === 'hidden') f.page.onHide();
      if (context === 'unloaded') f.page.onUnload();
      reject(Object.assign(Error('登录已过期'),{status:401,staleSession:context==='stale'}));
      await pending;
      assert.equal(f.failures.length, context === 'current' ? 1 : 0);
      if (context === 'current') {
        assert.equal(f.page.data.busy,false); assert.equal(f.page.data.loadingMore,false);
        assert.equal(f.page.data.authorized,false); assert.equal(f.page.data.canCopy,false);
        assert.equal(f.page.data.cardPath,''); assert.equal(f.page.data.cardOpen,false);
        assert.equal(f.page._credential,null); assert.equal(f.page._createId,null);
        assert.equal(f.page.data.items.length,0); assert.equal(f.page.data.binding,null);
        assert.equal(f.page.data.playerName,'');
      }
    });
  }
}

for (const failureAt of ['ensureSession', 'players', 'binding', 'invites']) {
  for (const context of ['current', 'new-account', 'hidden', 'unloaded', 'stale']) {
    test(`载入 ${failureAt} 401：${context} 归属与敏感清理`, async () => {
      const f = setup();
      f.page._credential = {id:'old',value:'private'};
      f.page.setData({cardPath:'private-card',cardOpen:true,items:[{id:'old'}],binding:{bound:true},playerName:'旧球员'});
      let reject;
      const deferred = () => new Promise((resolve,fail) => { reject=fail; });
      if (failureAt === 'ensureSession') f.api.ensureSession=deferred;
      else {
        const request=f.api.request;
        f.api.request=(url,...args)=> ((failureAt==='players' && url==='/players') || url.endsWith('wechat-'+failureAt)) ? deferred() : request(url,...args);
      }
      const pending=f.page.onShow();
      for(let i=0;i<15&&!reject;i++) await Promise.resolve();
      assert.equal(typeof reject,'function');
      f.setSession(context==='new-account'?{token:'new',user:{id:2,role:'admin'},team:{id:1}}:null);
      if(context==='hidden') f.page.onHide();
      if(context==='unloaded') f.page.onUnload();
      reject(Object.assign(Error('登录已过期'),{status:401,staleSession:context==='stale'}));
      await pending;
      assert.equal(f.failures.length,context==='current'?1:0);
      if(context==='current') {
        assert.equal(f.page.data.loading,false); assert.equal(f.page.data.authorized,false);
        assert.equal(f.page._credential,null); assert.equal(f.page.data.cardOpen,false);
        assert.equal(f.page.data.cardPath,''); assert.equal(f.page.data.items.length,0);
        assert.equal(f.page.data.binding,null); assert.equal(f.page.data.playerName,'');
      }
    });
  }
}
test('无会话直接进入邀请页也结束载入并返回登录', async()=>{
  const f=setup({api:{ensureSession:async()=>{throw Object.assign(Error('请先登录'),{status:401})}}});
  f.setSession(null); await f.page.onShow(); assert.equal(f.failures.length,1); assert.equal(f.page.data.loading,false);
});

// 阶段24：补公开能力请求及同账号刷新代次，不重复已有换账号矩阵。
for (const clear of [false,true]) test('能力请求401会话'+(clear?'已清理':'仍保留')+'按当前状态恢复',async()=>{
  const f=setup(); let reject;
  f.api.capabilities=()=>new Promise((r,j)=>{reject=j});
  const work=f.page.onShow();for(let i=0;i<10&&!reject;i++)await Promise.resolve();
  if(clear)f.setSession(null);
  reject(Object.assign(Error('能力请求被拒绝'),{status:401}));await work;
  assert.equal(f.page.data.loading,false);assert.equal(f.page.data.authorized,false);
  assert.equal(f.failures.length,clear?1:0);assert.equal(f.page.data.error,'能力请求被拒绝');
  assert.equal(f.requests.length,0);
});
for(const operation of ['refresh','create','mutate','more','generateCard'])test(operation+' statusCode401仍可结束等待',async()=>{
  const f=setup();await f.page.onShow();
  if(operation==='more')f.page._cursor='cursor';
  if(operation==='generateCard'){f.page._credential={id:f.active.id,value:'b'.repeat(64)};f.page.setData({canCopy:true,activeInvite:f.active});}
  f.api.request=async()=>{f.setSession(null);throw Object.assign(Error('会话失效'),{statusCode:401});};
  await(operation==='mutate'?f.page.mutate('/test',{}):f.page[operation]());
  assert.equal(f.failures.length,1);assert.equal(f.page.data.loading,false);
  assert.equal(f.page.data.busy,false);assert.equal(f.page.data.loadingMore,false);
});
for(const late of ['success','error','401'])test('同账号双刷新旧能力'+late+'不覆盖新结果',async()=>{
  const f=setup();let resolve,reject,calls=0;
  f.api.capabilities=()=>++calls===1?new Promise((r,j)=>{resolve=r;reject=j}):Promise.resolve({wechat:true});
  const old=f.page.onShow();for(let i=0;i<10&&!resolve;i++)await Promise.resolve();
  await f.page.refresh();const before=structuredClone(f.page.data);
  if(late==='success')resolve({wechat:false});
  else reject(Object.assign(Error('旧能力错误'),late==='401'?{status:401}:{}));
  await old;assert.deepEqual(f.page.data,before);assert.equal(f.failures.length,0);
  assert.equal(f.page.data.authorized,true);assert.equal(f.page.data.enabled,true);
});
test('同账号新刷新未完成时旧401不能结束其骨架或跳转',async()=>{
  const f=setup();let firstReject,secondResolve,calls=0;
  f.api.ensureSession=()=>new Promise((resolve,reject)=>{if(++calls===1)firstReject=reject;else secondResolve=resolve;});
  const old=f.page.onShow(),fresh=f.page.refresh();f.setSession(null);
  firstReject(Object.assign(Error('旧401'),{status:401}));await old;
  assert.equal(f.failures.length,0);assert.equal(f.page.data.loading,true);assert.equal(f.page.data.error,'');
  f.setSession({token:'fictional-admin',user:{id:1,role:'admin'},team:{id:1}});
  secondResolve({user:{id:1,role:'admin'},team:{id:1}});await fresh;
  assert.equal(f.page.data.authorized,true);assert.equal(f.page.data.loading,false);
});
