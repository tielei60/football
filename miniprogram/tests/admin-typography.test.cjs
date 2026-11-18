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
  // 仅新增账号列表展示外框，原循环/角色操作条件仍按基线冻结。
  source=source.replace('<view wx:if="{{accounts.length}}" class="card account-list">','<view>');
  // 唯一新增无权限展示卡；精确移除全文，导航/门禁另有专项契约，原账号业务基线不变。
  source=source.replace("<view wx:if=\"{{!loading && error==='仅系统管理员可以管理账号。'}}\" class=\"card access-denied\"><view class=\"access-denied-title\">无权访问此功能</view><view class=\"access-denied-description\">当前身份没有系统管理权限，实际权限仍由服务端校验。</view><navigator class=\"access-denied-return\" open-type=\"switchTab\" url=\"/pages/me/index\" hover-class=\"club-card-pressed\">返回我的</navigator></view>",'');
  // 仅新增错误展示区，原表单可见条件/事件保持冻结。
  source=source.replace('<view wx:if="{{errorSource===\'submit\' && error}}" class="error" aria-role="alert" aria-live="assertive">{{error}}</view>','');
  // 球场冲突补充复用checkList的显式入口；完整条件另由专用契约保护。
  source=source.replace('<button wx:if="{{conflict&&!uncertain}}" class="ui-button ui-block venue-reconcile" size="mini" disabled="{{loading || busy}}" bindtap="checkList">返回球场列表核对</button>','');
  // 新增纯展示分组标题，不涉及账号权限或操作分支。
  source=source.replace('<view wx:if="{{accounts.length}}" class="section-title accounts-heading">球队账号</view>','');
  // 持久展示标签仅重复相邻控件已有可见条件；控件本身仍严格冻结。
  for(const label of [
    '<view wx:if="{{searchHasText}}" class="empty-hint">请尝试其他姓名或号码</view>',
    '<label wx:if="{{!hasAccount}}" class="field-label" for="player-account-name">登录账号</label>',
    '<view wx:if="{{candidates.length}}" class="field-label candidate-label">可添加球员</view>',
    '<text wx:if="{{candidates.length}}" class="field-label candidate-label">添加赛季球员</text>'
  ]) source=source.replace(label,'');
  // 第四阶段只增加恢复提示容器和只读说明；原事件、按钮条件及输入约束仍按旧基线冻结。
  // 新提示分支由 v3-match-recovery-display 和 v3-login-readonly-state-display 独立测试。
  source=source.replace('<view wx:if="{{conflict||uncertain}}" class="recovery-notice">','<view>');
  source=source.replace('<view wx:if="{{actionError}}" class="recovery-message">{{actionError}}</view>','');
  source=source.replace('<view wx:if="{{actionError&&!conflict&&!uncertain}}" class="error">','<view wx:if="{{actionError}}" class="error">');
  source=source.replace('<view wx:if="{{!admin}}" class="readonly-notes"><view class="readonly-season-note">赛季号码与当前球员资料可以不同。</view><view class="hint">赛季留存资料不改变球员当前资料或历史比赛快照。</view></view>','');
  return JSON.stringify((s=>[...s.matchAll(/<[\w-]+\b[^>]*>/g)].map(m=>{const attrs=[...m[0].matchAll(/\b((?:bind|catch)(?::)?\w+|wx:(?:if|elif|else|for|for-item|for-index|key)|disabled|value|checked|maxlength|type|password|data-[\w-]+)\s*=\s*"([^"]*)"/g)].map(a=>[a[1],a[2]]).sort((a,b)=>a[0].localeCompare(b[0]));return attrs.length?[m[0].match(/^<([\w-]+)/)[1],attrs]:null}).filter(Boolean).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))(source));
}
// 仅还原本次获准的归档成功展示同步；完整回调和相邻提示精确匹配且只能出现一次。
function normalizeMatchAuth(source) {
 for(const {before,after} of require('./match-edit-auth-projection.json')) {
  assert.equal(source.split(after).length,2,'比赛认证恢复片段必须完整且唯一');source=source.replace(after,before);
 }
 return source;
}
test('比赛认证投影拒绝重复篡改且保留其他业务',()=>{
 const source=fs.readFileSync(path.join(root,'pages/match-edit/index.js'),'utf8'),{after}=require('./match-edit-auth-projection.json')[0];
 assert.throws(()=>normalizeMatchAuth(source.replace(after,after+after)));
 assert.throws(()=>normalizeMatchAuth(source.replace('error.staleSession !== true','true')));
 assert.equal(normalizeMatchAuth(source+'\nextra'),normalizeMatchAuth(source)+'\nextra');
});
function normalizePlayerArchive(source) {
  const current = `            (p) => {
              this.setData({
                revision: p.revision,
                status: p.status,
                membershipConfirmed: p.membershipConfirmed !== false,
                membershipIndex: p.membershipConfirmed === false ? 0 : p.status === "inactive" ? 2 : 1,
              });
              ui.showToast(this, { title: "状态已更新" });
            },`;
  const previous = `            (p) => {
              this.setData({ revision: p.revision, status: p.status });
              ui.showToast(this, { title: "状态已更新" });
            },`;
  assert.equal(source.split(current).length - 1, 1, "归档成功展示同步须完整唯一，变更需重新审查");
  const start = source.indexOf("  archive() {"), end = source.indexOf("  toggleAccount() {", start);
  const position = source.indexOf(current);
  assert.ok(start >= 0 && end > start && position > start && position + current.length < end,
    "获准片段只能位于归档方法内");
  return source.replace(current, previous);
}
test("归档展示归一化拒绝映射篡改、重复或移出方法，保留其它源码", () => {
  const source = fs.readFileSync(path.join(root, "pages/manage-player/index.js"), "utf8");
  assert.throws(() => normalizePlayerArchive(source.replace("membershipIndex: p.membershipConfirmed === false ? 0 : p.status === \"inactive\" ? 2 : 1", "membershipIndex: 1")));
  assert.throws(() => normalizePlayerArchive(source + source));
  assert.throws(() => normalizePlayerArchive(source.replace("  archive() {", "  archiveChanged() {")));
  const extra = "\n// 其它源码不得被归一化删除\n";
  assert.equal(normalizePlayerArchive(source + extra), normalizePlayerArchive(source) + extra);
});

function normalizePlayerAccountAndTitle(source) {
  const changes = [["      (p) => {\n        const created = !this.id;\n        this.id = p.id;\n        this._imageData = undefined;\n        this.setData({\n          id: p.id,\n          revision: p.revision,\n          hasAccount: p.hasAccount,\n          passwordEnabled: p.passwordEnabled !== false,\n        });\n        if (created) wx.setNavigationBarTitle?.({ title: \"编辑球员\" });\n        ui.showToast(this, { title: \"球员已保存\" });\n      },\n", "      (p) => {\n        this.id = p.id;\n        this._imageData = undefined;\n        this.setData({\n          id: p.id,\n          revision: p.revision,\n          hasAccount: p.hasAccount,\n          passwordEnabled: p.passwordEnabled !== false,\n        });\n        ui.showToast(this, { title: \"球员已保存\" });\n      },\n", "  save() {", "  membership(e) {"], ["          (result) => {\n            this.setData({\n              password: \"\",\n              username: \"\",\n              hasAccount: true,\n              passwordEnabled: existing ? this.data.passwordEnabled : result?.passwordEnabled !== false,\n              accountOpen: false,\n            });\n            ui.showToast(this, {\n              title: existing ? \"密码已重置\" : \"账号已开通\",\n            });\n          },\n", "          () => {\n            this.setData({\n              password: \"\",\n              username: \"\",\n              hasAccount: true,\n              accountOpen: false,\n            });\n            ui.showToast(this, {\n              title: existing ? \"密码已重置\" : \"账号已开通\",\n            });\n          },\n", "  account() {", "  backToList() {"]];
  for (const [current, previous, begin, end] of changes) {
    assert.equal(source.split(current).length - 1, 1, "账号能力与新建标题完整获准片段必须唯一");
    const start = source.indexOf(begin), stop = source.indexOf(end, start), at = source.indexOf(current);
    assert.ok(start >= 0 && stop > start && at > start && at + current.length < stop);
    source = source.replace(current, previous);
  }
  return source;
}
test("账号能力与标题归一化拒绝篡改重复片段且不吞其它逻辑", () => {
  const source = fs.readFileSync(path.join(root, "pages/manage-player/index.js"), "utf8");
  assert.throws(() => normalizePlayerAccountAndTitle(source.replace("passwordEnabled: existing ? this.data.passwordEnabled : result?.passwordEnabled !== false", "passwordEnabled: true")));
  assert.throws(() => normalizePlayerAccountAndTitle(source + source));
  assert.throws(() => normalizePlayerAccountAndTitle(source.replace("const created = !this.id;", "const created = true;")));
  const extra = "\n// 未获准源码仍进入原SHA\n";
  assert.equal(normalizePlayerAccountAndTitle(source + extra), normalizePlayerAccountAndTitle(source) + extra);
});
// 账号切换筛选重置已由 membership-state 专项审查，仅归一化唯一完整片段。
function normalizeRosterAccountFilters(source) {
  const current = `      this.setData({
        status: "active",
        statusInitialized: false,
        search: "",
        searchHasText: false,
      });`;
  assert.equal(source.split(current).length, 2, '账号筛选重置片段必须唯一且完整');
  return source.replace(current, '      this.setData({status:"active",statusInitialized:false});');
}
test('账号筛选重置归一化不接受篡改或重复片段', () => {
  const source = fs.readFileSync(path.join(root, 'pages/manage-players/index.js'), 'utf8');
  assert.throws(() => normalizeRosterAccountFilters(source + source));
  assert.throws(() => normalizeRosterAccountFilters(source.replace('        search: "",', '        search: "保留旧值",')));
  const extra = '\n// 其它改动仍进入原始SHA\n';
  assert.equal(normalizeRosterAccountFilters(source + extra), normalizeRosterAccountFilters(source) + extra);
});
function normalizeVenueReceipts(source) {
  for (const {before,after} of require('./venue-late-receipt-projection.json')) {
    assert.equal(source.split(after).length, 2, '球场回执精确变更块必须唯一且完整');
    source=source.replace(after,before);
  }
  return source;
}
test('球场回执投影拒绝重复、篡改，并保留额外业务代码',()=>{
  const source=fs.readFileSync(path.join(root,'pages/manage-venue/index.js'),'utf8');
  assert.throws(()=>normalizeVenueReceipts(source+source));
  const block=require('./venue-late-receipt-projection.json')[0].after;
  assert.throws(()=>normalizeVenueReceipts(source.replace(block,block+'// tampered').replace('function current(page, operation)', 'function current(page, changed)')));
  const extra='\n// 额外代码仍受旧基线保护\n';
  assert.equal(normalizeVenueReceipts(source+extra),normalizeVenueReceipts(source)+extra);
});
function normalizeSeasonAuth(source) {
 for(const {before,after} of require('./season-roster-auth-projection.json')) {
  assert.ok(before&&after);assert.equal(source.split(after).length,2,'赛季阵容认证片段必须唯一完整');source=source.replace(after,before);
 }
 return source;
}
function normalizeSeasonReturn(source) {
  for (const {before,after} of require('./season-roster-return-projection.json')) {
    assert.equal(source.split(after).length,2,'赛季返回权限变更必须精确且唯一');
    source=source.replace(after,before);
  }
  return source;
}
test('赛季返回权限投影拒绝重复与篡改并保留未批准代码',()=>{
  const source=fs.readFileSync(path.join(root,'pages/season-roster/index.js'),'utf8');
  assert.throws(()=>normalizeSeasonReturn(source+source));
  assert.throws(()=>normalizeSeasonReturn(source.replace("const admin=session.user.role==='admin';",'const admin=true;')));
  const extra='\n// 其它业务代码继续冻结\n';
  assert.equal(normalizeSeasonReturn(source+extra),normalizeSeasonReturn(source)+extra);
});
// 系统账号当前401恢复：只反向投影完整唯一已审查片段，不改原SHA。
const systemAuthBlocks=require('./system-accounts-auth-projection.json');
function normalizeSystemAuth(source){
 for(const {before,after} of systemAuthBlocks){
  assert.equal(source.split(after).length,2,'系统账号认证恢复片段必须唯一且完整');
  source=source.replace(after,before);
 }
 return source;
}
test('系统账号认证投影拒绝篡改重复，其他源码继续参与哈希',()=>{
 const source=fs.readFileSync(path.join(root,'pages/system-accounts/index.js'),'utf8');
 for(const {after} of systemAuthBlocks){
  assert.throws(()=>normalizeSystemAuth(source.replace(after,after.replace(/\S/,c=>c==='!'?'?':'!'))));
  assert.throws(()=>normalizeSystemAuth(source.replace(after,after+after)));
 }
 assert.equal(normalizeSystemAuth(source+'\nextra'),normalizeSystemAuth(source)+'\nextra');
});
// 强制改密仅归一化加载回执归属，本次不改变密码提交逻辑或规则。
const passwordLoadBlocks=require('./force-password-load-projection.json');
function normalizePasswordLoad(source){
 for(const {before,after} of passwordLoadBlocks){
  assert.equal(source.split(after).length,2,'改密加载归属片段必须唯一且完整');
  source=source.replace(after,before);
 }
 return source;
}
test('改密加载投影拒绝篡改重复并保留其他源码',()=>{
 const source=fs.readFileSync(path.join(root,'pages/force-password/index.js'),'utf8');
 for(const {after} of passwordLoadBlocks){
  assert.throws(()=>normalizePasswordLoad(source.replace(after,after.replace(/\S/,c=>c==='!'?'?':'!'))));
  assert.throws(()=>normalizePasswordLoad(source.replace(after,after+after)));
 }
 assert.equal(normalizePasswordLoad(source+'\nextra'),normalizePasswordLoad(source)+'\nextra');
});
const passwordSubmitBlocks=require('./force-password-submit-projection.json');
function normalizePasswordSubmit(source){
 for(const {before,after} of passwordSubmitBlocks){
  assert.equal(source.split(after).length,2,'改密提交归属片段必须唯一且完整');
  source=source.replace(after,before);
 }
 return source;
}
test('改密提交投影拒绝篡改重复并保留其他源码',()=>{
 const source=normalizePasswordGate(fs.readFileSync(path.join(root,'pages/force-password/index.js'),'utf8'),'js');
 for(const {after} of passwordSubmitBlocks){
  assert.throws(()=>normalizePasswordSubmit(source.replace(after,after.replace(/\S/,c=>c==='!'?'?':'!'))));
  assert.throws(()=>normalizePasswordSubmit(source.replace(after,after+after)));
 }
 assert.equal(normalizePasswordSubmit(source+'\nextra'),normalizePasswordSubmit(source)+'\nextra');
});
const passwordGateBlocks=require('./force-password-load-gate-projection.json');
function normalizePasswordGate(source,ext){
 for(const change of passwordGateBlocks.filter(b=>b.ext===ext)){
  assert.equal(source.split(change.after).length,2,'改密初始化门禁必须唯一且完整');
  source=source.replace(change.after,change.before);
 }
 return source;
}
test('改密初始化门禁投影拒绝篡改重复并保留其他源码',()=>{
 for(const {ext,after} of passwordGateBlocks){
  const source=fs.readFileSync(path.join(root,'pages/force-password/index.'+ext),'utf8');
  assert.throws(()=>normalizePasswordGate(source.replace(after,after.replace(/\S/,c=>c==='!'?'?':'!')),ext));
  assert.throws(()=>normalizePasswordGate(source.replace(after,after+after),ext));
  assert.equal(normalizePasswordGate(source+'\nextra',ext),normalizePasswordGate(source,ext)+'\nextra');
 }
});
function normalizeSystemCreate(source){
 for(const {before,after} of require('./system-accounts-create-projection.json')){
  assert.equal(source.split(after).length,2,'账号同名核对片段必须唯一完整');
  source=source.replace(after,before);
 }
 return source;
}
test('账号同名核对投影拒绝篡改重复，其他代码仍参与哈希',()=>{
 const source=fs.readFileSync(path.join(root,'pages/system-accounts/index.js'),'utf8');
 for(const {after} of require('./system-accounts-create-projection.json')){
  assert.throws(()=>normalizeSystemCreate(source.replace(after,after.replace('[A-Z]','[A-Za-z]'))));
  assert.throws(()=>normalizeSystemCreate(source.replace(after,after+after)));
 }
 assert.equal(normalizeSystemCreate(source+'\nextra'),normalizeSystemCreate(source)+'\nextra');
});
function normalizeSeasonRestoredTitle(source){
 for(const {before,after} of require('./season-restored-title-projection.json')){
  assert.equal(source.split(after).length,2,'赛季恢复标题片段必须唯一完整');source=source.replace(after,before);
 }
 return source;
}
test('赛季恢复标题投影拒绝篡改重复并保留其他源码',()=>{
 const source=fs.readFileSync(path.join(root,'pages/manage-season/index.js'),'utf8');
 for(const {after} of require('./season-restored-title-projection.json')){
  assert.throws(()=>normalizeSeasonRestoredTitle(source.replace(after,after.replace(/\S/,c=>c==='!'?'?':'!'))));
  assert.throws(()=>normalizeSeasonRestoredTitle(source.replace(after,after+after)));
 }
 assert.equal(normalizeSeasonRestoredTitle(source+'\nextra'),normalizeSeasonRestoredTitle(source)+'\nextra');
});
function normalizeVenuesPermission(source,ext){
 for(const {before,after} of require('./venues-permission-projection.json')[ext].changes){
  assert.equal(source.split(after).length,2,'球场列表权限片段必须唯一完整');source=source.replace(after,before);
 }
 return source;
}
for (const [item, expected] of Object.entries(baseline)) {
  test(`${item}: 视觉优化保留全部字段、条件、事件、权限及业务逻辑`, () => {
    const read = ext => fs.readFileSync(path.join(root,item,'index.'+ext),'utf8');
    assert.equal(hash(markup(item==='pages/manage-venues'?normalizeVenuesPermission(read('wxml'),'wxml'):item==='pages/force-password'?normalizePasswordGate(read('wxml'),'wxml'):read('wxml'),item)),expected.wxml,'事件、条件、输入约束与数据定位必须保持');
    let businessSource=read('js');
    if(item==='pages/manage-venues') businessSource=normalizeVenuesPermission(businessSource,'js');
    if(item==='pages/manage-season') businessSource=normalizeSeasonRestoredTitle(businessSource);
    if(item==='pages/force-password') businessSource=normalizePasswordLoad(normalizePasswordSubmit(normalizePasswordGate(businessSource,'js')));
    if(item==='pages/system-accounts') businessSource=normalizeSystemAuth(normalizeSystemCreate(businessSource));
    if(item==='pages/match-edit') businessSource=normalizeMatchAuth(businessSource);
    if(item==='pages/manage-venue') businessSource=normalizeVenueReceipts(businessSource);
    if(item==='pages/match-roster') {
      // 阶段34唯一允许项：未知保存回执提示与statusCode兼容；专项控制器测试覆盖网络/502/409/400。
      // 精确校验已复审新实现，再还原旧片段比对原基线，避免放宽其余名单业务约束。
      const reviewed = `      const status = error.status || error.statusCode;
      const conflict = status === 409;
      const unconfirmed = !status || status >= 500;
      const patch = { conflict, actionError: conflict ? '比赛已被修改，输入已保留。请核对后重新载入，不能直接覆盖。' : unconfirmed ? '保存结果尚未确认，输入已保留。请返回并重新打开名单核对，勿直接重复保存。' : error.message || '保存未完成，输入已保留。' };`;
      assert.equal(businessSource.split(reviewed).length, 2, '名单未知回执提示实现变更需复审');
      businessSource = businessSource.replace(reviewed, `      const conflict = error.status === 409;
      const patch = { conflict, actionError: conflict ? '比赛已被修改，输入已保留。请核对后重新载入，不能直接覆盖。' : error.message || '保存未完成，输入已保留。' };`);
    }

    if(item==='pages/season-roster') businessSource=normalizeSeasonReturn(normalizeSeasonAuth(businessSource));
    if(item==='pages/manage-player'||item==='pages/manage-season') {
      // 仅归一化这一条已专项验证的原生标题调用，不重置业务基线。
      const subject=item==='pages/manage-player'?'球员':'赛季';
      businessSource=businessSource.replace(`    wx.setNavigationBarTitle?.({ title: this.id ? "编辑${subject}" : "新增${subject}" });\n`,'');
    }
    if(item==='pages/manage-season') {
      const savedTitle = '        wx.setNavigationBarTitle?.({ title: "编辑赛季" });\n';
      assert.equal(businessSource.split(savedTitle).length, 2, '保存后的编辑标题必须唯一');
      businessSource=businessSource.replace(savedTitle,'');
    }
    if(item==='pages/manage-player') businessSource=normalizePlayerAccountAndTitle(normalizePlayerArchive(businessSource));
    if(item==='pages/manage-players') {
      businessSource=normalizeRosterAccountFilters(businessSource);
      // 仅允许新增查询是否有效的展示投影；原输入、筛选及权限逻辑仍按旧基线冻结。
      businessSource=businessSource.replace('    searchHasText: false,\n','').replace('search: e.detail.value, searchHasText: e.detail.value.trim().length > 0','search: e.detail.value');
    }
    if(item==='pages/force-password') {
      // 精确移除新增展示metadata，不允许改变校验、请求、会话与密码清空。
      businessSource=businessSource.replace('    errorSource: "",\n','').replace('loading: true, error: "", errorSource: "", busy: false','loading: true, error: "", busy: false').replace('error: e.message, errorSource: "load"','error: e.message').replace('        errorSource: "submit",\n','').replace('busy: true, error: "", errorSource: ""','busy: true, error: ""').replace('          errorSource: "submit",\n','');
    }
    if(item==='pages/manage-team') {
      const start=businessSource.indexOf('  remove() {'),end=businessSource.indexOf('  imageError()',start);assert.ok(start>=0&&end>start);
      // 唯一获准交互：队徽移除确认。固定完整实现，其余JS仍对照原始基线。
      assert.equal(hash(businessSource.slice(start,end)),"df7d2af077ee043e98084b0005cf1202a9c972ab19e4df13f93455cd5e323b3c",'移除确认实现变更需复审');
      businessSource=businessSource.slice(0,start)+"  remove() {\n    if (this.data.busy) return;\n    this._imageEpoch = (this._imageEpoch || 0) + 1;\n    this._imageData = null;\n    this.setData({ crest: \"\" });\n  },\n"+businessSource.slice(end);
    }
    assert.equal(hash(businessSource),expected.js,'原业务JS必须保持，新增展示投影由专项控制器测试验证');
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
 assert.match(fs.readFileSync(path.join(root,'pages/wechat-invites/index.wxss'),'utf8'),/\.page button\.invite-danger\[size="mini"\]:not\(\[disabled\]\)/);
 assert.match(fs.readFileSync(path.join(root,'components/invite-sheet/index.wxss'),'utf8'),/\.page \.invite-danger:not\(\.control-disabled\)/);
 assert.match(fs.readFileSync(path.join(root,'pages/system-accounts/index.wxss'),'utf8'),/\.account-actions button\.account-danger:not\(\[disabled\]\)/);
});
