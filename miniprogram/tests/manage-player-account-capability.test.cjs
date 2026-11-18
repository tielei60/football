// 球员账号创建能力回归：真实控制器与共享 admin.act；纯内存 fixture，不代替原生操作验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function harness({status = 'active', reply, error} = {}) {
  let token = 'fixture-owner', modal, def;
  const requests = [], titles = [], storage=new Map();
  const ui = {showModal(_page, options) { modal = options; }, showToast() {}, abort() {}};
  const shared = {api: {
    getSession: () => ({token,serverOrigin:'https://club.example',user:{id:1},team:{id:1}}),
    ensureSession: async () => ({user: {role: 'admin'}}),
    request: async (...args) => { requests.push(plain(args)); if (error) throw error; return typeof reply === 'function' ? reply() : reply; },
  }, safeSetData(page, data) {page.setData(data);}, fail() {}, unload() {}};
  const exported = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/manage-team/admin.js'), 'utf8'), {
    module: exported, require: name => name === '../../utils/ui' ? ui : shared,
    wx: {getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),stopPullDownRefresh() {}},
  });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/manage-player/index.js'), 'utf8'), {
    Page(value) {def = value;}, require: name => name === '../manage-team/admin' ? exported.exports : name === '../../utils/ui' ? ui : {playerInitial: () => '匿'},
    wx: {setNavigationBarTitle(value) {titles.push(value.title);}},
  });
  const page = {...def, id: 'fixture-player', _epoch: 1, _adminView: 0, _ownerToken: token,
    data: {...plain(def.data), loading: false, authorized: true, status,
      revision: 4, membershipConfirmed: true, membershipIndex: status === 'active' ? 1 : 2,
      form: {name: '未保存草稿', number: '0', positions: ['中场'], preferredFoot: '双脚', note: '保留备注'}},
    setData(patch) {Object.assign(this.data, patch);},
  };
  return {page, requests, titles, changeOwner() {token = 'other-fixture-owner';},
    async respond(confirm) {assert.ok(modal); modal.success({confirm}); await new Promise(resolve => setImmediate(resolve));},
  };
}
function accountHarness(options) {
  const h = harness(options);
  Object.assign(h.page.data, {hasAccount: false, passwordEnabled: false,
    username: 'fixture-member', password: 'fixture-only-password', accountOpen: true});
  return h;
}
test('密码能力初值false的无账号球员创建成功后同页可展开重置', async () => {
  const h = accountHarness({reply: {passwordEnabled: true, role: 'player'}});
  const draft = plain(h.page.data.form);
  h.page.account(); await h.respond(true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0][0], '/players/fixture-player/account');
  assert.equal(h.requests[0][1], 'POST');
  assert.equal(h.page.data.hasAccount, true);
  assert.equal(h.page.data.passwordEnabled, true);
  assert.equal(h.page.data.accountOpen, false);
  assert.equal(h.page.data.password, ''); assert.equal(h.page.data.username, '');
  h.page.toggleAccount(); assert.equal(h.page.data.accountOpen, true);
  assert.deepEqual(plain(h.page.data.form), draft);
});
test('创建确认取消不写入且不把无账号误标为已开通', async () => {
  const h = accountHarness(); h.page.account(); await h.respond(false);
  assert.equal(h.requests.length, 0); assert.equal(h.page.data.hasAccount, false);
  assert.equal(h.page.data.passwordEnabled, false);
});
for (const status of [400, 409, 0]) test(`创建失败${status}不提升密码能力并清空秘密`, async () => {
  const h = accountHarness({error: Object.assign(new Error('fixture-failure'), {status})});
  h.page.account(); await h.respond(true);
  assert.equal(h.requests.length, 1); assert.equal(h.page.data.hasAccount, false);
  assert.equal(h.page.data.passwordEnabled, false); assert.equal(h.page.data.password, '');
  assert.equal(h.page.data.conflict, status === 409); assert.equal(h.page.data.uncertain, status === 0);
});
test('创建确认前身份变化不发送请求或提升能力', async () => {
  const h = accountHarness(); h.page.account(); h.changeOwner(); await h.respond(true);
  assert.equal(h.requests.length, 0); assert.equal(h.page.data.hasAccount, false);
  assert.equal(h.page.data.passwordEnabled, false);
});
test('创建期间切换身份不应用旧账号成功能力', async () => {
  let resolve; const pending = new Promise(r => {resolve = r;});
  const h = accountHarness({reply: () => pending}); h.page.account(); await h.respond(true);
  assert.equal(h.requests.length, 1); h.changeOwner(); resolve({passwordEnabled: true});
  await new Promise(r => setImmediate(r));
  assert.equal(h.page.data.hasAccount, false); assert.equal(h.page.data.passwordEnabled, false);
});
for (const value of [false, undefined]) test(`创建账号响应密码能力${String(value)}按约定兼容不强升显式false`, async () => {
  const h = accountHarness({reply: value === undefined ? {} : {passwordEnabled: value}});
  h.page.account(); await h.respond(true);
  assert.equal(h.page.data.passwordEnabled, value !== false);
});
test('已有密码账号重置204无响应体仍保留密码能力', async () => {
  const h = accountHarness({reply: undefined}); Object.assign(h.page.data, {hasAccount: true, passwordEnabled: true});
  h.page.account(); await h.respond(true);
  assert.equal(h.requests[0][1], 'PUT'); assert.equal(h.page.data.passwordEnabled, true);
});
test('微信-only已有账号不能通过重置隐式启用密码', () => {
  const h = accountHarness(); h.page.data.hasAccount = true;
  h.page.account(); assert.equal(h.requests.length, 0); assert.equal(h.page.data.passwordEnabled, false);
});
for (const existing of [false, true]) test(`保存${existing ? '已有' : '新'}球员只在首次成功时同步原生编辑标题`, async () => {
  const h = harness({reply: {id: 'fixture-new', revision: 1, hasAccount: false, passwordEnabled: false}});
  h.page.id = existing ? 'fixture-player' : undefined;
  await h.page.save();
  assert.deepEqual(h.titles, existing ? [] : ['编辑球员']);
});
test('新增保存失败不得提前更改标题', async () => {
  const h = harness({error: Object.assign(new Error('fixture-failure'), {status: 400})}); h.page.id = undefined;
  await h.page.save(); assert.deepEqual(h.titles, []);
});
