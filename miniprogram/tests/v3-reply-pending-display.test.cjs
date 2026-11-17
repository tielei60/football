const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../pages/match-detail'),w=fs.readFileSync(path.join(root,'index.wxml'),'utf8'),css=fs.readFileSync(path.join(root,'index.wxss'),'utf8');
test('待核对正常正文位于比赛卡之后报名情况之前，错误加载时仍有恢复入口',()=>{
 const fallback=w.indexOf('wx:if="{{replyPending && (loading || error || !match)}}"'),body=w.indexOf('<block wx:if="{{!loading && !error && match}}">'),normal=w.indexOf('<view wx:if="{{replyPending}}"');
 assert.ok(fallback>=0&&fallback<body&&normal>body);assert.ok(normal>w.indexOf('class="match-sheet"'));assert.ok(normal<w.indexOf('class="content-section attendance-section"'));
 assert.equal((w.match(/id="reply-reconcile"/g)||[]).length,2);
 assert.equal((w.match(/wx:if="{{!busy && !reconciling}}" id="reply-reconcile"[^>]*bindtap="refresh"/g)||[]).length,2);
});
test('三种报名选择均在提交或未知结果核对中禁用，恢复路径保留原事件',()=>{
 const buttons=[...w.matchAll(/<button\b[^>]*bindtap="reply"[^>]*>/g)].map(x=>x[0]);assert.equal(buttons.length,3);
 for(const b of buttons)assert.ok(b.includes('disabled="{{loading || busy || replyPending || reconciling}}"'));
 for(const state of ['yes','maybe','no'])assert.ok(buttons.some(b=>b.includes(`data-response="${state}"`)));
 assert.ok(w.includes("replyPending ? (busy ? '正在提交' : reconciling ? '正在核对' : '结果待核对')"));
});
test('警告标题和原提交核对提示共存，警告色与描边核对操作保留',()=>{
 assert.ok(w.includes("busy?'正在提交报名…':reconciling?'正在核对上次报名，请稍候…':'上次报名结果待核对。'"));assert.ok(w.includes('reply-pending-title'));
 assert.match(css,/reply-pending.card\{[^}]*background:var\(--warning-soft\)/);assert.match(css,/reply-reconcile-button[^}]*min-height:44px/);
});
test('320/375/430真实级联禁用选中态变灰且保留原选择勾选语义',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const styles=(fs.readFileSync(path.join(__dirname,'../app.wxss'),'utf8')+'\n'+css).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
  await page.setContent('<style>'+styles+'</style><div class="page"><div class="fixed-actions"><div class="actions reply-options"><button class="primary ui-button reply-button" size="mini" disabled><span class="reply-check">✓</span>参加</button><button class="ui-button reply-button" size="mini" disabled>待定</button><button class="ui-button reply-button" size="mini" disabled>请假</button></div></div></div>');
  const values=await page.locator('button').evaluateAll(xs=>xs.map(x=>({bg:getComputedStyle(x).backgroundColor,img:getComputedStyle(x).backgroundImage,color:getComputedStyle(x).color,h:x.getBoundingClientRect().height})));
  for(const v of values){assert.equal(v.bg,'rgb(233, 227, 239)');assert.equal(v.img,'none');assert.equal(v.color,'rgb(149, 137, 159)');assert.ok(v.h>=44);}
  assert.equal(await page.locator('.primary .reply-check').textContent(),'✓');await page.close();
 }}finally{await browser.close();}
});
