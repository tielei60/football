// v3 允许重组展示，不允许更改战术事件、权限、触点和持久化语义。
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const baseline=require('./ui-v3-tactic-contract.json');
const root=path.resolve(__dirname,'../pages');
const read=(page,ext)=>fs.readFileSync(path.join(root,page,'index.'+ext),'utf8');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const attributes=s=>Array.from(s.matchAll(/\s((?:(?:wx|bind|catch):?[\w-]+|(?:data-)[\w-]+|id|disabled|hidden|value|checked|range|range-key|maxlength|min|max|step|type|style|disable-scroll|scroll-x)="[^"]*")/g),m=>m[1]).sort();
test('v3 七个战术页业务代码和全部绑定条件保持不变',()=>{
 assert.equal(Object.keys(baseline).length,7);
 for(const [page,b] of Object.entries(baseline)) {
  assert.equal(hash(read(page,'js')),b.js,page+' JS');
  let markup=read(page,'wxml');
  if(page==='tactic-board') {
   // 仅剔除第五阶段新增展示包裹的条件；原控件条件仍冻结，
   // 新包裹对每个控件的有效条件由 v3-tactic-form-structure 的真值表检查。
   markup=markup.replace('<view wx:if="{{!editing}}" class="board-view-controls">','<view class="board-view-controls">')
    .replace('<block wx:if="{{!focusCanvas}}"><text class="editor-field-label">查看阶段','<block><text class="editor-field-label">查看阶段')
    .replace('<block wx:if="{{!focusCanvas}}"><button class="small" bindtap="zoom"','<block><button class="small" bindtap="zoom"');
  }
  const actual=attributes(markup).filter(x=>x!=='aria-hidden="true"');
  assert.deepEqual(actual,b.attrs,page+' events, values, permissions and pending conditions');
 }
});
test('v3 球场坐标、原生遮挡和专注几何保持原样',()=>{
 for(const [page,b] of Object.entries(baseline)) {
  assert.deepEqual(read(page,'wxml').match(/<canvas\b[^>]+>/g)||[],b.canvas,page);
  for(const rule of b.focusRules)assert.ok(read(page,'wxss').includes(rule),page+' focus geometry');
 }
});
test('v3 战术快捷操作位于球场后，危险与未知提示保持明确',()=>{
 const board=read('tactic-board','wxml');
 assert.ok(board.indexOf('class="board-shortcuts"')>board.indexOf('id="tactic-canvas"'));
 assert.match(read('tactic-transfer','wxss'),/\.warning\s*\{[^}]*var\(--warning\)/);
 assert.match(read('tactic-create','wxml'),/wx:if="\{\{actionError\}\}" class="hint feedback feedback-error"/);
 assert.match(read('tactic-create','wxss'),/\.feedback-error\s*\{[^}]*var\(--danger\)/);
});
