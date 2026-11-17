const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../pages/match-detail'),w=fs.readFileSync(path.join(root,'index.wxml'),'utf8'),css=fs.readFileSync(path.join(root,'index.wxss'),'utf8');
test('管理员两个操作位于资料卡内媒体入口前且保留原权限事件',()=>{
 const start=w.indexOf('class="match-facts"'),actions=w.indexOf('wx:if="{{admin}}" class="match-management"'),media=w.indexOf('bindtap="media"'),cover=w.indexOf('class="match-cover"');
 assert.ok(start<actions&&actions<media&&media<cover);
 for(const action of ['edit','rosterEdit'])assert.equal((w.match(new RegExp('bindtap="'+action+'"','g'))||[]).length,1);
 assert.match(css,/match-management-button[^}]*min-height:44px[^}]*border:2rpx solid var\(--control-border\)/);
});
test('取消比赛仅显示警告解释，不改变报名权限和恢复入口',()=>{
 assert.ok(w.includes('wx:if="{{match.status===\'cancelled\'}}" class="match-cancelled-notice"'));
 assert.ok(w.indexOf('class="match-cancelled-notice"')<w.indexOf('class="content-section attendance-section"'));
 assert.ok(w.includes('本场比赛已取消，无法更改报名。'));
 assert.ok(w.includes('wx:if="{{canReply}}" class="fixed-actions"'));
 assert.match(css,/match-cancelled-notice\{[^}]*background:var\(--warning-soft\)/);
});
test('管理员操作仍按loading禁用且禁用视觉不被描边样式覆盖',()=>{
 for(const action of ['edit','rosterEdit']){
  const button=[...w.matchAll(/<button\b[^>]*>/g)].map(x=>x[0]).find(x=>x.includes(`bindtap="${action}"`));
  assert.ok(button.includes('disabled="{{loading}}"'));
 }
 assert.match(css,/\.page \.match-facts button\.match-management-button\[size="mini"\]\[disabled\]\{opacity:\.5\}/);
});
test('三宽管理按钮真实级联保留禁用视觉和操作尺寸',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const styles=(fs.readFileSync(path.join(__dirname,'../app.wxss'),'utf8')+'\n'+css).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
  await page.setContent('<style>'+styles+'</style><div class="page"><div class="match-facts"><div class="match-management"><button class="ui-button match-management-button" size="mini">编辑比赛</button><button class="ui-button match-management-button" size="mini" disabled>管理名单</button></div></div></div>');
  const values=await page.locator('button').evaluateAll(xs=>xs.map(x=>({opacity:getComputedStyle(x).opacity,h:x.getBoundingClientRect().height,w:x.getBoundingClientRect().width})));
  assert.equal(values[1].opacity,'0.5');assert.ok(values.every(x=>x.h>=44&&x.w>=44));assert.ok(Math.abs(values[0].w-values[1].w)<1);await page.close();
 }}finally{await browser.close();}
});
