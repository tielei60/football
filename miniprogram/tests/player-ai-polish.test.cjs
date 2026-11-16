const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const w = fs.readFileSync(path.join(__dirname, '../pages/player-ai/index.wxml'),'utf8');
function disabled(id,data) {
  const tag=w.match(new RegExp('<button[^>]*id="'+id+'"[^>]*>'))[0];
  const expression=tag.match(/disabled="{{(.*?)}}"/)[1];
  return !!vm.runInNewContext(expression,data);
}
test('准备禁用依据实际选择状态而非预览路径；未知请求恢复按钮独立',()=>{
  const state={busy:false,pending:false,sourceReady:false,styles:[{}],samples:[{}],uploadMode:'file',hasSelectedImage:false};
  assert.equal(disabled('ai-prepare',state),true);
  assert.equal(disabled('ai-prepare',{...state,hasSelectedImage:true,preview:'',setupLocked:true}),false);
  assert.equal(disabled('ai-prepare',{...state,uploadMode:'sample'}),false);
  assert.equal(disabled('ai-prepare',{...state,uploadMode:'sample',samples:[]}),true);
  assert.equal(disabled('ai-recover',{busy:false,pending:true}),false);
});
test('本地模拟、明确采用与失败反馈保持独立，候选完整显示',()=>{
  assert.match(w,/本地模拟，不是真实 AI 生成/);
  assert.match(w,/预览不会自动采用/);
  assert.match(w,/binderror="candidateError"/);
  assert.match(w,/!!adopted\|\|!item.src\|\|item.imageError/);
  assert.match(w,/wx:if="{{successMessage}}" class="ai-complete"/);
  assert.match(w,/wx:if="{{actionError}}" class="error"/);
  assert.match(w,/mode="aspectFit" data-id/);
  assert.doesNotMatch(w,/mode="aspectFill"/);
});
