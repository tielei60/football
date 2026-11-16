// 选择器契约检查；不是微信真机触控或视觉验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../components');
const read=(name,ext)=>fs.readFileSync(path.join(root,name,'index.'+ext),'utf8');
test('隔离共享组件不用微信会忽略的标签、ID或属性选择器',()=>{
 for(const name of ['business-dialog','business-picker','page-state','invite-sheet','loading-skeleton']){
  const css=read(name,'wxss').replace(/\/\*[\s\S]*?\*\//g,'');
  for(const m of css.matchAll(/([^{}]+)\{/g)){
   const selector=m[1].trim();if(selector.startsWith('@')||/^(?:from|to|[\d.%]+)$/.test(selector))continue;
   assert.doesNotMatch(selector,/[\[\]#]|(?:^|[\s>,+~])(?:button|input|text|view)\b/,name+': '+selector);
  }
 }
});
test('禁用样式类与原生disabled使用完全相同的条件，原生功能不由CSS代替',()=>{
 for(const name of ['business-dialog','business-picker','invite-sheet'])for(const m of read(name,'wxml').matchAll(/<button\b[^>]+>/g)){
  const tag=m[0],disabled=tag.match(/disabled="{{(.*?)}}"/);
  if(name==='business-dialog')assert.match(tag,/class="dialog-control /);
  if(disabled)assert.ok(tag.includes(`{{(${disabled[1]})?'control-disabled':''}}`),tag);
 }
});
test('日历星期和空态装饰有显式类，不依赖标签选择器',()=>{
 assert.match(read('business-dialog','wxml'),/<text class="weekday" wx:for=/);
 assert.match(read('page-state','wxml'),/class="empty-line"/);
 assert.match(read('page-state','wxml'),/class="empty-line empty-line-short"/);
});
test('组件控件采用44px触控高度，日历保持七列不向小屏横向溢出',()=>{
 assert.match(read('business-picker','wxss'),/\.trigger\{min-height:44px\}/);
 const css=read('business-dialog','wxss');
 assert.match(css,/\.calendar-grid \.day\{height:44px;min-height:44px;max-height:44px;line-height:44px\}/);
 assert.match(css,/\.nav-step\{flex:0 0 44px;width:44px;min-width:44px;max-width:44px/);
 assert.match(css,/width:calc\(14\.285714% - 8rpx\)/);
 assert.match(css,/\.dialog\.selector-dialog \.picker-panel \.option-list \.option\{min-height:44px\}/);
});
