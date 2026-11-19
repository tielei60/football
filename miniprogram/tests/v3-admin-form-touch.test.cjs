// 真实全局+页级WXSS级联，等价HTML控件；不代替微信键盘、选点或原生点击。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const cases=[
 ['manage-player','<div class="page"><div class="card"><div class="row portrait-editor"><div class="stack"><button size="mini" class="small ui-button ui-compact">选择头像</button><button size="mini" class="small ghost ui-button ui-compact">移除</button></div></div></div></div>'],
 ['match-roster','<div class="page roster-page"><div class="roster-card"><div class="roster-grid"><div><input class="input" value="999999"></div><div><input class="input" value="0"></div></div></div></div>'],
 ['season-roster','<div class="page"><div class="card row picker-row"><button size="mini" class="small ui-button ui-compact">添加</button></div><div class="card roster-card"><div class="member"><div class="row"><div class="grow">队员</div><div class="number"><input class="input" value="9999"></div><button size="mini" class="small ghost ui-button ui-compact">移出</button></div></div></div></div>'],
];
test('管理表单头像、名单统计与赛季操作三档实际级联>=44px',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 const failures=[];
 try{for(const width of [320,375,430])for(const [name,html]of cases){
  const page=await browser.newPage({viewport:{width,height:900}});
  const css=(read('app.wxss')+'\n'+read('pages/'+name+'/index.wxss')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
  await page.setContent('<style>body{margin:0}'+css+'</style>'+html);
  for(const r of await page.locator('button,input').evaluateAll(xs=>xs.map(x=>({text:x.textContent||x.value,w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height}))))if(r.h<44||r.w<44)failures.push(`${name}/${width}/${r.text}: ${r.w}×${r.h}`);
  await page.close();
 }}finally{await browser.close()}
 assert.deepEqual(failures,[]);
});
test('账号与相册输入保留持久标签、原字段事件和编辑条件',()=>{
 const player=read('pages/manage-player/index.wxml'),media=read('pages/match-media/index.wxml');
 for(const [w,id,label,field,handler] of [[player,'player-account-name','登录账号','username','accountInput'],[player,'player-account-password','新密码','password','accountInput'],[media,'match-photo-caption','照片说明（可选）','caption','input']]){
  assert.ok(w.includes(`for="${id}">${label}</label>`));
  const tag=w.match(new RegExp('<(?:input|textarea) id="'+id+'"[^>]*>'))?.[0];assert.ok(tag,id);
  assert.ok(tag.includes(`data-field="${field}"`));assert.ok(tag.includes(`bindinput="${handler}"`));assert.ok(tag.includes('disabled="{{loading || (busy'));
 }
 assert.match(player,/<input id="player-account-name" wx:if="{{!hasAccount}}"/);
 assert.match(player,/<input id="player-account-password"[^>]* password /);
 assert.doesNotMatch(media,/match-notice|saveNotice|data-field="notice"/);
 const edit=read('pages/match-edit/index.wxml');assert.match(edit,/<label[^>]*for="match-notice">本场须知（选填）<\/label>/);
 assert.match(edit,/<textarea id="match-notice"[^>]*value="{{form.notice}}"[^>]*data-field="notice"[^>]*bindinput="input"[^>]*disabled="{{busy}}"/);
});
test('候选标签保留候选为空与只读分支，未新增业务操作',()=>{
 const match=read('pages/match-roster/index.wxml'),season=read('pages/season-roster/index.wxml');
 assert.match(match,/wx:if="{{candidates.length}}" class="field-label candidate-label">可添加球员/);
 assert.match(match,/wx:else class="add-complete">当前没有可添加的球员/);
 assert.match(season,/<view wx:if="{{admin}}" class="card row picker-row"><text wx:if="{{candidates.length}}" class="field-label candidate-label">添加赛季球员/);
 assert.match(season,/<text wx:else class="hint">没有更多队员可添加/);
 for(const [w,names]of [[match,['choosePlayer','add','remove','pick','input','save','reload']],[season,['choose','add','number','remove','save','reload']]])for(const name of names)assert.ok(new RegExp('bind(?:tap|input|change)="'+name+'"').test(w),name);
});
