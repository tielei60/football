const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=(page,ext='wxml')=>fs.readFileSync(path.join(__dirname,'../pages',page,'index.'+ext),'utf8');
test('赛程焦点增加主客场与语义图标，不增点击或删原信息',()=>{
 const w=read('schedule'),css=read('schedule','wxss');
 for(const f of ['calendar','pin','people'])assert.ok(w.includes('/assets/ui-v3-'+f+'.png'));
 assert.match(w,/visible\[0\]\.side==='home'/);assert.match(w,/主客场待定/);
 assert.match(w,/class="section-title schedule-month"/);
 assert.match(css,/\.schedule-page \.card \.match-name\{border-left:0;padding-left:0\}/);
 assert.match(w,/{{item.dateLabel}} · {{item.kickoff \|\| '时间待定'}}/);
});
test('球员管理合并卡片且保留原搜索、编辑与账号标签',()=>{
 const w=read('manage-players'),css=read('manage-players','wxss');
 assert.match(w,/<view class="managed-player-list"><view aria-role="button" wx:for="{{visible}}"/);
 for(const h of ['create','edit','status'])assert.ok(w.includes('bindtap="'+h+'"'));
 assert.match(w,/value="{{search}}" bindinput="search"/);
 assert.match(w,/class="search-symbol" aria-hidden="true"/);
 assert.match(css,/\.managed-player-list:empty\{display:none\}/);
 assert.match(css,/\.managed-player-list>\.card.row\+\.card.row\{border-top:/);
});
test('比赛时间在主视觉，报名分组外壳透明且保留原导航与回应',()=>{
 const w=read('match-detail'),css=read('match-detail','wxss');
 assert.ok(w.indexOf('class="match-hero-time"')<w.indexOf('class="match-facts"'));
 assert.equal((w.match(/{{match.dateLabel}}/g)||[]).length,1);
 assert.match(w,/bindtap="openLocation"/);assert.match(w,/wx:for="{{replyGroups}}"/);
 assert.match(css,/\.match-detail-page \.attendance-section\{background:transparent/);
 assert.match(css,/\.attendance-section \.reply-group\{background:var\(--surface\)/);
});
test('头像移除与赛季添加禁用视觉保留弱化，名单添加共用52px下限',()=>{
 assert.match(read('manage-player','wxss'),/\.portrait-editor \.stack>button\.ghost\.ui-button\.ui-compact\[size="mini"\]\{background:transparent/);
 assert.match(read('season-roster','wxss'),/\.picker-row button\.ui-button\.ui-compact\[size="mini"\]\[disabled\]\{background:var\(--canvas\);border-color:var\(--line\);color:var\(--muted\);opacity:.6\}/);
 assert.match(read('match-roster','wxss'),/\.add-section \.add-row\{align-items:flex-end\}/);
 assert.match(read('match-roster','wxss'),/\.roster-page \.add-row \.add-picker,\.roster-page \.add-row button\.add-button\[size="mini"\]\{min-height:52px;box-sizing:border-box\}/);
});
