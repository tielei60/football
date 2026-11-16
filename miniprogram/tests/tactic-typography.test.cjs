// 展示规范检查不代替微信真机画布、键盘和逐页视觉验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../pages'),read=(n,e)=>fs.readFileSync(path.join(root,n,'index.'+e),'utf8');
test('v3 战术列表与导入导出使用独立品牌页头和内容层级',()=>{
 for(const n of ['tactics','tactic-create','tactic-transfer','tactic-export']) {
  assert.match(read(n,'wxml'),/tactical-header/);assert.match(read(n,'wxss'),/\.tactical-header/);
  assert.match(read(n,'wxss'),/44px/);
 }
 assert.match(read('tactics','wxml'),/pitch-symbol/);
 assert.match(read('tactic-transfer','wxml'),/step-number/);
});
test('专注状态保持独立，不继承非专注标题与表单装饰',()=>{
 assert.match(read('tactic-board','wxml'),/editing\|\|focusCanvas\?'canvas-focus':'type-expanded'/);
 assert.match(read('tactic-compose','wxml'),/focusCanvas&&tab===0\?'canvas-focus':'type-expanded'/);
 assert.match(read('tactic-setup','wxml'),/previewFocus\?'preview-focus':'type-expanded'/);
 for(const n of ['tactic-board','tactic-compose','tactic-setup']) {
  const extra=read(n,'wxss').split('/* UI v3：不改变球场尺寸、触点或专注模式布局。 */')[1];
  assert.ok(extra,n);
  for(const m of extra.matchAll(/([^{}]+)\{[^{}]*\}/g))for(const selector of m[1].split(','))assert.ok(selector.trim().startsWith('.type-expanded '),n+': '+selector);
 }
});
test('作用范围警告与临时文件完成提示仍然可辨',()=>{
 assert.match(read('tactic-compose','wxml'),/hint scope-warning/);
 assert.match(read('tactic-setup','wxml'),/hint formation-impact/);
 assert.match(read('tactic-export','wxml'),/hint export-ready/);
 assert.match(read('tactic-transfer','wxss'),/var\(--warning-soft\)/);
});
