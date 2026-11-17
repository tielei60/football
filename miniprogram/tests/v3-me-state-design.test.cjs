const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../pages/me');
const wxml=fs.readFileSync(path.join(root,'index.wxml'),'utf8'),css=fs.readFileSync(path.join(root,'index.wxss'),'utf8');
function controller(){let page;const calls=[];vm.runInNewContext(fs.readFileSync(path.join(root,'index.js'),'utf8'),{require:()=>({}),Page:p=>page=p,wx:{switchTab:o=>calls.push(o.url),navigateTo:o=>calls.push(o.url)}});page.data={loading:false,error:'',busy:false,session:{user:{role:'player'}}};return {page,calls};}
test('系统管理员标签优先且管理权限守卫保留',()=>{assert.ok(wxml.includes("session.user.systemAdmin?'系统管理员':session.user.role==='admin'?'管理员':"));assert.ok(wxml.includes('wx:if="{{session.user.role===\'admin\'}}" class="section management-section"'));assert.ok(wxml.includes('wx:if="{{session.user.systemAdmin}}"'));});
test('管理区不再包白卡，报名年份独立弱化',()=>{assert.ok(!wxml.includes('class="card section"><view class="section-title">球队管理'));assert.ok(wxml.includes('class="registration-year">{{year}} 年'));assert.match(css,/registration-year\{[^}]*color:var\(--muted\)/);});
test('账号菜单资料入口只对关联球员显示，统计和密码图标存在',()=>{assert.ok(wxml.includes('<button wx:if="{{player}}" disabled="{{loading || busy}}" bindtap="profile"'));assert.ok(wxml.includes('bindtap="statistics"'));assert.ok(wxml.includes('/assets/ui-v3-lock.png"/><text class="bold account-heading'));assert.ok(wxml.includes("session.user.passwordEnabled!==false"));});
test('球队数据使用现有tab路由，加载错误忙碌隐藏销毁期间不导航',()=>{const {page,calls}=controller();page.statistics();assert.deepEqual(calls,['/pages/statistics/index']);for(const key of ['loading','busy','error']){page.data[key]=true;page.statistics();page.data[key]=false;}for(const key of ['_hidden','_disposed']){page[key]=true;page.statistics();page[key]=false;}assert.equal(calls.length,1);});
test('个人资料导航复用原方法并编码ID，无关联时不导航',()=>{const {page,calls}=controller();page.profile();assert.equal(calls.length,0);page.data.player={id:'player/a'};page.profile();assert.equal(calls[0],'/pages/player-detail/index?id=player%2Fa');});
test('所有账号菜单按钮禁用态用高特异性规则覆盖正常行，包括原战术入口',()=>{
  const selector='.page .account-menu button.account-row[disabled]';
  assert.ok(css.includes(selector+'{opacity:.5}'));
  assert.ok(css.lastIndexOf(selector)>css.lastIndexOf('.page .account-menu .account-row{'));
  const rows=[...wxml.matchAll(/<button\b[^>]*class="ui-button account-row"[^>]*>/g)].map(m=>m[0]);
  assert.equal(rows.length,3);
  for(const row of rows)assert.match(row,/disabled="\{\{/);
  for(const handler of ['profile','tactics','statistics'])assert.ok(rows.some(row=>row.includes(`bindtap="${handler}"`)));
  // CSS级联：禁用选择器(0,4,1) > 普通行(0,3,0)，不存在靠!important隐藏状态。
  const specificity=s=>[(s.match(/#/g)||[]).length,(s.match(/\.[\w-]+|\[[^\]]+\]/g)||[]).length,(s.replace(/\.[\w-]+|\[[^\]]+\]/g,'').match(/\b[a-z]+\b/g)||[]).length];
  assert.deepEqual(specificity(selector),[0,4,1]);
  assert.deepEqual(specificity('.page .account-menu .account-row'),[0,3,0]);
});
test('三宽实际CSS级联使所有账号行禁用时半透明，恢复后正常',async()=>{
  const {chromium}=require('../../app/node_modules/playwright');
  const browser=await chromium.launch({headless:true});
  try{for(const width of [320,375,430]){
    const page=await browser.newPage({viewport:{width,height:900}});
    const styles=(fs.readFileSync(path.join(__dirname,'../app.wxss'),'utf8')+'\n'+css).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
    await page.setContent('<style>'+styles+'</style><div class="page"><div class="card account-menu">'+['profile','tactics','statistics'].map(h=>`<button class="ui-button account-row" size="mini" disabled data-handler="${h}">账号入口</button>`).join('')+'</div></div>');
    assert.deepEqual(await page.locator('.account-row').evaluateAll(xs=>xs.map(x=>getComputedStyle(x).opacity)),['0.5','0.5','0.5']);
    await page.locator('.account-row').evaluateAll(xs=>xs.forEach(x=>x.removeAttribute('disabled')));
    await require('../../app/node_modules/playwright/test').expect.poll(()=>page.locator('.account-row').evaluateAll(xs=>xs.map(x=>getComputedStyle(x).opacity))).toEqual(['1','1','1']);
    await page.close();
  }}finally{await browser.close();}
});
