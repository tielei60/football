const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('名单号码整体换行、位置选中层级、赛季辅助文字及参加语义保留',()=>{
 const css=read('pages/manage-players/index.wxss');
 assert.match(css,/\.managed-player-list \.player-number-note\{display:inline-block;max-width:100%/);
 assert.match(css,/word-break:keep-all;overflow-wrap:anywhere/);
 const player=read('pages/manage-player/index.wxss');
 assert.match(player,/flex:0 1 auto; width:auto; min-height:44px; min-width:44px/);
 assert.match(player,/font-weight:400; color:var\(--muted\)/);
 assert.match(player,/\.position-options button\.ui-button\.ui-compact\.selected\[size="mini"\] \{ font-weight:600/);
 assert.match(read('pages/manage-season/index.wxss'),/\.card \.hint \{ padding:0; border-radius:0; background:transparent/);
 const detail=read('pages/match-detail/index.wxml');
 assert.match(detail,/group.response==='yes'\?'reply-group-heading-yes':''/);
 assert.match(detail,/wx:if="{{!replies.length}}" class="section-empty"/);
 assert.match(read('pages/match-detail/index.wxss'),/\.match-facts \.fact-row\+\.fact-notice\{border-top:/);
});
test('三宽位置标签触控与选中层级、号码不孤字的等价级联验证',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430]){
 const page=await browser.newPage({viewport:{width,height:900}});
 const css=(read('app.wxss')+'\n'+read('pages/manage-player/index.wxss')+'\n'+read('pages/manage-players/index.wxss')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
 await page.setContent('<style>body{margin:0}button{width:100%}'+css+'</style><div class="page"><div class="card"><div class="position-options"><button size="mini" class="small ui-button ui-compact selected">中场</button><button size="mini" class="small ui-button ui-compact">前腰</button><button size="mini" class="small ui-button ui-compact">后卫</button></div></div><div class="managed-player-list"><div class="grow" style="width:155px"><div class="bold">匿名长姓名用于验证换行与账号标签对齐<span class="player-number-note">号码未设置</span></div></div></div></div>');
 const buttons=await page.locator('.position-options button').evaluateAll(xs=>xs.map(x=>({w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height,top:x.getBoundingClientRect().top,color:getComputedStyle(x).color,weight:getComputedStyle(x).fontWeight})));
 for(const b of buttons){assert.ok(b.w>=44&&b.h>=44,`${width}: ${JSON.stringify(b)}`)}
 assert.equal(new Set(buttons.map(b=>b.top)).size,1,`${width}:三个位置标签保持同排`);
 assert.notEqual(buttons[0].color,buttons[1].color);assert.equal(buttons[1].weight,'400');
 const note=await page.locator('.player-number-note').evaluate(x=>{const range=document.createRange();range.selectNodeContents(x);return {lines:range.getClientRects().length,w:x.getBoundingClientRect().width,parent:x.parentElement.getBoundingClientRect().width}});
 assert.equal(note.lines,1,`${width}:号码不孤字`);assert.ok(note.w<=note.parent);
 await page.close();
 }}finally{await browser.close()}
});

test('位置标签在禁用时保留选中语义但整体弱化',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../pages/manage-player/index.wxss'),'utf8');
 assert.match(css,/position-options button.ui-button.ui-compact\[size="mini"\]\[disabled\]\{opacity:.5/);
});
