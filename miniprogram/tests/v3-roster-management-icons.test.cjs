const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('03三类真实计数与05管理员入口保留，装饰图标均本机小PNG',()=>{
 const players=read('pages/players/index.wxml'),me=read('pages/me/index.wxml');
 for(const [field,icon]of [['activeCount','people'],['inactiveCount','trophy'],['unconfirmedCount','shield']]) assert.ok(players.includes('src="/assets/ui-v3-'+icon+'.png" mode="aspectFit" aria-hidden="true"/><text class="squad-count-number">{{'+field+'}}</text>'));
 for(const [field,title,icon]of [['team','球队资料','shield'],['players','球员与账号','people'],['seasons','赛季管理','calendar'],['venues','球场管理','pin']])assert.ok(me.includes('data-page="'+field+'" bindtap="manage" class="ui-button" size="mini"><image class="management-icon" src="/assets/ui-v3-'+icon+'.png" mode="aspectFit" aria-hidden="true"/><text>'+title+'</text>'));
 assert.match(me,/wx:if="{{session.user.role==='admin'}}"/);assert.match(me,/wx:if="{{session.user.systemAdmin}}" disabled="{{loading}}" bindtap="systemAccounts"/);
 assert.match(me,/aria-role="{{player\?'button':''}}" class="card row membership-hero" bindtap="profile"/);
 let total=0;for(const icon of ['people','trophy','shield','calendar','pin','lock']){const b=fs.readFileSync(path.join(root,'assets/ui-v3-'+icon+'.png'));assert.equal(b.subarray(1,4).toString(),'PNG');assert.equal(b.readUInt32BE(16),64);assert.equal(b.readUInt32BE(20),64);total+=b.length;}assert.ok(total<12000);
});
test('03统计与05管理图标三宽不溢出，管理按钮至少44px且保留两列',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430])for(const name of ['players','me']){
 const page=await browser.newPage({viewport:{width,height:900}});
 const css=(read('app.wxss')+'\n'+read('pages/'+name+'/index.wxss')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
 const html=name==='players'?'<div class="squad-counts">'+['在队球员','历史队员','状态待确认'].map(t=>'<view><img class="squad-count-icon"/><text class="squad-count-number">9999</text><text>'+t+'</text></view>').join('')+'</div>':'<div class="management-grid">'+['球队资料','球员与账号','赛季管理','球场管理','系统账号'].map(t=>'<button class="ui-button" size="mini"><img class="management-icon"/><text>'+t+'</text></button>').join('')+'</div>';
 await page.setContent('<style>body{margin:0}'+css+'</style><div class="page">'+html+'</div>');
 for(const box of await page.locator(name==='me'?'button':'.squad-counts>view').evaluateAll(xs=>xs.map(x=>({left:x.getBoundingClientRect().left,right:x.getBoundingClientRect().right,height:x.getBoundingClientRect().height,scroll:x.scrollWidth,client:x.clientWidth})))){assert.ok(box.left>=0&&box.right<=width+1);assert.ok(box.scroll<=box.client+1);if(name==='me')assert.ok(box.height>=44);}
 if(name==='me')assert.equal((await page.locator('.management-grid').evaluate(x=>getComputedStyle(x).gridTemplateColumns)).split(' ').length,2);
 await page.close();
 }}finally{await browser.close()}
});
