// 合并 WXSS 的 Chromium 响应区域回归；不替代微信触控或真实上传/邀请审批。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const button=(text,extra='')=>`<button size="mini" class="ui-button ${extra}">${text}</button>`;
// 从真实 WXML 提取动作组，避免三列/两列布局改动后夹具继续检查旧结构。
const photoMarkup=fs.readFileSync(path.join(root,'pages/player-photos/index.wxml'),'utf8');
const photoGroups=['photo-actions-main','photo-actions-secondary'].map(name=>{
 const match=photoMarkup.match(new RegExp('<view wx:if="{{admin}}" class="'+name+'">([\\s\\S]*?)</view>'));
 assert.ok(match,name);return '<div class="'+name+'">'+match[1]+'</div>';
}).join('');
const cases=[
 ['me',`<div class="page"><div class="card"><div class="management-grid">${button('球队资料')}${button('赛季管理')}${button('系统账号')}</div></div><div class="member-shortcuts">${button('我的资料')}${button('球队战术')}</div><div class="card account-menu">${button('球队战术板','account-row')}<div class="account-password"><div class="between account-row account-password-toggle">修改密码</div></div></div>${button('退出 / 切换账号','danger ui-block account-logout')}</div>`],
 ['player-photos',`<div class="page"><div class="card">${photoGroups}${button('重试照片','ui-block')}</div>${button('选择照片','ui-block')}${button('上传照片','primary ui-block')}${button('重新载入','ui-block')}</div>`],
 ['match-media',`<div class="page"><div class="card">${button('保存须知','primary ui-block')}<div class="actions">${button('设为封面')}${button('移除','danger')}</div><div class="photo-order-actions">${button('上移')}${button('下移')}</div>${button('重试照片','ui-block')}</div>${button('选择照片','ui-block')}${button('上传照片','primary ui-block')}</div>`],
 ['wechat-invites',`<div class="page"><div class="card">${button('解除绑定','invite-danger ui-block')}${button('生成邀请卡片','primary ui-block')}<div class="invite-actions">${button('核对并批准','primary')}${button('拒绝申请')}</div></div><div class="invite-modal-actions">${button('关闭')}${button('转发卡片','primary')}</div>${button('重新载入','ui-block')}</div>`],
];
test('我的管理及媒体邀请按钮经真实级联后三档均至少44px高',async()=>{
 const {chromium}=require('../../app/node_modules/playwright');const browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430])for(const [name,html]of cases){
  const page=await browser.newPage({viewport:{width,height:900}});
  const css=(fs.readFileSync(path.join(root,'app.wxss'),'utf8')+'\n'+fs.readFileSync(path.join(root,'pages',name,'index.wxss'),'utf8')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
  await page.setContent('<style>body{margin:0}'+css+'</style>'+html);
  for(const x of await page.locator('button, .account-password-toggle').evaluateAll(xs=>xs.map(x=>({text:x.textContent,height:x.getBoundingClientRect().height,width:x.getBoundingClientRect().width})))){
   assert.ok(x.height>=44,`${name} ${width}: ${x.text} height=${x.height}`);
   assert.ok(x.width>=44,`${name} ${width}: ${x.text} width=${x.width}`);
  }
  await page.close();
 }}finally{await browser.close()}
});
