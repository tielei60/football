const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
function loadPage(file, shared, wx = {}) {
  let page;
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { Page: value => { page = value; }, require: name => name.includes('shared') ? shared : name.includes('location') ? { matchVenue: () => ({}) } : {}, wx, Map, Promise, encodeURIComponent });
  return page;
}
test('published match shares its own detail path; drafts do not leak details', () => {
  const page = loadPage('pages/match-detail/index.js', {});
  page.id = '42';
  page.data = { team: { name: '球队' }, match: { status: 'published', dateLabel: '11月18日 周三', kickoff: '20:00', opponent: '对手' } };
  const share = page.onShareAppMessage();
  assert.equal(share.path, '/pages/match-detail/index?id=42');
  assert.match(share.title, /周三 20:00.*快来报名/);
  page.data.match.status = 'draft';
  assert.equal(page.onShareAppMessage().path, '/pages/home/index');
  assert.match(fs.readFileSync(path.join(root, 'pages/match-detail/index.wxml'), 'utf8'), /open-type="share"/);
});
test('login returns to a shared match and rejects arbitrary destinations', () => {
  const destinations = [];
  const shared = { api: { getSession: () => ({ user: {} }), enterAuthenticated: () => destinations.push('home') } };
  const page = loadPage('pages/login/index.js', shared, { redirectTo: x => destinations.push(x.url) });
  page.onLoad({ matchId: '42' }); page.enterAuthenticated();
  page.onLoad({ matchId: '../../other' }); page.enterAuthenticated();
  assert.deepEqual(destinations, ['/pages/match-detail/index?id=42', 'home']);
});
test('share card draws match details and grouped responses with bounded text', () => {
  const { draw } = require('../utils/match-share-card');
  const texts = [];
  const ctx = { fillRect() {}, fillText(text) { texts.push(text); }, measureText(text) { return { width: Array.from(text).length * 20 }; } };
  const canvas = { getContext: () => ctx };
  draw(canvas, { dateLabel: '11月18日 周三', kickoff: '20:00', location: '足球场', competition: '友谊赛', opponent: '朋友队' }, [
    { label: '参加', name: '大林' }, { label: '参加', name: '小涛' }, { label: '待定', name: '张铁磊' },
  ]);
  assert.equal(canvas.width, 1000);
  assert.ok(texts.some(x => x.includes('足球场')));
  assert.ok(texts.includes('参加（2）：'));
  assert.ok(texts.includes('大林、小涛'));
  assert.ok(texts.includes('待定（1）：'));
  assert.ok(texts.includes('请假（0）：'));
});
