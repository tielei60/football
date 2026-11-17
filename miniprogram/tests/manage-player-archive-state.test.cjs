// 真实控制器与共享 admin.act 的状态回归；纯内存 fixture，不代替原生操作验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
function harness({status = 'active', reply, error} = {}) {
  let token = 'fixture-owner', modal, def;
  const requests = [];
  const ui = {showModal(_page, options) { modal = options; }, showToast() {}, abort() {}};
  const shared = {api: {
    getSession: () => ({token}),
    ensureSession: async () => ({user: {role: 'admin'}}),
    request: async (...args) => { requests.push(plain(args)); if (error) throw error; return typeof reply === 'function' ? reply() : reply; },
  }, safeSetData(page, data) {page.setData(data);}, fail() {}, unload() {}};
  const exported = {exports: {}};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/manage-team/admin.js'), 'utf8'), {
    module: exported, require: name => name === '../../utils/ui' ? ui : shared,
    wx: {stopPullDownRefresh() {}},
  });
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/manage-player/index.js'), 'utf8'), {
    Page(value) {def = value;}, require: name => name === '../manage-team/admin' ? exported.exports : name === '../../utils/ui' ? ui : {playerInitial: () => '匿'},
    wx: {},
  });
  const page = {...def, id: 'fixture-player', _epoch: 1, _adminView: 0, _ownerToken: token,
    data: {...plain(def.data), loading: false, authorized: true, status,
      revision: 4, membershipConfirmed: true, membershipIndex: status === 'active' ? 1 : 2,
      form: {name: '未保存草稿', number: '0', positions: ['中场'], preferredFoot: '双脚', note: '保留备注'}},
    setData(patch) {Object.assign(this.data, patch);},
  };
  return {page, requests, changeOwner() {token = 'other-fixture-owner';},
    async respond(confirm) {assert.ok(modal); modal.success({confirm}); await new Promise(resolve => setImmediate(resolve));},
  };
}
for (const [from, to, index] of [['active', 'inactive', 2], ['inactive', 'active', 1]]) {
  test(`球员${from === 'active' ? '归档' : '恢复'}成功同步成员选择器与标签且不提交未保存草稿`, async () => {
    const h = harness({status: from, reply: {revision: 5, status: to, membershipConfirmed: true}});
    const draft = plain(h.page.data.form);
    h.page.archive(); await h.respond(true);
    assert.deepEqual(h.requests, [['/players/fixture-player', 'PUT', {revision: 4, status: to}]]);
    assert.equal(h.page.data.revision, 5); assert.equal(h.page.data.status, to);
    assert.equal(h.page.data.membershipConfirmed, true); assert.equal(h.page.data.membershipIndex, index);
    assert.deepEqual(plain(h.page.data.form), draft);
  });
}
test('归档确认取消不写入且保留展示和草稿', async () => {
  const h = harness(); const before = plain(h.page.data);
  h.page.archive(); await h.respond(false);
  assert.deepEqual(h.requests, []); assert.deepEqual(plain(h.page.data), before);
});
for (const status of [400, 409, 503]) test(`归档失败${status}不擅自更新成员展示或清草稿`, async () => {
  const h = harness({error: Object.assign(new Error('匿名失败'), {status})});
  const draft = plain(h.page.data.form);
  h.page.archive(); await h.respond(true);
  assert.equal(h.requests.length, 1); assert.equal(h.page.data.status, 'active');
  assert.equal(h.page.data.membershipIndex, 1); assert.equal(h.page.data.membershipConfirmed, true);
  assert.equal(h.page.data.revision, 4); assert.equal(h.page.data.conflict, status === 409);
  assert.deepEqual(plain(h.page.data.form), draft); assert.equal(h.page.data.busy, false);
});
test('确认前身份改变不发送归档请求', async () => {
  const h = harness(); h.page.archive(); h.changeOwner(); await h.respond(true);
  assert.deepEqual(h.requests, []); assert.equal(h.page.data.status, 'active'); assert.equal(h.page.data.membershipIndex, 1);
});
test('请求期间身份改变不把旧账号成功结果应用到页面', async () => {
  let resolve; const pending = new Promise(r => {resolve = r;});
  const h = harness({reply: () => pending}); h.page.archive(); await h.respond(true);
  assert.equal(h.requests.length, 1); h.changeOwner(); resolve({revision: 5, status: 'inactive', membershipConfirmed: true});
  await new Promise(r => setImmediate(r));
  assert.equal(h.page.data.revision, 4); assert.equal(h.page.data.status, 'active'); assert.equal(h.page.data.membershipIndex, 1);
});
for (const [confirmed, expected] of [[false, 0], [undefined, 2]]) test(`归档成功沿用载入三态映射：服务端成员确认${String(confirmed)}`, async () => {
  const result = {revision: 5, status: 'inactive'};
  if (confirmed !== undefined) result.membershipConfirmed = confirmed;
  const h = harness({reply: result});
  h.page.data.avatar = 'fixture-local-avatar'; h.page._imageData = 'fixture-unsaved-image';
  const draft = plain(h.page.data.form);
  h.page.archive(); await h.respond(true);
  assert.equal(h.page.data.membershipIndex, expected);
  assert.equal(h.page.data.membershipConfirmed, confirmed !== false);
  assert.equal(h.page.data.status, 'inactive');
  assert.deepEqual(plain(h.page.data.form), draft);
  assert.equal(h.page.data.avatar, 'fixture-local-avatar');
  assert.equal(h.page._imageData, 'fixture-unsaved-image');
});
