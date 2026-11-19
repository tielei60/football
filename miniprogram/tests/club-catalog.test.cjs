const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
function boot(options = {}, store = new Map()) {
  let definition, modal, session = { token: 'A', serverOrigin: 'https://example.test', user: { id: 1, role: 'admin' }, team: { id: 1 } };
  const calls = [], events = [], navigation = [];
  const rows = options.rows || [{ id: 1, revision: 2, name: '示例对手', introduction: '介绍', playerSummary: '9号前锋', status: 'active' }];
  const api = { getSession: () => session, ensureSession: async () => session, request: async (...args) => { calls.push(args); if (!args[1]) return rows; return options.request ? options.request(...args) : { ...args[2], id: 5, revision: 1 }; } };
  const s = { api, safeSetData: (p, v) => p.setData(v), fail: (p, e) => p.setData({ error: e.message }), assetUrl: v => v || '', unload() { this._disposed = true; } };
  const ui = { abort() {}, showModal(p, o) { modal = o; }, showToast() {} };
  const wx = { setNavigationBarTitle() {}, stopPullDownRefresh() {}, navigateBack() { navigation.push('back'); }, getStorageSync: k => store.get(k), setStorageSync: (k, v) => { if (options.storageFail) throw Error('storage'); store.set(k, v); }, removeStorageSync: k => store.delete(k) };
  const adminContext = { module: { exports: {} }, require: n => n.includes('/ui') ? ui : s, wx };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/manage-team/admin.js'), 'utf8'), adminContext);
  const a = adminContext.module.exports;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/club-catalog/index.js'), 'utf8'), { require: n => n.includes('/admin') ? a : ui, wx, Page: p => definition = p });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), getOpenerEventChannel: () => ({ emit: (...v) => events.push(v) }), setData(patch) { for (const [k, v] of Object.entries(patch)) { const bits = k.split('.'); if (bits.length === 2) this.data[bits[0]][bits[1]] = v; else this.data[k] = v; } } };
  return { page, calls, events, navigation, store, session: v => session = v, confirm: v => modal.success({ confirm: v }), init: async (type = 'opponent', mode) => { page.onLoad({ type, mode }); await tick(); } };
}
test('admin list search covers opponent member notes and archived records', async () => {
  const h = boot(); await h.init(); assert.equal(h.page.data.authorized, true);
  h.page.search({ detail: { value: '9号' } }); assert.equal(h.page.data.visible.length, 1);
  h.page.search({ detail: { value: '不存在' } }); assert.equal(h.page.data.visible.length, 0);
});
test('player direct navigation does not read or mutate catalog', async () => {
  const h = boot(); h.session({ token: 'P', user: { role: 'player' } }); await h.init();
  assert.equal(h.page.data.authorized, false); assert.equal(h.calls.length, 0); h.page.create(); await h.page.save(); assert.equal(h.calls.length, 0);
});
for (const type of ['competition', 'opponent', 'notice']) test(type + ' inline create emits saved object and returns once', async () => {
  const h = boot(); await h.init(type, 'create'); Object.assign(h.page.data.form, { name: '新赛事', title: '安全须知', content: '注意安全', playerSummary: '队员资料' });
  await h.page.save(); assert.equal(h.events.length, 1); assert.equal(h.events[0][0], 'saved'); assert.equal(h.events[0][1].id, 5); assert.equal(h.navigation.length, 1); assert.equal(h.store.size, 0);
  const body = h.calls.find(c => c[1] === 'POST')[2]; assert.equal(body.status, 'active'); assert.equal(type === 'notice' ? body.content : body.name, type === 'notice' ? '注意安全' : '新赛事');
});
test('empty required content sends no POST', async () => { const h = boot(); await h.init('notice', 'create'); h.page.data.form.title = '须知'; await h.page.save(); assert.equal(h.calls.filter(c => c[1]).length, 0); });
test('edit carries revision; archive is PUT inactive not DELETE', async () => {
  const h = boot(); await h.init(); h.page.edit({ currentTarget: { dataset: { id: 1 } } }); h.page.archive(); h.confirm(true); await tick();
  const c = h.calls.find(c => c[1] === 'PUT'); assert.equal(c[0], '/opponents/1'); assert.equal(c[2].revision, 2); assert.equal(c[2].status, 'inactive'); assert.ok(!h.calls.some(c => c[1] === 'DELETE'));
});
test('double click submits only once and hidden receipt waits for same-account show', async () => {
  let resolve; const h = boot({ request: () => new Promise(r => resolve = r) }); await h.init('opponent', 'create'); h.page.data.form.name = '对手';
  const work = h.page.save(); await tick(); await h.page.save(); h.page.onHide(); resolve({ id: 3, revision: 1, status: 'active' }); await work;
  assert.equal(h.events.length, 0); await h.page.onShow(); assert.equal(h.events.length, 1); assert.equal(h.calls.filter(c => c[1] === 'POST').length, 1);
});
test('late old-account save cannot emit or navigate into new login', async () => {
  let resolve; const h = boot({ request: () => new Promise(r => resolve = r) }); await h.init('opponent', 'create'); h.page.data.form.name = '对手'; const work = h.page.save(); await tick();
  h.session({ token: 'B', serverOrigin: 'https://example.test', user: { id: 2, role: 'admin' }, team: { id: 2 } }); resolve({ id: 4 }); await work;
  assert.equal(h.events.length, 0); assert.equal(h.navigation.length, 0);
});
test('ambiguous POST marker survives restart, blocks retry and clears only after list confirmation', async () => {
  const store = new Map(); const h = boot({ request: async () => { throw Error('network'); } }, store); await h.init('opponent', 'create'); h.page.data.form.name = '私密队伍'; await h.page.save(); assert.equal(store.size, 1); assert.ok(!JSON.stringify([...store]).includes('私密'));
  const next = boot({}, store); await next.init('opponent', 'create'); next.page.data.form.name = '重复'; await next.page.save(); assert.equal(next.calls.filter(c => c[1]).length, 0);
  next.page.list(); next.confirm(true); await tick(); next.page.recover(); next.confirm(true); assert.equal(store.size, 0); assert.equal(next.page.data.uncertain, false);
});
test('persistent guard storage failure does not dispatch POST', async () => { const h = boot({ storageFail: true }); await h.init('competition', 'create'); h.page.data.form.name = '赛事'; await h.page.save(); assert.equal(h.calls.filter(c => c[1]).length, 0); });
test('409 keeps form and blocks blind resubmission', async () => { const h = boot({ request: async () => { throw Object.assign(Error('changed'), { status: 409 }); } }); await h.init(); h.page.edit({ currentTarget: { dataset: { id: 1 } } }); h.page.data.form.name = '保留修改'; await h.page.save(); await h.page.save(); assert.equal(h.page.data.conflict, true); assert.equal(h.page.data.form.name, '保留修改'); assert.equal(h.calls.filter(c => c[1]).length, 1); });
test('unknown catalog type is rejected', async () => { const h = boot(); await h.init('../opponents'); assert.equal(h.calls.length, 0); assert.match(h.page.data.error, /无效/); });
test('inline flow keeps return contract after visiting list', async () => {
  const h = boot(); await h.init('opponent', 'create'); h.page.list(); h.confirm(true); await tick();
  h.page.create(); h.page.data.form.name = '返回新对手'; await h.page.save(); assert.equal(h.events.length, 1); assert.equal(h.navigation.length, 1);
});
test('long content is retained privately but list projection stays small', async () => {
  const h = boot({ rows: [{ id: 1, title: '完整须知', content: '注意事项'.repeat(2500), status: 'active', revision: 1 }] }); await h.init('notice');
  assert.equal(h.page.data.visible[0].summary.length, 160); assert.ok(JSON.stringify(h.page.data).length < 2000);
  h.page.edit({ currentTarget: { dataset: { id: 1 } } }); assert.equal(h.page.data.form.content.length, 10000);
});
test('page registration and all three admin entry routes are present', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.ok(app.pages.includes('pages/club-catalog/index'));
  const js = fs.readFileSync(path.join(root, 'pages/me/index.js'), 'utf8'), xml = fs.readFileSync(path.join(root, 'pages/me/index.wxml'), 'utf8');
  for (const key of ['competitions', 'opponents', 'notices']) { assert.ok(js.includes(key + ':')); assert.ok(xml.includes('data-page="' + key + '"')); }
});
