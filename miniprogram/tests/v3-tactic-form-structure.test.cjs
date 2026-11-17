// 静态结构和 Chromium 等价控件检查，不替代原生画布/键盘/滚动验证。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=(p,e)=>fs.readFileSync(path.join(root,'pages',p,'index.'+e),'utf8');
const originalJS={"tactic-board":"d3f340465ccfd03243b0148569583c8cac2d8c8ac213199c76a6914ec85d0cfc","tactic-compose": "cff607f9075388ca7622dba0521f4d8c148d36c343efbfba1fa9e82927cee9b2", "tactic-setup": "1140dc92f58f0d9aaae6e756210c9b65a3d3ece72e88f032e5bbe348d173c5bc"};
test('22/24 仅重排表单，保留全部原控制器和画布警告',()=>{
 for(const [page,hash]of Object.entries(originalJS))assert.equal(crypto.createHash('sha256').update(page==='tactic-compose'?require('./tactic-workspace-contract.cjs').restoreJS(read(page,'js')):read(page,'js')).digest('hex'),hash);
 const c=read('tactic-compose','wxml'),s=read('tactic-setup','wxml');
 assert.match(c,/stage-settings {{focusCanvas\?'':'card'}}/);assert.match(c,/class="row compose-actions"/);assert.match(c,/class="row stage-actions"/);assert.match(c,/class="stage-fields"/);
 for(const title of ['阶段标题','阶段时长','属性作用范围','选择球员'])assert.ok(c.includes('>'+title+'</text>'));
 for(const id of ['compose-tab','compose-undo','compose-save','stage-picker','compose-focus','stage-add','stage-delete','stage-title','stage-duration','stage-apply','compose-tool','curve-piece','curve-clear','compose-canvas','piece-target','piece-picker','piece-label','piece-number','piece-position','piece-apply'])assert.equal((c.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
 assert.match(c,/hidden="{{businessUiBlocking}}"/);assert.match(c,/width:{{canvasWidth}}px;height:{{canvasHeight}}px/);assert.match(c,/首阶段不计时/);assert.match(c,/不修改球队球员档案或历史比赛/);
 for(const title of ['比赛制式','阵容归属','阵型方案'])assert.ok(s.includes('>'+title+'</text>'));
 assert.match(s,/class="card metadata-card"/);assert.match(s,/class="card formation-card"/);
 assert.ok(s.indexOf('id="metadata-save"')<s.indexOf('class="card formation-card"'));
 assert.ok(s.indexOf('id="setup-focus"')>s.indexOf('id="formation-apply"'));
 assert.match(s,/hidden="{{businessUiBlocking}}"/);assert.match(s,/已有演示保持旧参与者与阶段/);assert.match(s,/保存不会修改历史比赛的战术快照/);
});
test('22/24 表单真实模板和级联在320/375/430下控件至少44且不横向溢出',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});const failures=[];
 try{for(const width of [320,375,430])for(const name of Object.keys(originalJS)){
  const page=await browser.newPage({viewport:{width,height:1000}});
  let source=read(name,'wxml');if(name==='tactic-board')source=source.slice(0,source.indexOf('<view wx:if="{{!editing && playDuration>0}}"'));
  let html=source.replace(/{{[\s\S]*?}}/g,'').replace(/class="page [^"]*"/,'class="page type-expanded"').replace(/class="stage-settings "/,'class="stage-settings card"').replace(/<(\/?)view(?=[\s>])/g,'<$1div').replace(/<(\/?)text(?=[\s>])/g,'<$1span').replace(/<input([^>]*)\/>/g,'<input$1>').replace(/<textarea([^>]*)\/>/g,'<textarea$1></textarea>').replace(/<canvas[\s\S]*?<\/canvas>/g,'').replace(/<\/?block\b[^>]*>/g,'');
  const css=(fs.readFileSync(path.join(root,'app.wxss'),'utf8')+'\n'+read(name,'wxss')).replace(/([\d.]+)rpx/g,(_,v)=>Number(v)*width/750+'px').replace(/(^|})\s*page\s*{/g,'$1 body{');
  await page.setContent('<style>body{margin:0}business-picker{display:block;min-width:0}'+css+'</style>'+html);
  const ids=name==='tactic-board'?['board-focus','.board-stage-controls .picker','button[bindtap="zoom"]']:name==='tactic-compose'?['stage-title','stage-duration','stage-apply','stage-picker','stage-add','stage-delete','compose-save','compose-undo']:['setup-title','setup-count','setup-team','setup-formation','metadata-save','formation-apply','setup-focus'];
  for(const id of ids){const r=await page.locator(id.startsWith('.')||id.startsWith('button[')?id:'#'+id).evaluate(e=>{let b=e.getBoundingClientRect();return {w:b.width,h:b.height,x:b.x,right:b.right}});if(r.w<44||r.h<44||r.x<0||r.right>width+.5)failures.push({name,width,id,...r});}
  await page.close();
 }}finally{await browser.close()}
 assert.deepEqual(failures,[]);
});

test('21 标题先于专注按钮，阶段专注可选、缩放仅非专注，编辑隐藏查看控件',()=>{
 const w=read('tactic-board','wxml');
 assert.ok(w.indexOf('class="title"')<w.indexOf('id="board-focus"'));
 assert.match(w,/<view wx:if="{{!editing}}" class="board-view-controls"><text class="editor-field-label">查看阶段/);
 assert.match(w,/<button wx:if="{{!editing}}" id="board-focus"[^>]*bindtap="toggleFocus"/);
 assert.match(w,/<block wx:if="{{!focusCanvas}}"><button class="small" bindtap="zoom"/);
 assert.match(w,/hidden="{{businessUiBlocking}}"/);assert.match(w,/width:{{canvasWidth}}px;height:{{canvasHeight}}px/);
});

test('21 查看控件四组合符合专注阶段可选且编辑禁用的设计',()=>{
 const source=read('tactic-board','wxml').split('<view wx:if="{{!editing && playDuration>0}}"')[0],stack=[],conditions={};
 for(const match of source.matchAll(/<\/?[\w-]+\b[^>]*>/g)){
  const tag=match[0];if(tag.startsWith('</')){stack.pop();continue;}
  const own=tag.match(/wx:if="{{([^}]+)}}"/)?.[1];
  const inherited=stack.flatMap(x=>x?[x]:[]);if(own)inherited.push(own);
  const handler=tag.match(/bind(?:tap|change)="(toggleFocus|selectStage|zoom)"/)?.[1];if(handler)conditions[handler]=inherited;
  if(!tag.endsWith('/>'))stack.push(own);
 }
 const vm=require('node:vm');
 for(const editing of [false,true])for(const focusCanvas of [false,true])for(const handler of ['toggleFocus','selectStage','zoom']){
  assert.ok(conditions[handler]);const actual=conditions[handler].every(c=>vm.runInNewContext(c,{editing,focusCanvas,loading:false,error:''}));
  assert.equal(actual,handler==='zoom'?!editing&&!focusCanvas:!editing,handler+': '+editing+'/'+focusCanvas);
 }
});
