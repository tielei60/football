const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'../pages/match-edit/index.'),w=fs.readFileSync(base+'wxml','utf8'),css=fs.readFileSync(base+'wxss','utf8');
test('冲突与结果待核对使用带标题提示卡，普通错误保留红色',()=>{
 assert.match(w,/wx:if="{{actionError&&!conflict&&!uncertain}}" class="error"/);
 const card=w.slice(w.indexOf('<view wx:if="{{conflict||uncertain}}"'),w.indexOf('<button wx:if="{{savedId}}"'));
 assert.match(card,/结果待核对/);assert.match(card,/有更新需要核对/);
 for(const [handler,flag]of [['checkSchedule','uncertain'],['confirmAbsent','uncertain'],['reload','conflict']]){
 const tag=card.match(new RegExp('<button[^>]*bindtap="'+handler+'"[^>]*>'))?.[0];assert.ok(tag);assert.ok(tag.includes('disabled="{{loading}}"'));assert.ok(tag.includes('wx:if="{{'+flag+'}}"'));
 }
 assert.match(css,/\.recovery-notice\{[^}]*background:var\(--warning-soft\)/);
 assert.match(css,/button.recovery-check\[size="mini"\]\{background:var\(--surface\)/);
});
test('统计说明仅一次位于复盘后卡内，保存和已保存恢复保护不放宽',()=>{
 assert.equal(w.split('只有“已完赛”比赛计入统计').length-1,1);
 assert.match(w,/class="hint score-scope-note">[^<]*<\/view><\/view/);
 assert.match(w,/disabled="{{loading \|\| \(busy \|\| conflict \|\| uncertain \|\| savedId\)}}"/);
 assert.match(w,/wx:if="{{savedId}}" disabled="{{loading\|\|busy}}"[^>]*bindtap="openSaved"/);
});
