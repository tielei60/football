// CSS合并验证，不冒充原生输入焦点或真机键盘验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('V3 表单输入与选择框三档至少44 CSS px且不溢出',async()=>{
 const {chromium}=require('../../app/node_modules/playwright');
 const browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430]){
  const page=await browser.newPage({viewport:{width,height:900}});
  const css=fs.readFileSync(path.join(root,'app.wxss'),'utf8').replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
  await page.setContent('<style>body{margin:0}'+css+'</style><div class="page"><input class="input" value="非敏感测试文字"><div class="picker">选择位置</div><div class="filter-row"><div class="picker">全部位置</div></div></div>');
  const sizes=await page.locator('.input,.picker').evaluateAll(xs=>xs.map(x=>{const r=x.getBoundingClientRect();return{x:r.x,width:r.width,height:r.height}}));
  for(const r of sizes){assert.ok(r.height>=44,`${width}: ${r.height}`);assert.ok(r.x>=0&&r.x+r.width<=width,`${width}: overflow`)}
  await page.close();
 }}finally{await browser.close()}
});
