const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'../pages',p,'index.wxml'),'utf8');
test('04 统计水印为独立装饰，两个统计范围标签与选择器相对应',()=>{
 const s=read('statistics');assert.match(s,/class="statistics-watermark"[^>]*mode="aspectFit"[^>]*aria-hidden="true"/);
 assert.match(s,/bindchange="season"\s*><view class="filter-label">统计范围/);assert.match(s,/bindchange="year"\s*><view class="filter-label">自然年/);
});
test('08 照片入口独立于紫色身份区，保留真实照片事件',()=>{
 const s=read('player-detail');assert.match(s,/class="profile-watermark"[^>]*mode="aspectFit"/);
 assert.match(s,/<\/view>\s*<button bindtap="openPhotos" class="ui-button photo-link"/);
 assert.match(s,/src="\/assets\/photos-shortcut.png"/);assert.equal((s.match(/bindtap="openPhotos"/g)||[]).length,1);
});
test('07 须知相册入口位于信息卡内并在封面前，不删除管理操作',()=>{
 const s=read('match-detail'),a=s.indexOf('class="match-facts"'),b=s.indexOf('class="ui-button match-media-button"'),c=s.indexOf('class="match-cover"');
 assert.ok(a>=0&&b>a&&c>b);assert.equal((s.match(/class="ui-button match-media-button"/g)||[]).length,1);assert.match(s,/bindtap="edit"/);assert.match(s,/bindtap="rosterEdit"/);
});
