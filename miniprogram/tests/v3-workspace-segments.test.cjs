const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('22 工作区仅替换原选择器，薄入口与其他下拉/保存事件明确保留',()=>{
 const w=read('pages/tactic-compose/index.wxml'),js=read('pages/tactic-compose/index.js'),contract=require('./tactic-workspace-contract.cjs');
 assert.ok(w.includes(contract.segmented));assert.match(w, /wx:for="{{tabs}}" wx:key="\*this"/);assert.ok(js.includes(contract.adapter));assert.doesNotMatch(w,/<business-picker title="编辑内容"/);
 for(const id of ['stage-picker','stage-duration','compose-tool','curve-piece','piece-target','piece-picker','piece-position'])assert.ok(new RegExp('<business-picker[^>]*id="'+id+'"').test(w),id);
 assert.match(w,/id="compose-save"[^>]*bindtap="save"/);assert.match(w,/id="compose-undo"[^>]*bindtap="undo"/);
});
test('22 分段在两种显示模式三档宽度44px且完整不溢出',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});const failures=[];
 try{for(const width of [320,375,430])for(const mode of ['type-expanded','canvas-focus']){
  const page=await browser.newPage({viewport:{width,height:900}});
  const source=read('pages/tactic-compose/index.wxml'),fragment=source.slice(source.indexOf('<view class="compose-workspace">'),source.indexOf('<view wx:if="{{actionError}}"'));
  let html=fragment.replace(/<button wx:for="{{tabs}}"[\s\S]*?<\/button>/,()=>['阶段编排','球员属性'].map((text,i)=>'<button class="workspace-segment '+(i===0?'is-active':'')+'">'+text+'</button>').join('')).replace(/{{[\s\S]*?}}/g,'').replace(/<(\/?)view(?=[\s>])/g,'<$1div').replace(/<(\/?)text(?=[\s>])/g,'<$1span');
  const css=(read('app.wxss')+'\n'+read('pages/tactic-compose/index.wxss')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|})\s*page\s*{/g,'$1 body{');
  await page.setContent('<style>body{margin:0}'+css+'</style><div class="page '+mode+'">'+html+'</div>');
  const boxes=await page.locator('.workspace-segment,#compose-save,#compose-undo').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,w:r.width,h:r.height,x:r.x,right:r.right}}));
  assert.equal(boxes.length,4);for(const b of boxes)if(b.w<44||b.h<44||b.x<0||b.right>width+.5)failures.push({width,mode,...b});await page.close();
 }}finally{await browser.close()}
 assert.deepEqual(failures,[]);
});
