// CSS/契约检查不等于设备视觉、原生输入或屏幕阅读器验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const baseline = require('./ui-v3-core-contract.json');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
test('V3 重设计保留原业务处理及模板事件、权限条件、提交禁用与对象标识',()=>{
  for (const [p,sha] of Object.entries(baseline.immutable))
    assert.equal(crypto.createHash('sha256').update(read(p)).digest('hex'),sha,p);
  for (const [p,attrs] of Object.entries(baseline.bindings))
    for(const attr of attrs) assert.ok(read(p).includes(attr),`${p}: ${attr}`);
});
function luminance(hex) {
  const c=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return .2126*c[0]+.7152*c[1]+.0722*c[2];
}
test('主题文字及语义状态在实际浅底满足4.5对比，完赛不强制成功绿',()=>{
  const app=read('app.wxss'),colors={};
  for(const [,key,hex] of app.matchAll(/--([\w-]+):\s*(#[a-f0-9]{6})/gi))colors[key]=hex;
  for(const [fg,bg] of [['ink','surface'],['muted','surface'],['muted','canvas'],['muted','brand-soft'],['muted','danger-soft'],['brand-ink','brand-soft'],['success','success-soft'],['warning','warning-soft'],['danger','danger-soft']]){
    const a=luminance(colors[fg]),b=luminance(colors[bg]);
    assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,`${fg}/${bg}`);
  }
  assert.doesNotMatch(app,/\.tag\.completed\s*\{[^}]*success/);
});
test('首页主题、下场时间与赛程对阵、排名、个人身份分别采用内容层级',()=>{
  const expected={home:['.hero .title','.match-title','.match-time'],schedule:['.card .match-name','.card .fixture-details .match-time'],players:['.players-title','.player-name','.list-heading-title'],statistics:['.page>.title','.section-title'],me:['.card.row .title','.section-title, .account-heading']};
  for(const [page,selectors] of Object.entries(expected))for(const selector of selectors){
    const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    assert.match(read(`pages/${page}/index.wxss`),new RegExp(escaped+'\\s*\\{[^}]*font-size:\\s*var\\(--type-'));
  }
  // 赛程依照 ZIP 以焦点赛事开场，不保留已删除的重复页面标题。
  const schedule=read('pages/schedule/index.wxss'),scheduleTemplate=read('pages/schedule/index.wxml');
  assert.match(scheduleTemplate,/^<view class="page schedule-page"><view[^>]*class="fixture-focus"/);
  assert.match(schedule,/\.focus-teams>view\{[^}]*font-size:28rpx;[^}]*font-weight:600/);
  assert.match(schedule,/\.focus-context\{[^}]*font-size:24rpx/);
  assert.match(schedule,/\.card \.fixture-details \.match-time\{[^}]*font-weight:400;[^}]*color:var\(--muted\)/);
  assert.match(schedule,/\.card \.match-name\s*\{[^}]*color:\s*var\(--ink\);[^}]*font-weight:\s*600/);
  const app=read('app.wxss');
  assert.match(app,/--space-1: 8rpx/);
  assert.match(app,/--type-body:14px/);
  assert.match(app,/input\.input\{height:88rpx;min-height:88rpx;padding:0 24rpx;line-height:42rpx\}/);
  assert.match(read('components/business-picker/index.wxss'),/overflow:visible/);
  assert.match(read('components/business-dialog/index.wxss'),/height:64rpx;min-height:64rpx;max-height:64rpx/);
});
test('V3 核心视觉结构存在，数据仍绑定接口结果而非设计示例',()=>{
  for(const [page,selector] of Object.entries({home:'club-home-hero',schedule:'fixture-focus',players:'squad-counts',statistics:'record-card',me:'membership-hero','match-detail':'match-brand-hero','player-detail':'profile-sheet'})) {
    assert.ok(read(`pages/${page}/index.wxml`).includes(selector),page);
    assert.doesNotMatch(read(`pages/${page}/index.wxml`),/林远|周泽|绿茵联队|11月22日/);
  }
  assert.match(read('pages/players/index.js'),/activeCount: players\.filter\(p => p\.membershipConfirmed !== false && p\.status === "active"\)/);
  assert.match(read('pages/players/index.js'),/unconfirmedCount: players\.filter\(p => p\.membershipConfirmed === false\)/);
  assert.match(read('pages/me/index.wxml'),/player && player\.number!==null && player\.number!==undefined/);
  assert.match(read('pages/statistics/index.wxml'),/stats\.team\.matches - stats\.team\.scoredMatches/);
});
test('合并CSS在320/375/430保持对手主色与标题层级；非微信实测',async t=>{
  let chromium;
  try{({chromium}=require('../../app/node_modules/playwright'));}catch(e){if(process.env.CI)throw e;t.skip('缺少布局测试依赖');return;}
  let browser;
  try{browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});}catch(e){if(process.env.CI||!/Executable doesn't exist/.test(e.message))throw e;t.skip('缺少Chromium，不代表微信视觉通过');return;}
  try{for(const width of [320,375,430]){
    const page=await browser.newPage({viewport:{width,height:900}});
    const css=(read('app.wxss')+'\n'+read('pages/schedule/index.wxss')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|[{}])\s*page\s*\{/g,'$1 body{');
    await page.setContent('<style>body{margin:0}'+css+'</style><div class="page"><div class="between"><div><div class="title">球队赛程</div><div class="subtitle">匿名长标题与状态测试</div></div></div><div class="section-title">某月赛程</div><div class="card"><div class="section-title break match-name">匿名测试对手长名称 Anonymous Football Club</div><div class="muted match-time">周六 19:30</div><div class="muted">匿名球场</div></div></div>');
    const result=await page.evaluate(()=>{const style=s=>getComputedStyle(document.querySelector(s));const r=document.querySelector('.match-name').getBoundingClientRect();return{title:parseFloat(style('.title').fontSize),meta:parseFloat(style('.subtitle').fontSize),name:style('.match-name').color,month:style('.page>.section-title').color,time:parseFloat(style('.match-time').fontSize),left:r.left,right:r.right,overflow:document.documentElement.scrollWidth>innerWidth};});
    assert.equal(result.name,'rgb(36, 24, 47)');
    assert.equal(result.month,'rgb(97, 4, 111)');
    assert.ok(result.title>result.meta&&result.title>=18);
    assert.ok(result.time>=14);
    assert.ok(result.left>=0&&result.right<=width&&!result.overflow);
    await page.close();
  }}finally{await browser.close();}
});
