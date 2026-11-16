// 标签检查不代替键盘/光标或画布真实手势验证。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=(page,ext='wxml')=>fs.readFileSync(path.join(__dirname,'../pages',page,'index.'+ext),'utf8');
test('阶段标题始终有可见标签，保留原输入绑定和专注隐藏',()=>{
 const s=read('tactic-compose');
 assert.match(s,/<view wx:if="{{!focusCanvas}}" class="stage-fields"><view class="grow stage-title-field"><text class="editor-field-label">阶段标题<\/text><input disabled="{{loading}}" id="stage-title" class="grow" value="{{stageTitle}}" maxlength="60" data-key="stageTitle" bindinput="input" placeholder="阶段标题"\/><\/view>/);
 assert.match(read('tactic-compose','wxss'),/\.stage-title-field input\s*{[^}]*width:100%[^}]*min-height:44px/);
});
test('标注内容有独立可见标签，保留属性输入约束和事件',()=>{
 const s=read('tactic-board');
 assert.match(s,/<text class="editor-field-label">文字标注内容<\/text><input disabled="{{loading}}" id="editor-label" maxlength="1000" value="{{label}}" data-key="label" bindinput="property" placeholder="文字标注内容"\/>/);
 for(const p of ['tactic-board','tactic-compose'])assert.match(read(p,'wxss'),/\.editor-field-label\s*{[^}]*display:block[^}]*font-size:var\(--type-field\)/);
});
