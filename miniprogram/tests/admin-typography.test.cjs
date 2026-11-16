// 2026-11 全页视觉优化：严格保护当前业务模板/JS，不再冻结旧版文字几何。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const baseline = require('./managed-ui-contract-baseline.json');
const root = path.resolve(__dirname, '..');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function markup(source, item) {
  // 仅允许本轮明确新增的可见字段标签及主次文字包装；所有其他字面内容/属性完全保持。
  if (item === 'pages/manage-players') source = source.replace('{{item.name}}<text class="player-number-note">{{item.numberDescription}}</text>', '{{item.name}} · {{item.numberDescription}}');
  if (item === 'pages/system-accounts') {
    source = source.replace('<text class="field-label">用户名</text>', '').replace('<text class="field-label">初始密码 · 10–200 位</text>', '');
    source = source.replace(/<text class="account-role">([^<]*)<\/text>/, '$1').replace(/<text class="account-state [^"]*">([^<]*)<\/text>/, '$1');
  }
  return source.replace(/\sclass="[^"]*"/g, '');
}
for (const [item, expected] of Object.entries(baseline)) {
  test(`${item}: 视觉优化保留全部字段、条件、事件、权限及业务逻辑`, () => {
    const read = ext => fs.readFileSync(path.join(root,item,'index.'+ext),'utf8');
    assert.equal(hash(markup(read('wxml'),item)),expected.wxml,'除明确的视觉包装外模板必须完全一致');
    assert.equal(hash(read('js')),expected.js,'禁止修改业务JS');
    const css = read('wxss');
    assert.match(css,/var\(--type-/,'每页明确接入共同层级');
    assert.doesNotMatch(css,/text-overflow:\s*ellipsis/,'本次不能截断必要信息');
  });
}
test('管理列表、状态与认证表单保留语义，不用颜色代替文字', () => {
 const read = p => fs.readFileSync(path.join(root,'pages',p,'index.wxml'),'utf8');
 assert.match(read('manage-players'),/player-number-note/);
 assert.match(read('manage-player'),/status-pending/);
 assert.match(read('manage-player'),/状态未确认/);
 assert.match(read('manage-venues'),/已停用/);
 assert.match(read('system-accounts'),/<text class="field-label">用户名<\/text>/);
 assert.match(read('system-accounts'),/account-role/);
 assert.match(read('system-accounts'),/item.systemAdmin/);
 assert.match(read('force-password'),/password maxlength="200"/);
 assert.match(read('wechat-invites'),/invite-pending/);
});
test('邀请组件样式隔离与小屏操作保留', () => {
 const css=fs.readFileSync(path.join(root,'components/invite-sheet/index.wxss'),'utf8');
 assert.match(css,/var\(--type-page,38rpx\)/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/min-height:44px/);
 assert.match(css,/height:58vh/);
});

test('危险色仅对可操作的按钮生效，禁用态沿用共享样式',()=>{
 for(const folder of ['pages/wechat-invites','components/invite-sheet'])assert.match(fs.readFileSync(path.join(root,folder,'index.wxss'),'utf8'),/\.page button\.invite-danger\[size="mini"\]:not\(\[disabled\]\)/);
 assert.match(fs.readFileSync(path.join(root,'pages/system-accounts/index.wxss'),'utf8'),/\.account-actions button\.account-danger:not\(\[disabled\]\)/);
});
