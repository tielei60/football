// ZIP V3 25/26/27 展示契约；不替代原生能力、权限与网络验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (page, ext='wxml') => fs.readFileSync(path.join(__dirname, '../pages', page, 'index.'+ext), 'utf8');
test('导出文件反馈与预览保存入口先于大图，画布保持原生实现', () => {
  const w=read('tactic-export'), css=read('tactic-export','wxss');
  const positions=['wx:if="{{ready}}"','临时文件已生成','id="tactic-export-preview"','id="tactic-export-save"','wx:if="{{pngPath}}"'].map(x=>w.indexOf(x));
  assert.ok(positions.every(x=>x>=0));
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
  assert.match(w, /id="tactic-export-save"[^>]*bindtap="saveLocal"[^>]*class="primary ui-button ui-block"/);
  assert.match(w, /<canvas hidden="{{businessUiBlocking}}" id="export-canvas" type="2d" class="export-canvas"\/>/);
  assert.match(css,/\.export-result-actions[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/\.page \.export-result-actions > button\.ui-button[^}]*min-height:44px/);
});
test('照片标签持续可见且只读不露出说明编辑，计数与选图区域独立', () => {
  const w=read('player-photos'),css=read('player-photos','wxss');
  assert.match(w, /wx:if="{{admin}}" class="photo-field-label">照片说明（可选）/);
  assert.match(w, /<view class="photo-field-label">照片说明（可选）<\/view>\s*<input class="input" value="{{caption}}"/);
  assert.match(w, /class="photos-heading"/);assert.match(w,/class="photos-count"/);
  assert.match(w, /id="choose-photo" bindtap="choose" disabled="{{loading \|\| \(busy\|\|conflict\|\|uncertain\|\|recoveryBlocked\)}}"/);
  assert.match(w, /class="club-banner-mark" src="\/assets\/team-badge.png"/);
  assert.match(w, /wx:if="{{item.generated}}"/);assert.match(w,/{{item.originLabel}}/);
  assert.match(css,/\.page button\.photo-choose[^}]*min-height:44px[^}]*border:1px dashed/);
});
test('申请结果先于原认领表单，全部恢复入口与状态语义保留', () => {
  const w=read('wechat-claim');
  const state=w.indexOf('wx:if="{{status}}"'),form=w.indexOf('<view class="field-label">邀请码');
  assert.ok(state>=0&&form>state);
  assert.match(w,/class="claim-status-heading"/);assert.match(w,/申请状态/);assert.match(w,/{{statusLabel}}/);
  for (const handler of ['credential','submit','status','login','back']) assert.match(w,new RegExp('bind(?:tap|input)="'+handler+'"'));
  assert.match(w,/wx:if="{{showInput}}" class="input" password/);
  assert.match(w,/审批记录不代表当前绑定仍有效/);
  assert.match(w,/审核前没有球队访问权限/);
  assert.match(w,/disabled="{{busy\|\|!hasCredential}}"/);
});
