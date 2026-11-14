const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../pages/manage-venue');
test('venue map remains coordinate-bound and gives touchable preview and separated controls',()=>{
 const w=fs.readFileSync(path.join(root,'index.wxml'),'utf8'),css=fs.readFileSync(path.join(root,'index.wxss'),'utf8');
 assert.ok(css.includes('height:460rpx'));
 assert.match(w,/<map hidden="{{businessUiBlocking}}"/);
 assert.match(css,/\.location-actions\{[^}]*margin-top:24rpx/);
 assert.match(css,/\.location-actions>button\[size="mini"\]\{[^}]*width:0;min-width:0/);
 for(const attr of ['latitude="{{form.latitude}}"','longitude="{{form.longitude}}"','markers="{{markers}}"','bindtap="choose"','bindtap="open"','bindtap="clear"','bindtap="save"','bindchange="status"'])assert.ok(w.includes(attr),attr);
 for(const id of ['venue-pick','venue-open','venue-clear','venue-save'])assert.ok(w.includes('id="'+id+'"'));
 assert.ok(w.includes('disabled="{{loading || (busy||conflict||uncertain)}}"'));
 assert.ok(css.includes('border-top:1rpx solid var(--line)'));
});
