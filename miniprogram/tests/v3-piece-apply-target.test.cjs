// 浏览器级联补充原生测量，不代替设备操作验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('仅应用属性按钮补44px下限，三宽保持原宽度和不缩小自然高度',async()=>{
 const css=read('pages/tactic-compose/index.wxss'),patch='.page #piece-apply{min-height:44px}';assert.equal(css.split(patch).length,2);
 const wxml=read('pages/tactic-compose/index.wxml');assert.ok(wxml.includes('<button id="piece-apply" class="primary" bindtap="applyPlayer" disabled="{{loading || (busy||conflict)}}">应用属性</button>'));
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430]){const page=await browser.newPage({viewport:{width,height:900}}),render=async source=>{const style=(read('app.wxss')+'\n'+source).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px');await page.setContent('<style>body{margin:0}'+style+'</style><div class="page type-expanded"><div class="card properties-card"><button id="piece-apply" class="primary">应用属性</button></div></div>');return page.locator('#piece-apply').evaluate(x=>{const r=x.getBoundingClientRect();return {w:r.width,h:r.height,min:getComputedStyle(x).minHeight,left:r.left,right:r.right}})};
 const before=await render(css.replace(patch,'')),after=await render(css);assert.equal(after.min,'44px');assert.ok(after.h>=44&&after.h>=before.h,JSON.stringify({width,before,after}));assert.equal(after.w,before.w);assert.equal(after.left,before.left);assert.ok(after.right<=width+1);await page.close();}}
 finally{await browser.close();}
});
