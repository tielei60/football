// Isolated API fixtures + official WXML virtual rendering, not device visual acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { wxmlToJs } = require('miniprogram-compiler');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'pages/home/index.js'), 'utf8');
const contracts = require('./home-upcoming-list-projection.json');
const render = new Function('window', wxmlToJs(root))({})('pages/home/index.wxml');
const ids = rows => Array.from(rows, x => x.id);
const match = (id, kickoff = '20:00', date = '2099-12-31', status = 'published') => ({ id, date, kickoff, status, opponent: '匿名对手' + id, rsvps: [], homeScore: null, awayScore: 0 });
function fixture(initial) {
  let rows = initial, pageDef, hold, identity = 'fixture-a';
  const routes = [];
  const api = { ensureSession: async () => ({ team: { id: 1, name: '匿名测试队' }, user: { role: 'player', playerId: identity } }), request: async url => url === '/matches' ? hold ? hold : structuredClone(rows) : url === '/players' ? [] : { team: { matches: 0, wins: 0 } } };
  const wx = { stopPullDownRefresh() {}, navigateTo: value => routes.push(value.url) };
  const shared = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/shared.js'), 'utf8'), { module: shared, wx, require: name => name.includes('player-initial') ? { playerInitial: () => '球' } : name.includes('media') ? { imageSource: x => x } : api });
  vm.runInNewContext(source, { Page: p => { pageDef = p; }, wx, require: name => name === '../shared' ? shared.exports : name.includes('match-result-view') ? require('../utils/match-result-view') : { abort() {} } });
  const page = { ...pageDef, data: structuredClone(pageDef.data), setData(patch) { Object.assign(this.data, patch); } };
  return { page, routes, replace: value => { rows = value; }, hold: value => { hold = value; }, identity: value => { identity = value; } };
}
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []; }
const withClass = (tree, name) => nodes(tree).filter(n => (n.attr?.class || '').split(' ').includes(name));
const text = tree => typeof tree === 'string' ? tree : (tree?.children || []).map(text).join('');
test('0至6场：焦点之外最多2条、降序不重复、每条维持真实ID和报名信息', async () => {
  for (let total = 0; total <= 6; total++) {
    const rows = Array.from({ length: total }, (_, i) => ({ ...match(i, `${String(10 + i).padStart(2, '0')}:00`), rsvps: [{ playerId: 'fixture-a', response: i % 2 ? 'yes' : 'maybe' }] }));
    const before = structuredClone(rows), f = fixture(rows);
    await f.page.refresh();
    const expected = [...rows].reverse().slice(1, 3).map(x => x.id);
    assert.deepEqual(ids(f.page.data.moreUpcoming), expected);
    assert.equal(f.page.data.next?.id ?? null, total ? total - 1 : null);
    assert.deepEqual(rows, before);
    const tree = render(f.page.data), entries = withClass(tree, 'home-upcoming-row');
    assert.equal(entries.length, expected.length);
    assert.equal(withClass(tree, 'home-upcoming-list').length, expected.length ? 1 : 0);
    assert.deepEqual(entries.map(x => Number(x.attr['data-id'])), expected);
    for (let i = 0; i < entries.length; i++) {
      assert.equal(entries[i].attr.bindtap, 'openMatch');
      assert.ok(text(entries[i]).includes(rows[expected[i]].opponent));
      assert.ok(text(entries[i]).includes(f.page.data.moreUpcoming[i].responseLabel));
      f.page.openMatch({ currentTarget: { dataset: { id: entries[i].attr['data-id'] } } });
    }
    assert.deepEqual(f.routes, expected.map(id => `/pages/match-detail/index?id=${id}`));
  }
});
test('同开球稳定、未知时间在后，草稿取消完赛及过往发布不混入报名列表', async () => {
  const f = fixture([match(4, null), match(8), match(7), match(9, '23:00', '2099-12-31', 'draft'), match(10, '23:00', '2099-12-31', 'cancelled'), match(11, '23:00', '2000-01-01'), match(12, '23:00', '2000-01-01', 'completed')]);
  await f.page.refresh();
  assert.equal(f.page.data.next.id, 8);
  assert.deepEqual(ids(f.page.data.moreUpcoming), [7, 4]);
  assert.deepEqual(ids(f.page.data.recent), [12]);
  const tree = render(f.page.data);
  assert.ok(text(withClass(tree, 'home-upcoming-row')[1]).includes('时间待定'));
  const all = nodes(tree), focus = all.indexOf(withClass(tree, 'next-section')[0]), list = all.indexOf(withClass(tree, 'home-upcoming-list')[0]), quick = all.indexOf(withClass(tree, 'club-quick')[0]);
  assert.ok(focus < list && list < quick, 'list follows focus and precedes unchanged shortcuts');
});
test('刷新变少会清除旧条目；隐藏清空列表且晚到请求不得恢复旧内容', async () => {
  const f = fixture([match(1), match(2), match(3)]);
  await f.page.refresh();
  f.replace([match(1)]); await f.page.refresh(); assert.equal(f.page.data.moreUpcoming.length, 0);
  f.replace([match(1), match(2), match(3)]); await f.page.refresh();
  let release; f.hold(new Promise(resolve => { release = resolve; }));
  const pending = f.page.refresh(); await Promise.resolve();
  f.page.onHide(); assert.equal(f.page.data.moreUpcoming.length, 0);
  release([match(4), match(5)]); await pending;
  assert.equal(f.page.data.moreUpcoming.length, 0);
  assert.equal(withClass(render(f.page.data), 'home-upcoming-list').length, 0);
});
test('加载及错误状态隐藏新增列表，无额外列表时不留空壳', async () => {
  const f = fixture([match(1), match(2), match(3)]); await f.page.refresh();
  for (const patch of [{ loading: true }, { error: '临时故障' }, { moreUpcoming: [] }]) assert.equal(withClass(render({ ...f.page.data, ...patch }), 'home-upcoming-list').length, 0);
});
function original(value) { for (const { before, after } of contracts.changes) { assert.equal(value.split(after).length, 2, 'home list projection must match exactly once'); value = value.replace(after, before); } return value; }
test('首页新增列表只逆投影3个精确片段，保留原排序/请求/生命周期哈希', () => {
  assert.equal(crypto.createHash('sha256').update(original(source)).digest('hex'), contracts.sha256);
  for (const { after } of contracts.changes) {
    assert.throws(() => original(source.replace(after, after.replace(/\S/, '!'))));
    assert.throws(() => original(source.replace(after, after + after)));
  }
  assert.equal(original(source + '\nextra'), original(source) + '\nextra');
});
