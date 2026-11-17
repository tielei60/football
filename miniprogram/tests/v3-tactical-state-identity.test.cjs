// 展示契约及浏览器级联检查；不代表微信画布/业务保存验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'),board=read('pages/tactic-board/index.wxml'),compose=read('pages/tactic-compose/index.wxml'),exp=read('pages/tactic-export/index.wxml');
test('19/20 编辑摘要与独立只读标签使用既有权限和真实来源',()=>{
 assert.ok(board.includes('wx:if="{{editing}}" class="board-edit-summary"><text>{{format}} 人制 · {{formation}}</text><text class="tag">编辑中</text>'));
 assert.ok(board.includes('wx:if="{{!canEdit}}" class="tag board-readonly">只读'));
 assert.ok(board.includes('class="muted board-source">{{source}}'));
 for(const id of ['save-positions','edit-positions','export-tactic'])assert.equal((board.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
 assert.ok(board.includes('wx:if="{{!editing&&!focusCanvas&&(canExport||canEdit)}}"'));
});
test('21 专注仍展示唯一原阶段选择，画布绑定与原禁用守卫不变',()=>{
 const controls=board.slice(board.indexOf('<view wx:if="{{!editing}}" class="board-view-controls">'),board.indexOf('id="board-focus"'));
 assert.ok(controls.includes('bindchange="selectStage"'));assert.ok(!controls.includes('wx:if="{{!focusCanvas}}"'));
 assert.equal((board.match(/bindchange="selectStage"/g)||[]).length,1);
 assert.ok(controls.includes('disabled="{{loading || (editing||busy)}}"'));
 assert.ok(board.includes('wx:if="{{focusCanvas && !editing}}" class="board-focus-identity"'));
 assert.ok(board.includes('style="width:{{canvasWidth}}px;height:{{canvasHeight}}px"'));
 for(const handler of ['touchStart','touchMove','touchEnd','touchCancel'])assert.ok(board.includes('="'+handler+'"'));
});
test('22/23 编排标题分层，导出图按原始比例全宽展示且不增加权限',()=>{
 assert.ok(compose.includes('wx:if="{{!focusCanvas||tab!==0}}" class="compose-heading"><view class="title">动画与球员</view><view class="compose-source">{{title}} · 当前模板</view>'));
 assert.ok(exp.includes('wx:if="{{pngPath}}" class="preview" mode="widthFix" src="{{pngPath}}"'));
 const css=read('pages/tactic-export/index.wxss');assert.doesNotMatch(css,/height:600rpx|border-top:\s*4rpx/);assert.match(css,/\.preview\{display:block;width:100%;height:auto;box-sizing:border-box\}/);
});
test('320/375/430专注阶段工具无横向溢出且触点至少44px',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430]){const page=await browser.newPage({viewport:{width,height:900}});const css=(read('app.wxss')+'\n'+read('pages/tactic-board/index.wxss')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
 await page.setContent('<style>body{margin:0}text,business-picker{display:block}'+css+'</style><div class="page canvas-focus"><div class="board-focus-identity">只读视角 · 仅查看与播放</div><div class="board-view-controls"><text class="editor-field-label">查看阶段</text><div class="row board-stage-controls"><business-picker class="grow"><div class="picker"><text class="picker-value">阶段 2 · 中路直传与前锋斜插</text></div></business-picker></div><button class="focus-toggle">展开工具</button></div></div>');
 const rects=await page.locator('.board-view-controls,.board-stage-controls,.focus-toggle').evaluateAll(xs=>xs.map(x=>({left:x.getBoundingClientRect().left,right:x.getBoundingClientRect().right,h:x.getBoundingClientRect().height})));
 for(const r of rects){assert.ok(r.left>=0&&r.right<=width+1,JSON.stringify({width,r}));assert.ok(r.h>=44);}await page.close();}}
 finally{await browser.close();}
});
test('新增专注CSS仅限明确身份与工具选择器，不覆盖画布几何或隐藏控件',()=>{
 const section=read('pages/tactic-board/index.wxss').split('/* 状态 19–21：')[1];assert.ok(section);
 const allowed=new Set(['.board-title-row','.board-title-row .title','.board-readonly','.board-source','.board-edit-summary','.board-edit-summary>text:first-child','.board-edit-summary .tag','.board-focus-identity','.canvas-focus .board-view-controls','.canvas-focus .board-view-controls .editor-field-label','.canvas-focus .board-stage-controls','.canvas-focus .board-view-controls .focus-toggle']);
 const clean=section.slice(section.indexOf('*/')+2).replace(/@media\([^{}]+\)\{/g,'');
 for(const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
  for(const selector of m[1].split(','))assert.ok(allowed.has(selector.trim()),selector);
  assert.doesNotMatch(m[2],/(?:^|;)\s*(?:width|height|transform|position|top|left|right|bottom)\s*:|display\s*:\s*none/);
 }
});
