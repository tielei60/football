// 本批静态/行为基线保护，不代替微信画面、拖动或真机验收。
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const baseline=require('./ui-depth-tactic-baseline.json');
const root=path.resolve(__dirname,'../pages');
const read=(page,ext)=>fs.readFileSync(path.join(root,page,'index.'+ext),'utf8');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const marker='\n/* 深度视觉层级：';
test('七个战术页保留当前全部业务代码、字段、事件和条件',()=>{
  assert.equal(Object.keys(baseline).length,7);
  for(const [page,b] of Object.entries(baseline)) {
    assert.equal(hash(read(page,'js')),b.js,page+' JS');
    assert.equal(hash(read(page,'wxml').replace(/\sclass="[^"]*"/g,'')),b.wxml,page+' WXML');
  }
});
test('战术页新规则仅调整文字表现，既有控件和球场几何逐字节保持',()=>{
  for(const [page,b] of Object.entries(baseline)) {
    const css=read(page,'wxss'),at=css.indexOf(marker);
    assert.ok(at>=0,page);
    assert.equal(hash(css.slice(0,at)),b.css,page+' original CSS');
    const extra=css.slice(at);
    for(const rule of extra.matchAll(/\{([^{}]*)\}/g))
      for(const declaration of rule[1].split(';').filter(Boolean))
        assert.match(declaration.trim(),/^(font-size|font-weight|color|line-height):/,page);
    assert.doesNotMatch(extra,/\b(input|textarea|canvas|slider|button)\b/,page);
  }
});
test('专注编辑与放大预览不套用非专注阅读字号',()=>{
  for(const page of ['tactic-board','tactic-compose','tactic-setup']) {
    const extra=read(page,'wxss').split(marker)[1].split('*/').slice(1).join('*/');
    for(const rule of extra.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      const selector=rule[1].trim(); if(selector.startsWith('@'))continue;
      for(const part of selector.split(',')) assert.ok(part.trim().startsWith('.type-expanded '),page+': '+part);
    }
  }
});
test('战术警告、文件就绪、创建错误维持明确语义和字号层级',()=>{
  assert.match(read('tactic-transfer','wxss').split(marker)[1],/\.warning\{[^}]*var\(--warning/);
  assert.match(read('tactic-export','wxss').split(marker)[1],/\.export-ready\{[^}]*var\(--success/);
  assert.match(read('tactic-create','wxml'),/wx:if="\{\{actionError\}\}" class="hint feedback feedback-error"/);
  assert.match(read('tactic-create','wxss').split(marker)[1],/\.feedback-error\{color:var\(--danger\)\}/);
  for(const page of Object.keys(baseline)) assert.match(read(page,'wxss').split(marker)[1],/var\(--type-/);
});
