const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const png = 'iVBORw0KGgoAAA';
const jpg = '/9j/AAAA';
const asset = key => ({ currentTarget: { dataset: { asset: key } } });
function fixture(options = {}) {
  let definition, choose, readFile, modal;
  let session = { token: 'A', serverOrigin: 'https://club.example', user: { id: 1, role: 'admin' }, team: { id: 1 } };
  const calls = [], patches = [], storage = options.storage || new Map();
  const api = {
    getSession: () => session, ensureSession: async () => session,
    request: async (url, method, body) => {
      calls.push({ url, method, body: body && structuredClone(body) });
      if (method) { if (options.write) return options.write(url, method, body); if (options.fail) throw Error('unknown receipt'); return { id: 7, revision: 3 }; }
      return [{ id: 7, revision: 2, name: '赛季', startDate: '2026-01-01', endDate: '2026-12-31', icon: '/icon.png', image: '/image.jpg' }];
    },
  };
  const s = { api, safeSetData: (p, v) => p.setData(v), fail: (p, e) => p.setData({ error: e.message }), unload() { this._disposed = true; this._epoch++; } };
  const ui = { abort() {}, showToast() {}, showModal: (p, o) => { modal = o; } };
  const wx = { getStorageSync: k => storage.get(k), setStorageSync: (k, v) => storage.set(k, v), removeStorageSync: k => storage.delete(k), stopPullDownRefresh() {}, setNavigationBarTitle() {}, chooseMedia: o => { choose = o; }, getFileSystemManager: () => ({ readFile: o => { readFile = o; } }) };
  const adminContext = { module: { exports: {} }, require: name => name.includes('/ui') ? ui : s, wx };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/manage-team/admin.js'), 'utf8'), adminContext);
  const admin = adminContext.module.exports;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/manage-season/index.js'), 'utf8'), { Page: p => { definition = p; }, wx, require: name => name.includes('/admin') ? admin : name.includes('/media') ? { imageSource: v => v || '' } : ui });
  function make(id = options.id) {
    const page = { ...definition, id, data: structuredClone(definition.data), setData(patch) { patches.push(structuredClone(patch)); for (const [key, value] of Object.entries(patch)) { const bits = key.split('.'); if (bits.length === 2) this.data[bits[0]][bits[1]] = value; else this.data[key] = value; } } };
    return page;
  }
  return { page: make(), make, admin, calls, patches, storage, setSession: value => { session = value; }, choose: () => choose, readFile: () => readFile, confirm: () => modal.success({ confirm: true }), select(page, key, bytes = png) { page.chooseAsset(asset(key)); choose.success({ tempFiles: [{ tempFilePath: '/tmp/' + key, size: 10 }] }); readFile.success({ data: bytes }); } };
}

test('season icon and image are independent optional changes; untouched media is omitted and removal sends null', async () => {
  const h = fixture({ id: 7 }); await h.page.refresh();
  assert.equal(h.page.data.iconPreview, '/icon.png'); assert.equal(h.page.data.imagePreview, '/image.jpg');
  await h.page.save(); let body = h.calls.find(c => c.method === 'PUT').body;
  assert.equal('icon' in body, false); assert.equal('image' in body, false); assert.equal(body.revision, 2);
  h.page._imageData = 'unrelated-player-buffer'; h.select(h.page, 'icon'); h.select(h.page, 'image', jpg);
  assert.equal(h.page._imageData, 'unrelated-player-buffer'); assert.equal(h.page.data.iconPreview, '/tmp/icon'); assert.equal(h.page.data.imagePreview, '/tmp/image');
  await h.page.save(); body = h.calls.filter(c => c.method === 'PUT').at(-1).body;
  assert.equal(body.icon, 'data:image/png;base64,' + png); assert.equal(body.image, 'data:image/jpeg;base64,' + jpg);
  h.page.clearAsset(asset('icon')); await h.page.save(); body = h.calls.filter(c => c.method === 'PUT').at(-1).body;
  assert.equal(body.icon, null); assert.equal('image' in body, false);
});

test('season media respects authorization, busy/conflict/unknown states, selection size and stale callbacks', async () => {
  const h = fixture({ id: 7 }); await h.page.refresh();
  for (const key of ['busy', 'conflict', 'uncertain']) { h.page.data[key] = true; h.page.chooseAsset(asset('icon')); h.page.clearAsset(asset('icon')); assert.equal(h.choose(), undefined, key); h.page.data[key] = false; }
  h.page.data.authorized = false; h.page.chooseAsset(asset('icon')); h.page.clearAsset(asset('icon')); assert.equal(h.choose(), undefined); h.page.data.authorized = true;
  h.page.chooseAsset(asset('invalid')); assert.equal(h.choose(), undefined);
  h.page.chooseAsset(asset('icon')); h.choose().success({ tempFiles: [{ tempFilePath: '/tmp/too-big', size: 2097153 }] }); assert.match(h.page.data.actionError, /2 MB/); assert.equal(h.readFile(), undefined);
  h.page.chooseAsset(asset('icon')); h.choose().success({ tempFiles: [{ tempFilePath: '/tmp/icon', size: 10 }] }); const late = h.readFile();
  h.page.clearAsset(asset('icon')); late.success({ data: png }); assert.equal(h.page.data.iconPreview, ''); assert.equal(h.page._mediaChanges.icon, null);
});

test('shared picture helper without callback preserves existing team/player behavior', async () => {
  const h = fixture({ id: 7 }); await h.page.refresh(); h.admin.choosePicture(h.page, 'avatar');
  h.choose().success({ tempFiles: [{ tempFilePath: '/tmp/avatar', size: 10 }] }); h.readFile().success({ data: png });
  assert.equal(h.page._imageData, 'data:image/png;base64,' + png); assert.equal(h.page.data.avatar, '/tmp/avatar');
});

function fillSeason(page) { page.data.form = { name: '未公开赛季草稿', startDate: '2026-01-01', endDate: '2026-12-31' }; }
function assertNoPersistentDraft(h) {
  for (const value of h.storage.values()) assert.deepEqual(Object.keys(value).sort(), ['createdAt', 'taskId']);
  assert.doesNotMatch(JSON.stringify([...h.storage.values()]), /未公开赛季草稿|data:image|tmp\/icon|tmp\/image/);
  assert.doesNotMatch(JSON.stringify(h.patches), /data:image/);
}

test('uncertain season creation restores both images privately for same-session retry without persisting the draft', async () => {
  const options = { fail: true }, h = fixture(options); await h.page.refresh(); fillSeason(h.page);
  h.select(h.page, 'icon'); h.select(h.page, 'image', jpg); await h.page.save();
  assert.equal(h.page.data.uncertain, true); assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  h.page.onUnload();
  const reopened = h.make(); await reopened.refresh();
  assert.equal(reopened.data.form.name, '未公开赛季草稿');
  assert.equal(reopened.data.iconPreview, '/tmp/icon'); assert.equal(reopened.data.imagePreview, '/tmp/image');
  assert.equal(reopened._mediaChanges.icon, 'data:image/png;base64,' + png);
  assert.equal(reopened._mediaChanges.image, 'data:image/jpeg;base64,' + jpg);
  assert.equal(reopened.data.uncertain, true);
  await reopened.save(); assert.equal(h.calls.filter(c => c.method === 'POST').length, 1, 'unknown receipt must not auto-retry');
  assertNoPersistentDraft(h);
  reopened.confirmNotCreated(); h.confirm(); options.fail = false; await reopened.save();
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 2);
  assert.deepEqual(h.calls.filter(c => c.method === 'POST').at(-1).body, h.calls.find(c => c.method === 'POST').body);
  assert.equal(reopened.id, 7); assert.equal(Object.keys(reopened._mediaChanges).length, 0); assert.equal(h.storage.size, 0);
});

test('season recovery does not expose private images or form to a new login or a restarted runtime', async () => {
  const h = fixture({ fail: true }); await h.page.refresh(); fillSeason(h.page);
  h.select(h.page, 'icon'); h.select(h.page, 'image', jpg); await h.page.save(); assertNoPersistentDraft(h);
  h.setSession({ token: 'B', serverOrigin: 'https://club.example', user: { id: 1, role: 'admin' }, team: { id: 1 } });
  const switched = h.make(); await switched.refresh();
  assert.equal(switched.data.uncertain, true); assert.equal(switched.data.form.name, '');
  assert.equal(switched.data.iconPreview, ''); assert.equal(switched.data.imagePreview, ''); assert.equal(Object.keys(switched._mediaChanges).length, 0);
  const restarted = fixture({ storage: h.storage }); await restarted.page.refresh();
  assert.equal(restarted.page.data.uncertain, true); assert.equal(restarted.page.data.form.name, '');
  assert.equal(restarted.page.data.iconPreview, ''); assert.equal(restarted.page.data.imagePreview, ''); assert.equal(Object.keys(restarted.page._mediaChanges).length, 0);
  assertNoPersistentDraft(restarted);
});

test('late confirmed season create restores identity and previews but never resubmits the accepted images', async () => {
  let accept; const h = fixture({ write: () => new Promise(resolve => { accept = resolve; }) });
  await h.page.refresh(); fillSeason(h.page); h.select(h.page, 'icon'); h.select(h.page, 'image', jpg);
  const saving = h.page.save(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof accept, 'function'); h.page.onUnload(); accept({ id: 7, revision: 3 }); await saving;
  const reopened = h.make(); await reopened.refresh();
  assert.equal(reopened.id, 7); assert.equal(reopened.data.id, 7); assert.equal(reopened.data.revision, 3);
  assert.equal(reopened.data.uncertain, false); assert.equal(reopened.data.iconPreview, '/tmp/icon'); assert.equal(reopened.data.imagePreview, '/tmp/image');
  assert.equal(Object.keys(reopened._mediaChanges).length, 0); assert.equal(h.storage.size, 0); assertNoPersistentDraft(h);
});
