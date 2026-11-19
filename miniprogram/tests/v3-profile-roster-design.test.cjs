const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=(page,ext='wxml')=>fs.readFileSync(path.join(__dirname,'../pages',page,'index.'+ext),'utf8');
test('球员档案表现标题在卡片外，报名保留四项完整字段',()=>{
 const w=read('player-detail'),css=read('player-detail','wxss');
 assert.match(w,/比赛表现<\/text><text class="scope-label">{{scopeLabel}}<\/text><\/view><view class="performance-card">/);
 for(const field of ['yes','maybe','no','unanswered'])assert.ok(w.includes('{{record.registration.'+field+'}}'));
 assert.match(css,/\.profile-detail\{flex-direction:column;align-items:flex-start/);
 assert.match(css,/\.registration-section \.registration-item\+\.registration-item\{border-left:/);
 assert.match(css,/\.registration-section \.registration-value\{font-size:56rpx;color:var\(--brand-ink\)/);
 assert.match(w,/“—”表示未记录/);
});
test('比赛日期时间与单行字段等高且至少44px，保留发布说明和清除条件',()=>{
 const w=read('match-edit'),css=read('match-edit','wxss');
 assert.match(w,/class="filter-row date-time-row"/);
 assert.match(css,/\.page \.date-time-row \.picker\{box-sizing:border-box;height:var\(--field-control-height,88rpx\);min-height:44px\}/);
 const note='草稿仅管理员可见，选择“发布报名”后球员才能报名';assert.equal(w.split(note).length,2);
 assert.ok(w.indexOf(note)>w.indexOf('所属赛季'));
 assert.ok(w.indexOf(note)<w.indexOf('比赛状态'));
 assert.equal((w.match(/class="card(?: section)?"/g)||[]).length,2);
 assert.equal((w.match(/class="card notice-section"/g)||[]).length,1);
 assert.match(w,/<radio-group class="status-options" bindchange="changeStatus">/);
 assert.match(w,/<radio value="{{item.value}}" checked="{{statusIndex===index}}" disabled="{{busy}}"/);
 assert.doesNotMatch(w,/归属与状态/);
 assert.match(w,/wx:if="{{form.kickoff}}"[\s\S]*?bindtap="clearTime"[\s\S]*?disabled="{{loading \|\| \(busy\)}}"/);
 assert.match(css,/clear-kickoff\[size="mini"\]\{display:flex;justify-content:flex-start/);
});
test('名单横幅直接进入添加卡片，保留历史身份与名单数量',()=>{
 const w=read('match-roster'),css=read('match-roster','wxss');
 assert.doesNotMatch(w,/class="roster-heading"/);assert.match(w,/club-banner-mark[^]*?<\/view>\s*<view class="add-section">/);assert.match(w,/{{rows.length}} 人/);assert.match(w,/class="identity-note" wx:if="{{item.historical}}"/);
 assert.match(w,/迁移时留存身份/);assert.match(w,/保存后将替换本场完整名单/);
 assert.match(css,/\.identity-note\{padding:16rpx 20rpx;border-radius:18rpx;background:var\(--canvas\)/);
});
test('赛季添加操作上下排列且保留无候选禁用、只读与保存守卫',()=>{
 const w=read('season-roster'),css=read('season-roster','wxss');
 assert.ok(w.indexOf('{{name}}')<w.indexOf('class="club-banner-mark"'));
 assert.match(w,/人{{admin\?'':' · 只读'}}/);
 assert.match(w,/bindtap="add" disabled="{{loading \|\| \(busy\|\|conflict\|\|!candidates.length\)}}" size="mini">添加球员/);
 assert.match(w,/保存不改变球员当前资料或历史比赛快照/);
 assert.match(css,/\.page \.picker-row\{flex-direction:column;align-items:stretch/);
 assert.match(css,/\.page \.picker-row business-picker\{flex:none;width:100%/);
});

test('比赛清除时间在busy禁用时仍有独立弱化视觉',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../pages/match-edit/index.wxss'),'utf8');
 assert.match(css,/clear-kickoff\[size="mini"\]\[disabled\]\{opacity:.5/);
});

test('17和18选择器字段值遵循原图正文色，不扩大品牌强调',()=>{
 const fs=require('node:fs'),path=require('node:path');
 for(const [page,selector] of [['match-roster','.roster-page .picker-value'],['season-roster','.picker-row .picker-value']]){
  const css=fs.readFileSync(path.join(__dirname,'../pages',page,'index.wxss'),'utf8');
  assert.ok(css.includes(selector+' { color:var(--ink); }'));
 }
});

test('12照片与微信入口归入同一白色卡片且保留事件和禁用条件',()=>{
 const w=read('manage-player'),css=read('manage-player','wxss');
 assert.match(w,/<view wx:if="{{id}}" class="card player-service-card">/);
 for(const event of ['openPhotos','openWechat'])assert.match(w,new RegExp('bindtap="'+event+'" disabled="{{busy}}" class="ui-button ui-block player-service-entry"'));
 assert.equal((w.match(/class="service-label"/g)||[]).length,2);
 assert.equal((w.match(/class="service-chevron"/g)||[]).length,2);
 assert.match(css,/player-service-entry\+ \.player-service-entry\{border-top:1px solid var\(--line\)/);
 assert.match(css,/min-height:64px/);
});
