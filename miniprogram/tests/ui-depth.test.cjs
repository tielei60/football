// CSS/契约检查不等于设备视觉、原生输入或屏幕阅读器验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const baseline = require('./ui-depth-baseline.json');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
test('十个业务页及四公共组件保留全部模板、文本、条件、事件和业务代码',()=>{
  for (const [p,sha] of Object.entries(baseline.immutable))
    assert.equal(crypto.createHash('sha256').update(read(p)).digest('hex'),sha,p);
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
  const expected={home:['.hero .title','.match-title','.match-time'],schedule:['.page>.between .title','.card .match-name','.card .muted.match-time'],players:['.players-title','.player-name','.list-heading-title'],statistics:['.page>.title','.section-title'],me:['.card.row .title','.section-title, .account-heading']};
  for(const [page,selectors] of Object.entries(expected))for(const selector of selectors){
    const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    assert.match(read(`pages/${page}/index.wxss`),new RegExp(escaped+'\\s*\\{[^}]*font-size:\\s*var\\(--type-'));
  }
  const app=read('app.wxss');
  assert.match(app,/--space-1: 8rpx/);
  assert.match(app,/--type-body:14px/);
  assert.match(app,/input\.input\{height:88rpx;min-height:88rpx;padding:0 24rpx;line-height:42rpx\}/);
  assert.match(read('components/business-picker/index.wxss'),/overflow:visible/);
  assert.match(read('components/business-dialog/index.wxss'),/height:64rpx;min-height:64rpx;max-height:64rpx/);
});
test('十页保留非文字布局；仅三项明确视觉色及副标题间距变化',()=>{
  for(const [page,expected]of Object.entries(baseline.geometry)){
    const result=[];
    for(const [,selector,body] of read(`pages/${page}/index.wxss`).replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      const props={};
      for(const [,k,v]of body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g))if(!['font-size','font-weight','line-height','color','letter-spacing'].includes(k))props[k]=v.trim();
      if(Object.keys(props).length)result.push([selector.trim().replace(/\s+/g,' '),props]);
    }
    const allowed=structuredClone(expected);
    if(page==='match-media')allowed.find(([s])=>s==='.photo')[1].background='var(--canvas)';
    if(page==='player-ai'){
      const warning=allowed.find(([s])=>s==='.ai-warning')[1];
      warning.background='var(--warning-soft)';
      allowed.find(([s])=>s==='.ai-adopted')[1]['border-left']='6rpx solid var(--success)';
      allowed.push(['.subtitle',{'margin-top':'8rpx'}]);
    }
    assert.deepEqual(result,allowed,page);
  }
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
    assert.equal(result.name,'rgb(41, 36, 49)');
    assert.equal(result.month,'rgb(109, 99, 117)');
    assert.ok(result.title>result.meta&&result.title>=18);
    assert.ok(result.time>=14);
    assert.ok(result.left>=0&&result.right<=width&&!result.overflow);
    await page.close();
  }}finally{await browser.close();}
});
