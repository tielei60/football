// V3 13/15/32 静态契约及浏览器等价排版；不代表微信原生与权限实测。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=(p,e='wxml')=>fs.readFileSync(path.join(root,'pages',p,'index.'+e),'utf8');
test('赛季规则和尾端箭头分区，球场具有独立列表标题',()=>{
 const s=read('manage-seasons'),v=read('manage-venues');
 assert.match(s,/class="hint season-rule">自定义起止周期，可跨年。比赛归属需单独选择。/);
 assert.match(s,/class="season-copy"><view class="bold">{{item.name}}<\/view><view class="muted">{{item.startDate}} 至 {{item.endDate}}<\/view><\/view><text class="season-chevron" aria-hidden="true">›/);
 assert.match(s,/wx:for="{{seasons}}" wx:key="id"[^>]*data-id="{{item.id}}" bindtap="edit"/);
 assert.match(v,/<block wx:if="{{!loading && !error}}"><view class="section-title venues-heading">常用球场/);
 assert.match(v,/{{item.status==='active'\?'可选':'已停用'}}/);
});
test('账号单一白卡包裹原循环，系统管理员只读和角色边界仍保留',()=>{
 const s=read('system-accounts');
 assert.match(s,/<view wx:if="{{accounts.length}}" class="card account-list">\s*<view wx:for="{{accounts}}" wx:key="id" class="account-row">/);
 for(const fragment of ['wx:if="{{authorized&&!item.systemAdmin}}"','wx:if="{{item.playerId}}"','wx:elif="{{item.systemAdmin}}"','disabled="{{busy||uncertain}}"','wx:if="{{!accounts.length&&authorized}}"','error===\'仅系统管理员可以管理账号。\'','open-type="switchTab" url="/pages/me/index"'])assert.ok(s.includes(fragment),fragment);
 assert.match(read('system-accounts','wxss'),/\.account-row\+\.account-row\{border-top:1px solid var\(--line\)/);
});
test('三宽长名称列表不横溢，赛季箭头尾端独立，账号操作命中至少44',async()=>{
 const {chromium}=require('../../app/node_modules/playwright');const browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430])for(const name of ['manage-seasons','manage-venues','system-accounts']){
  const page=await browser.newPage({viewport:{width,height:1000}});
  let w=read(name).replace(/{{item.name}}|{{item.username}}/g,'超长球队账号或赛季名称ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789').replace(/{{item.startDate}}/g,'2026-09-01').replace(/{{item.endDate}}/g,'2027-06-30').replace(/{{[\s\S]*?}}/g,'').replace(/<(\/?)view(?=[\s>])/g,'<$1div').replace(/<(\/?)text(?=[\s>])/g,'<$1span').replace(/<\/?block\b[^>]*>/g,'').replace(/<input([^>]*)\/>/g,'<input$1>').replace(/<image\b[^>]*\/>/g,'');
  const css=(fs.readFileSync(path.join(root,'app.wxss'),'utf8')+'\n'+read(name,'wxss')).replace(/([\d.]+)rpx/g,(_,v)=>Number(v)*width/750+'px').replace(/(^|})\s*page\s*{/g,'$1 body{');
  await page.setContent('<style>body{margin:0}'+css+'</style>'+w);
  const selector=name==='manage-seasons'?'.season-card':name==='manage-venues'?'.venues-heading':'.account-list';
  const b=await page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return{x:r.x,right:r.right,scroll:e.scrollWidth,client:e.clientWidth}});
  assert.ok(b.x>=0&&b.right<=width+.5&&b.scroll<=b.client+1,JSON.stringify({name,width,...b}));
  if(name==='manage-seasons'){const a=await page.locator('.season-chevron').boundingBox(),c=await page.locator('.season-copy').boundingBox();assert.ok(a.x>=c.x+c.width);}
  if(name==='system-accounts')for(const b of await page.locator('.account-actions button').all()){const r=await b.boundingBox();assert.ok(r.width>=44&&r.height>=44);}
  await page.close();
 }}finally{await browser.close()}
});
