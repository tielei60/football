const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
function page(name, shared, ui = {}, wx = {}) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages', name, 'index.js'), 'utf8'), {
    require: name => name.endsWith('/utils/ui') ? ui : shared,
    Page: value => { definition = value; }, wx, Date, Promise, encodeURIComponent,
  });
  return { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
}
test('home role label comes only from validated session; unknown role is not presented as player', async () => {
  for (const [role, expected] of [['admin', '管理端'], ['player', '球员端'], ['unknown', '']]) {
    const session = { user: { role, playerId: 'p1' }, team: { name: '测试' } };
    const shared = {
      load: async (owner, work) => owner.setData(await work(session)), teamView: value => value,
      api: { request: async url => url.startsWith('/statistics') ? { team: { matches: 0, wins: 0 } } : [] },
    };
    const instance = page('home', shared);
    await instance.refresh();
    assert.equal(instance.data.roleLabel, expected);
    assert.equal(instance.data.token, undefined);
    assert.equal(instance.switchRole, undefined);
  }
});
test('switch account keeps confirmation cancellation and authenticated logout navigation', async () => {
  let confirm, logouts = 0;
  const navigations = [];
  const instance = page('me', { api: { getSession: () => null, logout: async () => { logouts++; } } },
    { showModal: (_, options) => { confirm = options.success; } },
    { reLaunch: options => navigations.push(options.url) });
  instance.logout();
  await confirm({ confirm: false });
  assert.equal(logouts, 0);
  assert.equal(navigations.length, 0);
  instance.logout();
  await confirm({ confirm: true });
  assert.equal(logouts, 1);
  assert.deepEqual(navigations, ['/pages/login/index']);
});
test('entry wording explains shared roles without introducing a local role selector', () => {
  const read = name => fs.readFileSync(path.join(root, 'pages', name, 'index.wxml'), 'utf8');
  assert.match(read('login'), /管理员与球员共用此入口/);
  assert.match(read('home'), /roleLabel/);
  assert.match(read('me'), /role==='player'\?'球员'/);
  assert.match(read('me'), /bindtap="logout"[^>]*>退出 \/ 切换账号/);
  assert.doesNotMatch(read('login'), /switchRole|roleIndex|bindchange="role"/);
});

test('read-only tactics and admin match entry do not advertise unavailable editing or registration', () => {
  const board = fs.readFileSync(path.join(root, 'pages/tactic-board/index.wxml'), 'utf8');
  const home = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
  assert.ok(board.includes("canEdit?'可编辑画布、动画与阵型。':'当前为只读，可查看站位与播放已有演示。'"));
  assert.ok(home.includes("roleLabel==='管理端'?'查看比赛':'查看比赛与报名'"));
  assert.match(board, /wx:if="{{canEdit}}"[^>]*id="edit-positions"/);
});
