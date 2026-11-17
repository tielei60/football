// 展示契约与静态布局检查，不代替微信开发者工具逐页交互验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const w=fs.readFileSync(path.join(__dirname,'../pages/schedule/index.wxml'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../pages/schedule/index.wxss'),'utf8');
test('V3赛程首屏直接焦点，管理员创建入口不改变球员首屏',()=>{
 assert.match(w,/^<view class="page schedule-page"><view wx:if="{{!loading && !error && tab==='upcoming' && visible.length}}" class="fixture-focus"/);
 assert.doesNotMatch(w,/每一场，都在这里/);
 assert.match(w,/<view wx:if="{{admin}}" class="schedule-admin-action"><button disabled="{{loading}}"[^>]*bindtap="create"/);
 const order=['class="fixture-focus"','class="schedule-admin-action"','class="tabs"','{{item.monthHeading}}'].map(s=>w.indexOf(s));
 assert.ok(order.every(n=>n>=0));assert.deepEqual(order,[...order].sort((a,b)=>a-b));
 assert.match(css,/button\.schedule-create\[size="mini"\]\{min-height:44px/);
});
test('票签与对手同排，日期时间在对手下方，独立地点保留全部实际状态字段',()=>{
 const row=w.slice(w.indexOf('class="fixture-main"'),w.indexOf('class="divider"'));
 for(const s of ['date-ticket','fixture-details','fixture-status','{{item.dayLabel}}','{{item.weekdayLabel}}','{{item.opponent}}','{{item.dateLabel}}','{{item.statusLabel}}','{{item.scoreLabel}}'])assert.ok(row.includes(s),s);
 assert.ok(row.indexOf('{{item.opponent}}')<row.indexOf('{{item.dateLabel}}'));
 assert.match(w,/item.kickoff \|\| '时间待定'/);assert.match(w,/item.location \|\| '地点待定'/);
 for(const s of ['item.competition','item.format','item.signupCountLabel','item.maybeCount','item.noCount','item.responseLabel','item.monthHeading'])assert.ok(w.includes(s),s);
 assert.equal((w.match(/bindtap="openMatch"/g)||[]).length,2);
 assert.equal((w.match(/bindtap="changeTab"/g)||[]).length,3);
 assert.match(w,/wx:if="{{item.status==='completed'}}" class="score"/);
 assert.match(css,/\.fixture-details\{flex:1;min-width:0\}/);
});
