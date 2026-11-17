const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('官方模板支持快照首字，空号无角标且不读取当前头像',()=>{
 const {wxmlToJs}=require('miniprogram-compiler'),gwx=new Function('window',wxmlToJs(root))({});
 const source=read('pages/match-detail/index.js');assert.match(source,/name: r\.playerSnapshot\?\.name \|\| "历史身份未记录"/);assert.match(source,/number: s\.value\(r\.playerSnapshot\?\.number\)/);
 const w=read('pages/match-detail/index.wxml'),avatar=w.split('class="roster-snapshot-avatar"')[1].split('<view class="roster-main">')[0];assert.match(avatar,/item\.name\[0\]/);assert.doesNotMatch(avatar,/<image|avatarUrl|currentPlayer/);
 const cls=(tree,name)=>{const out=[];function walk(n){if(!n||typeof n!=='object')return;if(JSON.stringify(n.attr||{}).includes(name))out.push(n);for(const [k,v]of Object.entries(n))if(k!=='attr'){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v)}}walk(tree);return out};
 for(const number of ['—','',null,0,10]){
 const data={loading:false,error:'',match:{status:'completed'},team:{},venueLocation:{},replyGroups:[],replies:[],snapshots:[],roster:[{playerId:1,name:'旧姓名',number,goalsLabel:'—',assistsLabel:'—'}]};
 const tree=gwx('pages/match-detail/index.wxml')(data),json=JSON.stringify(tree);assert.ok(json.includes('旧'));assert.ok(json.includes('旧姓名'));assert.equal(cls(tree,'roster-snapshot-number').length,number===0||number===10?1:0);
 }
});
test('三宽名单快照占位、长姓名和右侧数据互不挤压',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430]){
 const page=await browser.newPage({viewport:{width,height:900}}),css=(read('app.wxss')+'\n'+read('pages/match-detail/index.wxss')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
 await page.setContent('<style>body{margin:0}'+css+'</style><div class="page match-detail-page"><div class="content-section roster-section"><div class="roster-row"><div class="roster-snapshot-avatar">旧<span class="roster-snapshot-number">9999</span></div><div class="roster-main"><div class="roster-name">9999 · 历史留存长姓名 Anonymous</div><div class="roster-meta">中场 · 出场待确认</div></div><div class="roster-aside"><span class="roster-selection">首发</span><span class="roster-stats">进球 999　助攻 999</span></div></div></div></div>');
 const boxes=await page.locator('.roster-row > div').evaluateAll(xs=>xs.map(x=>{const r=x.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,scroll:x.scrollWidth}}));assert.ok(boxes[0].right<=boxes[1].left&&boxes[1].right<=boxes[2].left);for(const b of boxes)assert.ok(b.scroll<=b.width+1&&b.right<=width);await page.close();
 }}finally{await browser.close()}
});

test('名单进球和助攻按独立完整数据组分行，窄屏不拆数字',()=>{
 const w=fs.readFileSync(path.join(__dirname,'../pages/match-detail/index.wxml'),'utf8');
 assert.ok(w.includes('<text class="roster-stat">进球 {{item.goalsLabel}}</text>'));
 assert.ok(w.includes('<text class="roster-stat">助攻 {{item.assistsLabel}}</text>'));
 assert.match(fs.readFileSync(path.join(__dirname,'../pages/match-detail/index.wxss'),'utf8'),/roster-stats \.roster-stat\{display:block;white-space:nowrap\}/);
});
