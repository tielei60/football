// 首页截图反馈的模板契约与 Chromium 三宽布局回归，不代替微信原生验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const w=fs.readFileSync(path.join(root,'pages/home/index.wxml'),'utf8');
const css=fs.readFileSync(path.join(root,'pages/home/index.wxss'),'utf8');
test('下一场保留真实字段、整卡入口和未知状态，图标仅作装饰',()=>{
 for(const key of ['next.id','next.competition','next.format','team.crest','team.name','next.side','next.opponent','next.dateLabel','next.kickoff','next.location','next.signupCountLabel','next.maybeCount','next.noCount','next.responseLabel'])assert.ok(w.includes(key),key);
 for(const text of ['主客场待定','地点待定','时间待定','赛制待定'])assert.ok(w.includes(text));
 assert.equal((w.match(/bindtap="openMatch"/g)||[]).length,2);
 assert.equal((w.match(/bindtap="schedule"/g)||[]).length,2);
 for(const icon of ['calendar','pin','people'])assert.match(w,new RegExp('ui-v3-'+icon+'\\.png" mode="aspectFit" aria-hidden="true"'));
 assert.match(css,/\.page\{padding-top:28rpx\}/);
 assert.match(css,/\.fixture-info text\{[^}]*overflow-wrap:anywhere/);
});
test('下一场三宽真实长文本不截断、不溢出，CTA不低于44px',async()=>{
 const {chromium}=require('../../app/node_modules/playwright');
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 try{for(const width of [320,375,430]){
 let html=w.slice(w.indexOf('<view class="section next-section">'),w.indexOf('<view wx:else class="card home-no-next">'));
 html=html.replace(/{{([^}]+)}}/g,(_,k)=>k.includes('location')?'真实球场详细地址城市区域体育中心内柔道训练馆西侧及长道路门牌信息'.repeat(3):k.includes('name')||k.includes('opponent')?'很长的足球俱乐部球队全称':k.includes('competition')?'周中朋友联赛特别场次':k.includes('side')?'主客场待定':k.includes('dateLabel')?'11月18日 周三':k.includes('kickoff')?'20:00':k.includes('responseLabel')?'未回应':'9');
 html=html.replace(/<view\b([^>]*?)\/\s*>/g,'<view$1></view>');
 html=html.replace(/<image\b[^>]*\/>/g,'<img alt=""/>').replace(/<view\b/g,'<div').replace(/<\/view\s*>/g,'</div>').replace(/<text\b/g,'<span').replace(/<\/text\s*>/g,'</span>');
 const styles=(fs.readFileSync(path.join(root,'app.wxss'),'utf8')+'\n'+css).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/\bimage\b/g,'img').replace(/\btext\b(?=\s*[{+])/g,'span').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
 const page=await browser.newPage({viewport:{width,height:1200}});
 await page.setContent('<style>body{margin:0}'+styles+'</style><div class="page">'+html+'</div>');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
 assert.equal(await page.locator('.fixture-teams > .fixture-team').count(),2);
 assert.equal(await page.locator('.next > .fixture-info').count(),2);
 assert.equal(await page.locator('.fixture-info').count(),2);
 const info=page.locator('.fixture-info > span');assert.equal(await info.count(),2);
 const data=await info.evaluateAll(xs=>xs.map(x=>({h:x.clientHeight,sh:x.scrollHeight,overflow:getComputedStyle(x).overflow,clamp:getComputedStyle(x).webkitLineClamp})));
 for(const x of data){assert.ok(x.sh<=x.h+1);assert.notEqual(x.overflow,'hidden');assert.ok(x.clamp==='none'||x.clamp==='');}
 assert.ok((await page.locator('.fixture-cta').boundingBox()).height>=44);
 await page.close();
 }}finally{await browser.close();}
});

test('标题装饰在独立非负背景层，文字层始终在其上方',()=>{
 assert.match(w, /class="fixture-heading-title"><text class="fixture-heading-label">下一场比赛<\/text><\/text>/);
 assert.match(css,/\.fixture-heading-title\{position:relative;z-index:0;/);
 assert.match(css,/\.fixture-heading-label\{position:relative;z-index:1\}/);
 const decoration=css.match(/\.fixture-heading-title::after\{([^}]+)\}/)[1];
 assert.match(decoration,/z-index:0;/);assert.match(decoration,/pointer-events:none/);
 assert.doesNotMatch(decoration,/z-index:\s*-|clip-path/);
});
