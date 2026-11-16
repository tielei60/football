// 截图①回归：真实全局+页级WXSS级联，不替代微信原生loading图标验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('战术同组操作三宽常态、禁用、加载及长文顶底齐且文本居中',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 const source=fs.readFileSync(path.join(root,'pages/tactics/index.wxml'),'utf8');
 const tags=['new-tactic','tactic-transfer'].map(id=>{const tag=[...source.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(m=>m[0]).find(x=>x.includes('id="'+id+'"'));assert.ok(tag);return tag;});
 try{for(const width of [320,375,430])for(const state of ['normal','disabled','loading','long']){
  const page=await browser.newPage({viewport:{width,height:800}});
  const css=(fs.readFileSync(path.join(root,'app.wxss'),'utf8')+'\n'+fs.readFileSync(path.join(root,'pages/tactics/index.wxss'),'utf8')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
  const html=tags.map((tag,i)=>tag.replace(/ disabled="[^"]*"/g,'').replace(/>([^<]*)<\/button>/,(_,label)=>'>'+((state==='loading'&&i===0)?'<i class="test-spinner"></i>':'')+'<span class="button-copy">'+(state==='long'?(i?'导入或导出完整战术备份文件':'创建一套新的球队比赛战术'):label)+'</span></button>').replace('<button', '<button'+(['disabled','loading'].includes(state)?' disabled':''))).join('');
  await page.setContent('<style>body{margin:0}.test-spinner{display:inline-block;width:12px;height:12px;margin-right:6px;flex:none}'+css+'</style><div class="page"><div class="tactical-actions">'+html+'</div></div>');
  const boxes=await page.locator('button').evaluateAll(xs=>xs.map(x=>{const r=x.getBoundingClientRect(),s=getComputedStyle(x),t=x.querySelector('.button-copy').getBoundingClientRect();return{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,textMid:(t.top+t.bottom)/2,mid:(r.top+r.bottom)/2,align:s.alignItems,justify:s.justifyContent,scroll:x.scrollWidth,client:x.clientWidth};}));
  assert.ok(Math.abs(boxes[0].top-boxes[1].top)<.1,JSON.stringify({width,state,boxes}));assert.ok(Math.abs(boxes[0].bottom-boxes[1].bottom)<.1,JSON.stringify({width,state,boxes}));
  for(const b of boxes){assert.ok(b.height>=44&&b.width>=44);assert.ok(b.left>=0&&b.right<=width+.5&&b.scroll<=b.client+1);assert.equal(b.align,'center');assert.equal(b.justify,'center');assert.ok(Math.abs(b.textMid-b.mid)<1);}
  await page.close();
 }}finally{await browser.close()}
});
test('战术按钮组显式压过全局block与compact级联而不改事件门禁',()=>{
 const css=fs.readFileSync(path.join(root,'pages/tactics/index.wxss'),'utf8'),w=fs.readFileSync(path.join(root,'pages/tactics/index.wxml'),'utf8');
 const rule=css.match(/\.page \.tactical-actions>button\.ui-button\[size="mini"\]\{([^}]+)\}/);assert.ok(rule);
 for(const declaration of ['flex:1 1 0','width:0','min-height:44px','height:auto','margin:0','padding:20rpx 12rpx','align-self:stretch','align-items:center','justify-content:center','font-size:26rpx','line-height:1.5'])assert.ok(rule[1].includes(declaration),declaration);
 assert.match(css,/\.page \.tactical-actions\{align-items:stretch\}/);
 for(const [id,handler]of [['new-tactic','create'],['tactic-transfer','transfer']]){const tag=[...w.matchAll(/<button\b[^>]*>/g)].map(m=>m[0]).find(x=>x.includes('id="'+id+'"'));assert.ok(tag);assert.ok(tag.includes('wx:if="{{canManage}}"'));assert.ok(tag.includes('disabled="{{loading}}"'));assert.ok(tag.includes('bindtap="'+handler+'"'));}
});
