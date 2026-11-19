// Real match-edit and shared loading controller; all identities, storage and requests are anonymous in-memory fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const identity = (token = 'A', role = 'admin') => ({ token, serverOrigin: 'https://club.example', expiresAt: 2000000000000, user: { id: token === 'A' ? 1 : 2, role, teamId: 1 }, team: { id: 1 } });
const event = (kind, index) => ({ currentTarget: { dataset: { kind } }, detail: { value: String(index) } });
function fixture(options = {}) {
  let definition, session = identity();
  const requests = [], navigations = [], patches = [], store = new Map();
  const lists = {
    '/seasons': [{ id: 2, name: '本赛季', icon: 'private-icon', image: 'private-image' }],
    '/venues': [],
    '/opponents?summary=1': [{ id: 11, name: '示例对手', introduction: 'private-introduction', playerSummary: 'private-player-summary', status: 'active' }],
    '/competitions?summary=1': [{ id: 21, name: '示例赛事', status: 'active' }],
    '/notice-templates': [{ id: 31, title: '模板一', content: '提前十分钟集合\n穿紫色球衣', status: 'active' }, { id: 32, title: '模板二', content: '带水和护腿板', status: 'active' }],
    ...options.lists,
  };
  const api = {
    getSession: () => session,
    ensureSession: async () => session,
    request: async (url, method, body) => {
      requests.push({ url, method, body: body && structuredClone(body) });
      if (options.request) { const result = options.request(url, method, body); if (result !== undefined) return result; }
      if (method) return { id: Number(options.id || 70), revision: 4 };
      if (url.startsWith('/matches/')) return { id: 70, revision: 3, opponent: '原对手', competition: '原赛事', notice: '', date: '2026-11-21', kickoff: '', location: '', maxParticipants: null, homeScore: null, awayScore: null, analysis: '', status: 'draft', ...options.match };
      return structuredClone(lists[url] || []);
    },
  };
  const wx = {
    getStorageSync: key => store.get(key), setStorageSync: (key, value) => store.set(key, value), removeStorageSync: key => store.delete(key),
    stopPullDownRefresh() {}, navigateTo: value => navigations.push(value), redirectTo: value => navigations.push(value),
  };
  const sharedContext = { module: { exports: {} }, wx, require: name => name.endsWith('/api') ? api : name.endsWith('/media') ? { imageSource: value => value } : { playerInitial: () => '' } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/shared.js'), 'utf8'), sharedContext);
  const shared = sharedContext.module.exports;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/match-edit/index.js'), 'utf8'), {
    wx, require: name => name === '../shared' ? shared : { abort() {}, showToast() {} }, Page: value => { definition = value; },
  });
  const page = { ...definition, data: structuredClone(definition.data), id: options.id, _view: 0, setData(patch) {
    patches.push(structuredClone(patch));
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.'); let target = this.data;
      for (const part of parts.slice(0, -1)) target = target[part] ||= {};
      target[parts.at(-1)] = value;
    }
  } };
  return { page, api, lists, requests, navigations, patches, store, session: value => { session = value; }, load: () => page.refresh() };
}
function input(page, field, value) { page.input({ currentTarget: { dataset: { field } }, detail: { value } }); }
function required(page) { input(page, 'opponent', '手动对手'); input(page, 'date', '2026-11-21'); }

test('catalog lists carry only labels/IDs to setData; selected notice is copied, locally editable and saved with its reference', async () => {
  const h = fixture(); await h.load();
  assert.equal(h.page.data.loading, false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.page.data.seasons)), [{ id: null, name: '未分配赛季' }, { id: 2, name: '本赛季' }]);
  const before = JSON.stringify(h.patches);
  for (const secret of ['private-icon', 'private-image', 'private-introduction', 'private-player-summary', '提前十分钟集合']) assert.ok(!before.includes(secret), secret);
  h.page.pickCatalog(event('opponents', 1)); h.page.pickCatalog(event('competitions', 1)); h.page.pickCatalog(event('notices', 1));
  assert.equal(h.page.data.form.opponent, '示例对手'); assert.equal(h.page.data.form.competition, '示例赛事');
  assert.equal(h.page.data.form.notice, '提前十分钟集合\n穿紫色球衣');
  input(h.page, 'notice', ' 本场改为提前二十分钟\n保留原始空格 ');
  h.page.pickCatalog(event('notices', 1));
  assert.equal(h.page.data.form.notice, ' 本场改为提前二十分钟\n保留原始空格 ');
  assert.equal(h.lists['/notice-templates'][0].content, '提前十分钟集合\n穿紫色球衣');
  input(h.page, 'date', '2026-11-21'); await h.page.save();
  const write = h.requests.find(item => item.method === 'POST');
  assert.equal(write.url, '/matches'); assert.equal(write.body.opponentId, 11); assert.equal(write.body.competitionId, 21); assert.equal(write.body.noticeTemplateId, 31);
  assert.equal(write.body.notice, ' 本场改为提前二十分钟\n保留原始空格 ');
  assert.ok(!h.requests.some(item => item.method && item.url !== '/matches'));
});

test('manual options retain current text and save null references; switching templates deliberately replaces only match text', async () => {
  const h = fixture(); await h.load(); required(h.page);
  h.page.pickCatalog(event('notices', 1)); input(h.page, 'notice', '本场覆盖');
  h.page.pickCatalog(event('notices', 2)); assert.equal(h.page.data.form.notice, '带水和护腿板');
  h.page.pickCatalog(event('notices', 0)); assert.equal(h.page.data.form.notice, '带水和护腿板');
  input(h.page, 'notice', '手动须知'); input(h.page, 'competition', '手动赛事');
  await h.page.save(); const body = h.requests.find(item => item.method === 'POST').body;
  for (const key of ['opponentId', 'competitionId', 'noticeTemplateId']) assert.equal(body[key], null);
  assert.equal(body.notice, '手动须知'); assert.equal(body.competition, '手动赛事');
});

test('editing retains match snapshots despite renamed/inactive catalogs and does not reapply a selected template', async () => {
  const h = fixture({ id: 70, match: { opponentId: 11, opponent: '历史对手', competitionId: 999, competition: '历史赛事', noticeTemplateId: 31, notice: '本场独立须知' }, lists: { '/opponents?summary=1': [{ id: 11, name: '已改名', status: 'inactive' }, { id: 12, name: '不可新选', status: 'inactive' }], '/notice-templates': [{ id: 31, title: '已改模板', content: '新模板正文', status: 'inactive' }] } });
  await h.load();
  assert.equal(h.page.data.form.notice, '本场独立须知'); assert.equal(h.page.data.form.opponent, '历史对手');
  assert.equal(h.page.data.catalogs.opponents.length, 2); assert.equal(h.page.data.catalogs.opponents[1].name, '历史对手（本场留存）');
  assert.equal(h.page.data.catalogs.competitions[2].id, 999);
  h.page.pickCatalog(event('notices', 1)); h.page.pickCatalog(event('opponents', 1));
  assert.equal(h.page.data.form.notice, '本场独立须知'); assert.equal(h.page.data.form.opponent, '历史对手');
  await h.page.save(); const write = h.requests.find(item => item.method === 'PUT');
  assert.equal(write.url, '/matches/70'); assert.equal(write.body.revision, 3); assert.equal(write.body.opponentId, 11); assert.equal(write.body.competitionId, 999); assert.equal(write.body.noticeTemplateId, 31); assert.equal(write.body.notice, '本场独立须知');
});

for (const [kind, type, field] of [['opponents', 'opponent', 'opponent'], ['competitions', 'competition', 'competition'], ['notices', 'notice', 'notice']]) {
  test(kind + ' inline create returns one selected record without wiping other draft fields', async () => {
    const h = fixture(); await h.load(); required(h.page); input(h.page, 'location', '手填地点');
    h.page.createCatalog(event(kind, 0)); const nav = h.navigations[0]; assert.equal(nav.url, '/pages/club-catalog/index?type=' + type + '&mode=create');
    h.page.onHide(); nav.events.saved({ id: 88, name: '新资料', title: '新模板', content: '只复制本场', status: 'active' }); await h.page.onShow();
    assert.equal(h.page.data.form[field], kind === 'notices' ? '只复制本场' : '新资料'); assert.equal(h.page.data.form.location, '手填地点');
    assert.equal(h.page.data.catalogs[kind][h.page.data.catalogIndices[kind]].id, 88);
    assert.ok(!('content' in h.page.data.catalogs[kind].at(-1)));
    nav.events.saved({ id: 88, name: '新资料', title: '新模板', content: '只复制本场', status: 'active' });
    assert.equal(h.page.data.catalogs[kind].filter(item => item.id === 88).length, 1);
  });
}

for (const mode of ['new-session', 'unloaded', 'inactive', 'invalid-id']) {
  test('inline create ignores ' + mode + ' return', async () => {
    const h = fixture(); await h.load(); h.page.createCatalog(event('notices', 0));
    const baseline = JSON.stringify(h.page.data), callback = h.navigations[0].events.saved;
    if (mode === 'new-session') h.session(identity('B'));
    if (mode === 'unloaded') h.page.onUnload();
    callback({ id: mode === 'invalid-id' ? '88' : 88, title: '不得写入', content: '不得写入', status: mode === 'inactive' ? 'inactive' : 'active' });
    assert.equal(JSON.stringify(h.page.data), baseline);
  });
}

test('player direct navigation cannot load catalog or open create page', async () => {
  const h = fixture(); h.session(identity('P', 'player')); await h.load();
  assert.match(h.page.data.error, /仅管理员/); assert.equal(h.requests.length, 0);
  h.page.createCatalog(event('opponents', 0)); assert.equal(h.navigations.length, 0);
});

test('session return resets prior match draft and private template cache before loading new identity', async () => {
  const h = fixture(); await h.load(); h.page.pickCatalog(event('notices', 1)); input(h.page, 'opponent', 'A私密草稿');
  h.page.onHide(); h.session(identity('B')); h.lists['/notice-templates'] = [{ id: 50, title: 'B模板', content: 'B正文', status: 'active' }];
  await h.page.onShow();
  assert.equal(h.page.data.form.opponent, ''); assert.equal(h.page.data.form.notice, ''); assert.equal(h.page._noticeContents.has(31), false);
  h.page.pickCatalog(event('notices', 1)); assert.equal(h.page.data.form.notice, 'B正文');
});

test('late old-epoch or old-session catalog load cannot replace private template cache', async () => {
  for (const mode of ['new-epoch', 'new-session']) {
    let release, delayed = false;
    const h = fixture({ request: (url, method) => !method && delayed && url === '/notice-templates' ? new Promise(resolve => { release = resolve; }) : undefined });
    await h.load(); const original = h.page._noticeContents; delayed = true; const loading = h.load(); await tick(); assert.equal(typeof release, 'function');
    if (mode === 'new-epoch') h.page.onHide(); else h.session(identity('B'));
    release([{ id: 99, title: '迟到模板', content: '迟到正文', status: 'active' }]); await loading;
    assert.equal(h.page._noticeContents, original, mode);
  }
});

test('input, radio status and create navigation reject invalid fields, values and busy states', async () => {
  const h = fixture(); await h.load();
  input(h.page, 'unexpected', 'x'); assert.equal(h.page.data.form.unexpected, undefined);
  h.page.changeStatus({ detail: { value: 'published' } }); assert.equal(h.page.data.statusIndex, 1);
  h.page.changeStatus({ detail: { value: 'unknown' } }); assert.equal(h.page.data.statusIndex, 1);
  h.page.data.busy = true; input(h.page, 'notice', '不能修改'); h.page.changeStatus({ detail: { value: 'completed' } }); h.page.pickCatalog(event('notices', 1)); h.page.createCatalog(event('notices', 0));
  assert.equal(h.page.data.form.notice, ''); assert.equal(h.page.data.statusIndex, 1); assert.equal(h.navigations.length, 0);
  h.page.data.busy = false;
  for (const blocked of ['loading', 'error']) { h.page.data[blocked] = true; h.page.createCatalog(event('notices', 0)); h.page.data[blocked] = false; }
  h.page.createCatalog(event('../opponents', 0)); assert.equal(h.navigations.length, 0);
});
