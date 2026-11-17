const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=(page,ext='wxml')=>fs.readFileSync(path.join(__dirname,'../pages',page,'index.'+ext),'utf8');
test('球队队徽字段标签在预览框外，选择与移除保留原事件及禁用条件',()=>{
 const w=read('manage-team'),css=read('manage-team','wxss');
 assert.match(w,/<view class="field crest-field"><text class="field-label">队徽<\/text><view class="crest-editor">/);
 assert.match(w,/<button bindtap="choose" disabled="{{loading \|\| \(busy\)}}" class="ui-button crest-choose"/);
 assert.match(w,/<button bindtap="remove" disabled="{{loading \|\| \(busy\|\|!crest\)}}" class="ui-button crest-remove"/);
 assert.match(w,/class="crest-action-icon" src="\/assets\/photos-shortcut.png"/);
 assert.match(w,/mode="aspectFit" binderror="imageError"/);
 assert.match(css,/button\.crest-remove\.ui-button\[size="mini"\]\{background:transparent/);
});
test('赛季和球场新增按钮内加号不创建新业务入口，赛季解释保持明确归属',()=>{
 for(const page of ['manage-seasons','manage-venues']) {
  const w=read(page);assert.equal((w.match(/bindtap="create"/g)||[]).length,1);
  assert.match(w,/<text class="create-symbol" aria-hidden="true">＋<\/text>/);
  assert.match(w,/<button disabled="{{loading}}"/);
 }
 assert.match(read('manage-seasons'),/wx:if="{{authorized}}"/);
 assert.match(read('manage-seasons'),/时间范围重叠不会自动合并统计/);
});
test('球场列表状态与箭头分离，整卡保留编辑与空态',()=>{
 const w=read('manage-venues');
 assert.match(w,/data-id="{{item.id}}" bindtap="edit"/);
 assert.match(w,/empty="{{!venues.length}}"/);
 assert.match(w,/<view class="venue-location"><text>{{item.latitude!==null\?'已设置地图位置':'未设置地图位置'}}<\/text><text class="venue-chevron" aria-hidden="true">›<\/text><\/view>/);
 assert.doesNotMatch(w,/ · 编辑 ›|常用球场保存一次/);
});
test('地图选点描边样式不影响坐标存在分支、遮挡与保存守卫',()=>{
 const w=read('manage-venue'),css=read('manage-venue','wxss');
 assert.match(w,/class="location-pick" bindtap="choose" disabled="{{loading \|\| \(busy\)}}"/);
 assert.match(w,/<block wx:if="{{markers.length}}">/);
 assert.match(w,/<map hidden="{{businessUiBlocking}}"/);
 assert.match(w,/class="primary venue-save" bindtap="save" loading="{{busy}}" disabled="{{loading \|\| \(busy\|\|conflict\|\|uncertain\)}}"/);
 assert.match(css,/\.page button\.location-pick\[size="mini"\]\{gap:16rpx;background:var\(--surface\)/);
});
