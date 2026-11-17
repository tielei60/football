const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=ext=>fs.readFileSync(path.join(__dirname,'../pages/wechat-invites/index.'+ext),'utf8');
test('邀请历史标题与原状态及有效期同卡保留，不增加操作',()=>{
 const w=read('wxml'),c=read('wxss');
 assert.match(w,/<view wx:for="{{items}}" wx:key="id" class="card history-row">\s*<view class="history-row-heading"><text class="history-row-title">历史邀请<\/text><text class="history-status">{{item.label}}<\/text><\/view><text class="hint">有效期至 {{item.expires}}<\/text>/);
 const row=w.split('class="card history-row">')[1].split('</view>\n')[0];assert.doesNotMatch(row,/bindtap|button/);
 assert.match(c,/\.history-row-heading\{[^}]*flex-wrap:wrap/);
 assert.match(w,/bindtap="more" loading="{{loadingMore}}" disabled="{{busy\|\|loadingMore\|\|needsRefresh}}"/);
});
