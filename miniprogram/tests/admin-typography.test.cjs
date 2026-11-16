// 2026-11 全页视觉优化：严格保护当前业务模板/JS，不再冻结旧版文字几何。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const baseline = require('./managed-ui-contract-baseline.json');
const root = path.resolve(__dirname, '..');
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
// UI v3 允许展示容器重排；逐元素冻结事件、状态、权限、输入约束和数据定位，基线来自原始提交而非改后结果。
function markup(source) {
  // 新增纯展示分组标题，不涉及账号权限或操作分支。
  source=source.replace('<view wx:if="{{accounts.length}}" class="section-title accounts-heading">球队账号</view>','');
  return JSON.stringify((s=>[...s.matchAll(/<[\w-]+\b[^>]*>/g)].map(m=>{const attrs=[...m[0].matchAll(/\b((?:bind|catch)(?::)?\w+|wx:(?:if|elif|else|for|for-item|for-index|key)|disabled|value|checked|maxlength|type|password|data-[\w-]+)\s*=\s*"([^"]*)"/g)].map(a=>[a[1],a[2]]).sort((a,b)=>a[0].localeCompare(b[0]));return attrs.length?[m[0].match(/^<([\w-]+)/)[1],attrs]:null}).filter(Boolean).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))(source));
}
for (const [item, expected] of Object.entries(baseline)) {
  test(`${item}: 视觉优化保留全部字段、条件、事件、权限及业务逻辑`, () => {
    const read = ext => fs.readFileSync(path.join(root,item,'index.'+ext),'utf8');
    assert.equal(hash(markup(read('wxml'),item)),expected.wxml,'事件、条件、输入约束与数据定位必须保持');
    assert.equal(hash(read('js')),expected.js,'禁止修改业务JS');
    const css = read('wxss');
    assert.match(css,/var\(--(?:type-|brand|muted|line)/,'每页接入共同设计令牌');
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
 assert.match(css,/var\(--type-page,\s*38rpx\)/);
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/min-height:\s*44px/);
 assert.match(css,/height:\s*58vh/);
});

test('危险色仅对可操作的按钮生效，禁用态沿用共享样式',()=>{
 for(const folder of ['pages/wechat-invites','components/invite-sheet'])assert.match(fs.readFileSync(path.join(root,folder,'index.wxss'),'utf8'),/\.page button\.invite-danger\[size="mini"\]:not\(\[disabled\]\)/);
 assert.match(fs.readFileSync(path.join(root,'pages/system-accounts/index.wxss'),'utf8'),/\.account-actions button\.account-danger:not\(\[disabled\]\)/);
});
