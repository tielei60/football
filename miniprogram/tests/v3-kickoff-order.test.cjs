// Real page handlers, with isolated in-memory API data. No production requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ids = rows => Array.from(rows, row => row.id);
const match = (id, date, kickoff, status = 'published') => ({ id, date, kickoff, status, opponent: '隔离测试对手', rsvps: [], homeScore: null, awayScore: 0 });
function definition(page, shared, wx = {}) {
  let result;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages', page, 'index.js'), 'utf8'), {
    Page: value => { result = value; }, wx,
    require: name => name === '../shared' ? shared : name.includes('match-result-view') ? require('../utils/match-result-view') : { abort() {} },
  });
  return { ...result, data: structuredClone(result.data), setData(patch) { Object.assign(this.data, patch); } };
}
for (const [tab, status] of [['upcoming', 'published'], ['past', 'completed'], ['draft', 'draft']]) {
  test(`${tab}: 日期和开球时间倒序、同时间稳定、未知时间末尾、源数组不变`, () => {
    const rows = [match(91, '2027-01-01', null, status), match(21, '2026-12-31', '23:00', status), match(5, '2027-01-01', '20:00', status), match(3, '2027-01-01', '20:00', status), match(99, '2027-01-01', '08:00', status), match(92, '2027-01-01', undefined, status), match(93, '2027-01-01', '', status)];
    const before = structuredClone(rows);
    const page = definition('schedule', {});
    const result = page.filter(rows, tab);
    assert.deepEqual(ids(result), [5, 3, 99, 91, 92, 93, 21]);
    assert.deepEqual(Array.from(result, r => r.monthHeading), ['2027年01月', '', '', '', '', '', '2026年12月']);
    assert.deepEqual(rows, before);
    assert.deepEqual(ids(page.filter(result, tab)), ids(result), 'refresh preserves tied order');
  });
}
test('各标签仍按状态隔离，取消赛事只进入历史，不伪装完赛', () => {
  const page = definition('schedule', {});
  const rows = ['draft', 'published', 'cancelled', 'completed'].map((status, id) => match(id, '2027-01-01', '20:00', status));
  assert.deepEqual(ids(page.filter(rows, 'upcoming')), [1]);
  assert.deepEqual(ids(page.filter(rows, 'past')), [2, 3]);
  assert.deepEqual(ids(page.filter(rows, 'draft')), [0]);
  assert.equal(page.filter(rows, 'past')[0].status, 'cancelled');
});
test('首页焦点取最晚已发布赛事，近期赛果同口径倒序，未知比分不变', async () => {
  const rows = [match(2, '2099-12-30', '23:00'), match(3, '2099-12-31', ''), match(7, '2099-12-31', '20:00'), match(6, '2099-12-31', '20:00'), match(8, '2099-12-31', '23:00', 'draft'), match(9, '2099-12-31', '23:00', 'cancelled'), match(20, '2000-01-01', '23:00'), match(30, '2026-01-01', '20:00', 'completed'), match(31, '2026-01-01', '22:00', 'completed')];
  const before = structuredClone(rows), requests = [];
  const session = { user: { role: 'player', playerId: 'fixture-player' }, team: { name: '隔离测试球队' } };
  const api = { ensureSession: async () => session, request: async url => { requests.push(url); return url === '/matches' ? rows : url === '/players' ? [] : { team: { matches: 2, wins: 0 } }; } };
  const module = { exports: {} }, wx = { stopPullDownRefresh() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/shared.js'), 'utf8'), { module, wx, require: name => name.includes('player-initial') ? { playerInitial: () => '球' } : name.includes('media') ? { imageSource: x => x } : api });
  const page = definition('home', module.exports, wx);
  await page.refresh();
  assert.equal(page.data.error, '');
  assert.equal(page.data.next.id, 7);
  assert.deepEqual(ids(page.data.moreUpcoming), [6, 3]);
  assert.ok(page.data.moreUpcoming.every(m => m.id !== page.data.next.id));
  assert.equal(page.data.next.scoreLabel, '— : 0');
  assert.deepEqual(ids(page.data.recent), [31, 30]);
  assert.deepEqual(rows, before);
  assert.equal(requests.filter(url => url === '/matches').length, 1);
});
test('原生固定底栏保持五个唯一页面和真实资源，页面滚动不创建第二底栏', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.equal(app.tabBar.custom, false);
  assert.equal(app.tabBar.position, 'bottom');
  assert.deepEqual(app.tabBar.list.map(x => x.pagePath), ['home', 'schedule', 'players', 'statistics', 'me'].map(x => `pages/${x}/index`));
  for (const tab of app.tabBar.list) {
    assert.ok(app.pages.includes(tab.pagePath));
    for (const icon of [tab.iconPath, tab.selectedIconPath]) assert.ok(fs.existsSync(path.join(root, icon)));
    const wxml = fs.readFileSync(path.join(root, tab.pagePath + '.wxml'), 'utf8');
    assert.doesNotMatch(wxml, /<custom-tab-bar\b|class="[^"]*fixed-actions/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, tab.pagePath + '.js'), 'utf8'), /hideTabBar\s*\(/);
  }
});
