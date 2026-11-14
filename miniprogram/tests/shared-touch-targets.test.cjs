// 静态规则回归，不代表原生渲染、真实点击域或辅助技术已经验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const cases = [
 ['app.wxss','button.ui-button:not(.ui-compact)[size="mini"]',84,392.857],
 ['app.wxss','button.ui-button.primary.ui-compact[size="mini"]',72,458.333],
 ['components/business-dialog/index.wxss','.dialog .buttons>button[size="mini"]',88,375],
 ['components/business-dialog/index.wxss','.dialog.selector-dialog .picker-panel .option-list button.option[size="mini"]',84,392.857],
 ['components/page-state/index.wxss','.state button.retry',80,412.5],
];
test('静态：主要动作分媒体高度下限，不以规则测试冒充实际触控测量',()=>{
 for (const [file,selector,rpx,limit] of cases) {
  const css=read(file), rule='@media(max-width:'+limit+'px){'+selector+'{min-height:44px}}';
  assert.ok(css.includes(rule),file+' expected scoped rule');
  assert.equal(css.lastIndexOf(selector),css.indexOf(rule)+rule.indexOf(selector),'winning selector is last');
  assert.ok(Math.abs(limit-44*750/rpx)<0.001,'threshold matches original rpx');
  for(const width of [320,375,430,500]) {
   const original=width*rpx/750, resulting=width<=limit?44:original;
   assert.ok(resulting+0.001>=original,'never shrink at '+width);
   assert.ok(resulting+0.001>=44,'main action minimum at '+width);
  }
 }
});
test('静态：保留输入光标、日历单元与普通紧凑工具的原尺寸',()=>{
 const app=read('app.wxss'), dialog=read('components/business-dialog/index.wxss');
 assert.match(app,/input\.input\{height:88rpx;min-height:88rpx;padding:0 24rpx;line-height:42rpx\}/);
 assert.match(app,/button\.ui-button\.ui-compact\[size="mini"\]\{min-height:72rpx;/);
 assert.match(dialog,/height:92rpx;padding:0 22rpx/);
 assert.match(dialog,/button\.day\[size="mini"\]\{[^}]*height:64rpx;[^}]*padding:0;line-height:64rpx/);
 const added=app.slice(app.indexOf('/* 仅主要动作'))+dialog.slice(dialog.indexOf('/* 仅确认'));
 assert.doesNotMatch(added,/(?:font-size|padding|line-height|\.day|input|\.nav-step):?/);
});
test('静态：日期占位不播报内部blank值，年份包含选中语义',()=>{
 const wxml=read('components/business-dialog/index.wxml');
 assert.ok(wxml.includes('aria-hidden="{{!item.label}}" aria-label="{{item.label ? item.value : \'\'}}"'));
 assert.ok(wxml.includes('bindtap="pickerYear" aria-label="{{item.label}}{{item.selected ? \'，当前选中\' : \'\'}}" aria-checked="{{item.selected}}"'));
});
