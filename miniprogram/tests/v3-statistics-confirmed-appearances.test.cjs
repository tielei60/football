const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('统计只澄清确认出场标签，保留未知指标与待确认数据',()=>{
 const w=read('pages/statistics/index.wxml');
 assert.match(w,/<text class="confirmed-appearances">确认出场<\/text>/);
 assert.match(w,/metric==='assists'\?'助攻':'确认出场'/);
 assert.match(w,/已记录 {{item.coverage}} 场 · 确认出场 {{item.appearances}} 场/);
 assert.match(w,/出场待确认 {{item.unknownAppearances}} 场/);
 assert.match(w,/<text>{{item.goalsLabel}}<\/text><text>{{item.assistsLabel}}<\/text><text class="confirmed-appearances">{{item.appearances}}<\/text>/);
 assert.match(w,/榜单展示已记录的数据，不代表缺失记录为零/);
 let controller;vm.runInNewContext(read('pages/statistics/index.js'),{Page:x=>controller=x,require:()=>({value:v=>v==null?'—':String(v)}),Date});
 const input=[{playerId:'unknown',name:'待核实成员',goals:null,assists:null,appearances:0,unknownAppearances:1,goalsKnownMatches:0,assistsKnownMatches:0},{playerId:'known',name:'已核实成员',goals:0,assists:0,appearances:1,unknownAppearances:0,goalsKnownMatches:1,assistsKnownMatches:1}];
 const before=JSON.stringify(input);
 for(const metric of ['overall','goals','assists','appearances']){const rows=controller.rank(input,metric),u=rows.find(x=>x.playerId==='unknown');assert.equal(rows[0].playerId,'known');assert.equal(u.appearances,0);assert.equal(u.unknownAppearances,1);assert.equal(u.goalsLabel,'—');assert.equal(u.assistsLabel,'—');if(metric==='appearances')assert.equal(u.value,'0');}
 assert.equal(JSON.stringify(input),before);
});
test('确认出场表头与数字三宽对齐，四字不溢出且长名仍有空间',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430]){
 const page=await browser.newPage({viewport:{width,height:900}});
 const css=(read('app.wxss')+'\n'+read('pages/statistics/index.wxss')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
 await page.setContent('<style>body{margin:0}text{display:block}'+css+'</style><div class="page statistics-page"><div class="card ranking-card"><div class="ranking-header"><text class="ranking-header-name">球员</text><text>进球</text><text>助攻</text><text class="confirmed-appearances">确认出场</text></div><div class="rank-row row"><text class="rank">1</text><div class="avatar rank-avatar">球</div><div class="grow"><div class="bold">长姓名测试成员</div></div><div class="ranking-values"><text>—</text><text>—</text><text class="confirmed-appearances">0</text></div></div><div class="ranking-header ranking-header-single"><text class="ranking-header-name">球员</text><text>确认出场</text></div></div></div>');
 const rect=async s=>page.locator(s).evaluate(x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scroll:x.scrollWidth,client:x.clientWidth}});
 const h=await rect('.ranking-header:not(.ranking-header-single) .confirmed-appearances'),v=await rect('.ranking-values .confirmed-appearances'),name=await rect('.rank-row .grow'),single=await rect('.ranking-header-single>text:last-child');
 assert.ok(h.width>=56&&Math.abs(h.width-v.width)<.2,`${width}:同列宽`);assert.ok(Math.abs(h.right-v.right)<1,`${width}:右边对齐`);assert.ok(h.scroll<=h.client+1&&single.scroll<=single.client+1,`${width}:表头完整`);assert.ok(name.width>=40,`${width}:姓名空间`);assert.ok(v.right<=width,`${width}:数字不超屏`);await page.close();
 }}finally{await browser.close()}
});
