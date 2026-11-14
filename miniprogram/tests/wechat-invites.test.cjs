const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../pages/wechat-invites/index.js'), 'utf8');
function setup(options = {}) {
  let session = { token: 'fictional-admin', user: { id: 1, role: 'admin' }, team: {id:1} }, definition;
  const requests = [], modals = [], clipboard = [];
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
    require: name => name === '../shared' ? { api } : ui,
    Page: value => { definition = value; },
    wx: { setClipboardData(config) { clipboard.push(config.data); config.success(); } },
    console, Date, Math, Map, Number, String, encodeURIComponent
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(value) { Object.assign(this.data, structuredClone(value)); } };
  page.onLoad({ id: 'p1' });
  return { page, requests, modals, clipboard, api, active, setList(value) { list = value; }, setSession(value) { session = value; } };
}
const action = value => ({ currentTarget: { dataset: { action: value } } });
test('未启用与非管理员禁止邀请请求', async () => {
  const f = setup({ api: { capabilities: async () => ({ wechat: false }) } });
  await f.page.onShow(); assert.equal(f.page.data.enabled, false); assert.equal(f.requests.length, 0);
  f.page.create(); assert.equal(f.modals.length, 0);
  const player = setup(); player.setSession({ token: 'player', user: { role: 'player' } });
  await player.page.onShow(); assert.match(player.page.data.error, /管理员/); assert.equal(player.requests.length, 0);
});
test('创建仅确认后执行，秘密不进入page.data或自动剪贴板', async () => {
  const f = setup(); await f.page.onShow(); f.page.create();
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
  await f.modals[0].success({ confirm: false }); assert.equal(f.page._credential, null);
  f.page.create(); await f.modals[1].success({ confirm: true });
  assert.equal(f.page.data.canCopy, true); assert.equal(JSON.stringify(f.page.data).includes('b'.repeat(64)), false); assert.equal(f.clipboard.length, 0);
  f.page.copy(); await f.modals[2].success({ confirm: true }); assert.deepEqual(f.clipboard, ['b'.repeat(64)]);
  f.page.onHide(); assert.equal(f.page._credential, null); assert.equal(f.page.data.canCopy, false);
});
test('隐藏后旧复制确认和旧写操作不会执行', async () => {
  const f = setup(); await f.page.onShow(); f.page.create(); await f.modals[0].success({ confirm: true });
  f.page.copy(); f.page.onHide(); await f.modals[1].success({ confirm: true }); assert.equal(f.clipboard.length, 0);
  await f.page.onShow(); assert.equal(f.page.data.canCopy, false);
});
test('批准必须人工输入编号，不预填服务端核对码', async () => {
  const f = setup(); f.setList({ items: [], activeInvite: { ...f.active, status: 'claimed', confirmationCode: 'ABCDEF12' }, nextCursor: null });
  await f.page.onShow(); assert.equal(JSON.stringify(f.page.data).includes('ABCDEF12'), false);
  f.page.decide(action('approve')); const modal = f.modals[0]; assert.equal(modal.defaultValue, undefined);
  await modal.success({ confirm: true, content: '' }); assert.match(f.page.data.actionError, /8 位/); assert.equal(f.requests.some(r => r.method === 'POST'), false);
  f.page.decide(action('approve')); await f.modals[1].success({ confirm: true, content: 'abcdef12' });
  const write = f.requests.find(r => r.method === 'POST'); assert.equal(write.body.confirmationCode, 'ABCDEF12'); assert.equal(write.body.revision, 1);
});
test('换身份后旧批准/解绑对话框不得发送请求', async () => {
  const f = setup(); f.setList({ items: [], activeInvite: { ...f.active, status: 'claimed' }, nextCursor: null });
  await f.page.onShow(); f.page.decide(action('approve')); f.setSession({ token: 'new-admin', user: { role: 'admin' } });
  await f.modals[0].success({ confirm: true, content: 'ABCDEF12' }); assert.equal(f.requests.some(r => r.method === 'POST'), false);
});
test('未知创建结果锁定操作，重新载入后重放原请求ID而非新建', async () => {
  const f = setup(); await f.page.onShow(); const original = f.api.request;
  let attempt = 0; f.api.request = async (url, method, body) => {
    if (method === 'POST') { f.requests.push({url, method, body}); if (++attempt === 1) throw Error('网络中断'); return { ...f.active, credentialUnavailable: true }; }
    return original(url, method, body);
  };
  f.page.create(); await f.modals[0].success({ confirm: true }); assert.equal(f.page.data.needsRefresh, true);
  const id = f.page._createId; f.page.create(); assert.equal(f.modals.length, 1);
  await f.page.refresh(); f.page.create(); await f.modals[1].success({ confirm: true });
  assert.equal(f.requests.filter(r => r.method === 'POST')[1].body.requestId, id); assert.equal(f.page.data.canCopy, false);
});
test('分页去重且activeInvite独立显示，加载中不允许写', async () => {
  const f = setup(); f.setList({ items: [f.active], activeInvite: f.active, nextCursor: 'cursor' }); await f.page.onShow();
  let release; f.api.request = () => new Promise(resolve => { release = resolve; });
  const promise = f.page.more(); assert.equal(f.page.data.loadingMore, true); f.page.create(); assert.equal(f.modals.length, 0);
  release({ items: [f.active, {...f.active, id:'c'.repeat(32), status:'revoked'}], activeInvite: {...f.active, status:'claimed'}, nextCursor: null });
  await promise; assert.equal(f.page.data.items.length, 2); assert.equal(f.page.data.activeInvite.status, 'claimed'); assert.equal(f.page.data.hasMore, false);
});
test('载入迟到后不恢复隐藏页的球员数据', async () => {
  let release; const f = setup({ api: { ensureSession: () => new Promise(resolve => { release = resolve; }) } });
  const promise = f.page.onShow(); f.page.onHide(); release({ user:{id:1,role:'admin'}, team:{id:1} }); await promise;
  assert.equal(f.page.data.playerName, ''); assert.equal(f.page.data.authorized, false); assert.equal(f.requests.length, 0);
});
test('解绑明确风险且只发送当前revision，取消不写', async () => {
  const f = setup(); await f.page.onShow(); f.page.setData({ binding: {bound:true,revision:7,passwordEnabled:false} });
  f.page.unbind(); assert.match(f.modals[0].content, /重新邀请/); await f.modals[0].success({confirm:false});
  assert.equal(f.requests.some(r => r.method === 'POST'), false);
  f.page.unbind(); await f.modals[1].success({confirm:true}); const write=f.requests.find(r=>r.method==='POST'); assert.equal(write.url,'/players/p1/wechat-binding/revoke'); assert.equal(JSON.stringify(write.body),JSON.stringify({revision:7}));
});
test('归档球员只读绑定，不读取邀请或创建', async () => {
  const f = setup({request: async url => url === '/players' ? [{id:'p1',name:'模拟球员',status:'inactive'}] : {bound:false,revision:1}});
  await f.page.onShow(); assert.equal(f.page.data.archived,true); f.page.create(); assert.equal(f.modals.length,0); assert.equal(f.requests.some(r=>r.url.endsWith('invites')),false);
});
test('迟到创建响应不写入已隐藏页面或保留凭据', async () => {
  const f=setup(); await f.page.onShow(); let release; f.api.request=()=>new Promise(resolve=>{release=resolve;});
  f.page.create(); const pending=f.modals[0].success({confirm:true}); f.page.onHide(); release({...f.active,credential:'d'.repeat(64)}); await pending;
  assert.equal(f.page._credential,null); assert.equal(f.page.data.canCopy,false); assert.equal(f.page.data.authorized,false);
});
test('版本冲突要求刷新核对，不能再次直接操作', async () => {
  const f=setup(); f.setList({items:[],activeInvite:{...f.active,status:'claimed'},nextCursor:null}); await f.page.onShow();
  f.api.request=async()=>{throw Object.assign(Error('邀请已变化'),{status:409});}; f.page.decide(action('reject')); await f.modals[0].success({confirm:true});
  assert.equal(f.page.data.needsRefresh,true); f.page.decide(action('reject')); assert.equal(f.modals.length,1); assert.match(f.page.data.actionError,/重新载入/);
});
test('共享弹层阻断时不得排队创建或复制', async () => {
  const f=setup(); await f.page.onShow(); f.page.setData({businessUiBlocking:true}); f.page.create(); assert.equal(f.modals.length,0);
});
for (const resolved of ['revoke', 'reject', 'unbind']) test('未知创建经' + resolved + '明确成功后再次创建使用新请求编号', async () => {
  const f = setup(); await f.page.onShow();
  let stage = 'initial', oldId, newId;
  const original = f.api.request;
  f.api.request = async (url, method, body) => {
    if (method === 'POST' && url.endsWith('/wechat-invites')) {
      if (stage === 'initial') { oldId = body.requestId; stage = resolved === 'unbind' ? 'bound' : 'pending'; throw Error('响应丢失'); }
      newId = body.requestId; stage = 'new'; return {...f.active,credential:'e'.repeat(64)};
    }
    if (method === 'POST' && (url.endsWith('/revoke') || url.endsWith('/reject'))) { stage='resolved'; return {status:'revoked',revision:2}; }
    if (url.endsWith('/wechat-binding')) return {bound:stage==='bound',revision:2,passwordEnabled:false};
    if (url.endsWith('/wechat-invites')) return {items:[],activeInvite:stage==='pending'?{...f.active,status:resolved==='reject'?'claimed':'pending'}:null,nextCursor:null};
    return original(url,method,body);
  };
  f.page.create(); await f.modals[0].success({confirm:true}); assert.equal(f.page._createId,oldId);
  await f.page.refresh();
  if (resolved==='unbind') f.page.unbind(); else f.page.decide(action(resolved));
  await f.modals[1].success({confirm:true}); assert.equal(f.page._createId,null);
  f.page.create(); await f.modals[2].success({confirm:true}); assert.ok(newId); assert.notEqual(newId,oldId);
});
test('终态旧请求重放明确提示未新建，不自动创建第二次', async () => {
  const f=setup(); await f.page.onShow(); let posts=0;
  const original=f.api.request; f.api.request=async(url,method,body)=>{
    if(method==='POST'){posts++;return {...f.active,status:'expired',credentialUnavailable:true};}
    return original(url,method,body);
  };
  f.page._createId='previous-request'; f.page.create(); await f.modals[0].success({confirm:true});
  assert.equal(posts,1); assert.match(f.page.data.actionError,/本次未新建/); assert.match(f.page.data.actionError,/再次主动创建/); assert.equal(f.page._createId,null); assert.equal(f.page.data.canCopy,false);
});
test('撤销失败不能清除未知创建请求编号', async()=>{
  const f=setup(); f.setList({items:[],activeInvite:f.active,nextCursor:null});await f.page.onShow();f.page._createId='uncertain-request';
  f.api.request=async()=>{throw Error('撤销结果未知');};f.page.decide(action('revoke'));await f.modals[0].success({confirm:true});assert.equal(f.page._createId,'uncertain-request');assert.equal(f.page.data.needsRefresh,true);
});
