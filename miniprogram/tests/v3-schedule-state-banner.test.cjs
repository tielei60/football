const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const w=read('pages/schedule/index.wxml'),css=read('pages/schedule/index.wxss');
test('08/09 草稿与历史使用设计 MATCHDAY 标题且不替换待比赛焦点',()=>{
 assert.ok(w.includes('wx:if="{{tab===\'past\' || (admin && tab===\'draft\')}}" class="club-page-banner schedule-state-banner"'));
 for(const text of ['MATCHDAY','每一场，都值得记录','下一场，从这里开始','赛果与复盘 · 留住一起上场的瞬间','比赛发布后，球员才能报名'])assert.ok(w.includes(text));
 assert.ok(w.includes('wx:if="{{!loading && !error && tab===\'upcoming\' && visible.length}}" class="fixture-focus"'));
 assert.ok(w.indexOf('schedule-state-banner')<w.indexOf('schedule-admin-action'));
});
test('创建入口置于筛选前且只存在一次，保留管理员权限、禁用与事件',()=>{
 const action=w.match(/<view wx:if="\{\{admin\}\}" class="schedule-admin-action">([\s\S]*?)<\/view>/);
 assert.ok(action);assert.equal((w.match(/bindtap="create"/g)||[]).length,1);
 assert.ok(action[1].includes('disabled="{{loading}}"'));assert.ok(action[1].includes('bindtap="create"'));
 assert.ok(w.indexOf('schedule-admin-action')<w.indexOf('class="tabs"'));
 assert.equal((w.match(/bindtap="changeTab"/g)||[]).length,3);
 assert.match(w,/wx:if="\{\{admin\}\}"\s+class="tab \{\{tab==='draft'/);
 assert.ok(w.includes('wx:if="{{!loading && !error}}"'));
});
test('复用全局品牌样式且创建按钮保留44px触控及居中图文',()=>{
 assert.ok(read('app.wxss').includes('.club-page-banner{'));
 assert.match(css,/button\.schedule-create\[size="mini"\]\{min-height:44px/);
 assert.match(css,/button\.schedule-create\[size="mini"\]\{display:flex;align-items:center;justify-content:center/);
 assert.ok(w.includes('class="schedule-create-plus" aria-hidden="true"'));
});
