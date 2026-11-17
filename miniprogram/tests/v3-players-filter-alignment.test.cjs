const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('球员搜索及位置筛选三宽外边框等高，输入和清除触控可用',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430])for(const clear of [false,true]){
 const page=await browser.newPage({viewport:{width,height:900}});
 const componentCss=read('components/business-picker/index.wxss').replace(/:host/g,'.position-filter').replace(/(^|})\s*(\.trigger[^{}]*)\{/g,(_,end,selector)=>end+' .position-filter '+selector+'{');
 const css=(read('app.wxss')+'\n'+read('pages/players/index.wxss')+'\n'+componentCss).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
 await page.setContent('<style>body{margin:0}button{width:100%}'+css+'</style><div class="page players-page"><div class="player-filters"><div class="player-search"><div class="search-icon"></div><input class="search-input" placeholder="搜索姓名或号码">'+(clear?'<button class="ui-button search-clear" size="mini">×</button>':'')+'</div><business-picker class="position-filter"><button class="trigger"><div class="picker position-picker"><span class="picker-value">全部位置</span></div></button></business-picker></div></div>');
 const rect=async s=>page.locator(s).evaluate(x=>{const r=x.getBoundingClientRect();return {height:r.height,top:r.top,bottom:r.bottom,width:r.width}});
 const search=await rect('.player-search'),picker=await rect('.position-picker'),input=await rect('input');
 assert.ok(Math.abs(search.height-picker.height)<.1,`${width}/${clear}:边框高度`);assert.ok(Math.abs(search.bottom-picker.bottom)<.1);assert.ok(search.height>=44&&picker.height>=44&&input.height>=44&&input.width>44);
 if(clear){const b=await rect('.search-clear');assert.ok(b.height>=44&&b.width>=44)}
 await page.locator('input').fill('姓名测试');assert.equal(await page.locator('input').inputValue(),'姓名测试');await page.close();
 }}finally{await browser.close()}
});
