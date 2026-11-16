// 展示入口契约：不模拟成功保存，不替代微信操作验证。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=(e)=>fs.readFileSync(path.join(root,'pages/manage-venue/index.'+e),'utf8');
test('球场冲突提供显式返回核对，未知结果继续沿用原核对分支',()=>{
 const w=read('wxml'),tag=w.match(/<button[^>]*class="ui-button ui-block venue-reconcile"[^>]*>/)?.[0];assert.ok(tag);
 for(const attr of ['wx:if="{{conflict&&!uncertain}}"','disabled="{{loading || busy}}"','bindtap="checkList"','size="mini"'])assert.ok(tag.includes(attr),attr);
 assert.match(w,/<view wx:if="{{uncertain}}" class="uncertain-actions"><button disabled="{{loading}}" bindtap="checkList">返回球场列表核对<\/button><button disabled="{{loading}}" class="ghost" bindtap="confirmAbsent">/);
 assert.match(w,/disabled="{{loading \|\| \(busy\|\|conflict\|\|uncertain\)}}">保存球场/);
 assert.match(read('wxss'),/button\.venue-reconcile\[size="mini"\]\{min-height:44px/);
});
test('返回仍由用户点击触发，原JS保存保护与返回实现未替换为重载',()=>{
 const js=read('js');assert.match(js,/checkList\(\)\s*\{\s*wx.navigateBack\(\);\s*\}/);
 assert.match(js,/if \(this.data.busy \|\| this.data.conflict \|\| this.data.uncertain\) return;/);
 assert.match(js,/conflict: e.status === 409/);
});
