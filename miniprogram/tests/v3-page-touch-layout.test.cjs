// 合并样式命中区回归；不替代微信真实画布触控、键盘及设备测量。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const cases=[
 ['match-detail','<div class="page"><button class="match-share-button" size="mini">分享</button><button class="match-management-button" size="mini">编辑比赛</button><button class="fact-navigation" size="mini">导航</button><div class="fixed-actions"><div class="actions"><button class="reply-button" size="mini">参加</button></div></div></div>','button'],
 ['players','<div class="page"><div class="players-tabs"><div class="players-tab">在队</div></div><div class="player-search"><input class="search-input"><button class="search-clear" size="mini">×</button></div></div>','.players-tab,input,button'],
 ['player-detail','<div class="page"><button class="photo-link" size="mini">出场照片</button></div>','button'],
 ['tactic-board','<div class="page canvas-focus"><div class="edit-actions"><button class="edit-action">保存</button></div><div class="editor-tools"><div class="picker">箭头</div><button class="small">撤销</button><button class="small">重做</button><button class="small">属性</button></div></div>','button,.picker'],
 ['tactic-compose','<div class="page canvas-focus"><div class="row"><div class="picker">阶段一</div><button class="small">退出</button></div><input></div>','button,input,.picker'],
 ['tactic-setup','<div class="page type-expanded"><input><button class="preview-toggle">预览</button></div>','button,input'],
];
test('V3重点页面真实级联控件三档高度44px，分享/清除宽度44px',async()=>{
 const {chromium}=require('../../app/node_modules/playwright');const browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430])for(const [name,html,selector]of cases){
  const page=await browser.newPage({viewport:{width,height:900}});
  const css=(fs.readFileSync(path.join(root,'app.wxss'),'utf8')+'\n'+fs.readFileSync(path.join(root,'pages',name,'index.wxss'),'utf8')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
  await page.setContent('<style>body{margin:0}'+css+'</style>'+html);
  for(const x of await page.locator(selector).evaluateAll(xs=>xs.map(x=>({c:x.className,w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height})))){
   assert.ok(x.h>=44,`${name} ${width} ${x.c} height=${x.h}`);
   if(/match-share|search-clear/.test(x.c))assert.ok(x.w>=44,`${name} ${width} width=${x.w}`);
  }
  await page.close();
 }}finally{await browser.close()}
});
