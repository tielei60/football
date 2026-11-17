// 展示契约不代替微信原生截图、触点和业务验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=(p,e)=>fs.readFileSync(path.join(__dirname,'../pages',p,'index.'+e),'utf8');
test('战术编排专注入口保持唯一、原禁用条件并与画布工具同组',()=>{
 const w=read('tactic-compose','wxml');assert.equal((w.match(/id="compose-focus"/g)||[]).length,1);
 assert.match(w,/<view class="row compose-tools"><button id="compose-focus" class="small" bindtap="toggleFocus" disabled="\{\{busy\}\}">/);
 assert.ok(!w.slice(w.indexOf('class="row stage-selector-row"'),w.indexOf('class="row stage-actions"')).includes('compose-focus'));
 assert.match(w,/id="compose-canvas"/);
});
test('战术列表搜索保留绑定、卡片箭头独立且不占标题空间',()=>{
 const w=read('tactics','wxml');assert.match(w,/class="tactic-search"/);assert.match(w,/value="\{\{search\}\}" bindinput="search"/);assert.match(w,/class="tactic-chevron" aria-hidden="true"/);assert.match(w,/data-id="\{\{item.id\}\}" bindtap="open"/);
});
test('导出卡片保留来源、文件预览和保存条件',()=>{
 const w=read('tactic-export','wxml');assert.match(w,/class="export-heading">生成文件/);for(const value of ['{{title}}','{{source}}','wx:if="{{ready}}"','wx:if="{{pngPath}}"','bindtap="png"','bindtap="pdf"','bindtap="preview"','bindtap="saveLocal"'])assert.ok(w.includes(value),value);
});
test('战术次操作保留44px触点与展示层边界',()=>{
 for(const p of ['tactic-board','tactic-compose','tactic-setup','tactic-transfer','tactic-export']){const css=read(p,'wxss');assert.ok(css.includes('V3 原生复核：'));assert.ok(css.includes('min-height:44px'));}
 const board=read('tactic-board','wxss');assert.match(board,/grid-template-columns:minmax\(0,1fr\) auto auto/);
});
test('新白底战术次按钮不覆盖禁用背景',()=>{
 for(const [p,ids] of [['tactics',['tactic-transfer']],['tactic-transfer',['transfer-choose','transfer-export','transfer-save']],['tactic-export',['tactic-export-pdf','tactic-export-preview']]]){
  const s=read(p,'wxss');for(const id of ids)assert.ok(s.includes('#'+id+':not([disabled])'),id);
 }
});
test('原生复核的小按钮显式垂直居中，输入值不继承标签粗体',()=>{
 for(const p of ['tactic-board','tactic-compose','tactic-setup'])assert.match(read(p,'wxss'),/display:flex;align-items:center;justify-content:center;min-height:44px/);
 const s=read('tactic-setup','wxss');assert.match(s,/\.metadata-card input\{padding:0 20rpx;font-weight:400\}/);assert.match(s,/\.metadata-card textarea\{font-weight:400\}/);
});
