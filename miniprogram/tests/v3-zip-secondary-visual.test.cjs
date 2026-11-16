// ZIP V3 首屏对应：11/13/15、23/25/30、27–29。仅验证展示契约，不代表原生视觉或服务验证。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=(page,ext='wxml')=>fs.readFileSync(path.join(__dirname,'../pages',page,'index.'+ext),'utf8');
test('管理列表新增操作独立整行，保留事件与禁用',()=>{
 for(const page of ['manage-players','manage-seasons','manage-venues']) {
  const w=read(page);assert.match(w,/<view class="admin-create-action"><button[^>]*disabled="{{loading}}"[^>]*class="[^"]*ui-block[^"]*"[^>]*bindtap="create"/);
  if(page!=='manage-venues')assert.match(w,/wx:if="{{authorized}}"/);
  assert.match(read(page,'wxss'),/min-height:44px/);
 }
});
test('非画布战术页共用紫色品牌横幅，不引入业务操作',()=>{
 for(const page of ['tactic-transfer','tactic-export','tactic-create']) {
  const w=read(page);assert.match(w,/class="club-page-banner"/);assert.match(w,/class="club-banner-mark" src="\/assets\/team-badge.png" mode="aspectFit"/);
  assert.doesNotMatch(w,/class="tactical-header"/);
 }
});
test('关闭能力独立标题说明卡，生成引导仅出现在开启分支',()=>{
 for(const page of ['wechat-claim','wechat-invites','player-ai']) {
  const w=read(page);assert.match(w,/wx:if="{{!enabled}}" class="card capability-disabled"/);assert.match(w,/class="capability-title"/);assert.match(w,/class="capability-caption"/);
  assert.match(w,/class="capability-symbol capability-/);assert.doesNotMatch(w,/wx:if="{!enabled}"/);
 }
 const ai=read('player-ai');assert.match(ai,/<block wx:else>\s*<view class="ai-intro">/);assert.match(ai,/原有头像与照片不受影响/);
});
