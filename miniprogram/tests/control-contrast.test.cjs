const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('app.wxss');
function token(name){const value=app.match(new RegExp('--'+name+':\\s*(#[0-9a-f]{6})','i'));assert.ok(value,name);return value[1];}
function luminance(hex){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);}
function ratio(a,b){const [lo,hi]=[luminance(a),luminance(b)].sort((a,b)=>a-b);return (hi+.05)/(lo+.05);}
test('shared interactive border and focus tokens exceed 3:1 on existing light surfaces',()=>{
 for(const name of ['control-border','focus'])for(const bg of [token('surface'),token('canvas'),token('brand-soft'),'#faf8fc','#faf7fc','#f7f4f9','#f5f2f7'])assert.ok(ratio(token(name),bg)>=3,`${name} on ${bg}`);
});
test('field and isolated component boundaries reference control tokens while decoration stays light',()=>{
 assert.equal(token('line'),'#e8def5');
 assert.match(app,/input\.input\{border-color:var\(--control-border,#8d6a9e\)\}/);
 assert.match(app,/textarea\{border-color:var\(--control-border,#8d6a9e\)\}/);
 assert.match(app,/\.filter-row \.picker\{[^}]*border-color:var\(--control-border,#8d6a9e\)/);
 const dialog=read('components/business-dialog/index.wxss');
 assert.match(dialog,/\.dialog-input\{[^}]*border:2rpx solid var\(--control-border,#8d6a9e\)/);
 assert.match(dialog,/\.selection-mark\{[^}]*border:2rpx solid var\(--control-border,#8d6a9e\)/);
 for(const name of ['business-picker','business-dialog','page-state'])assert.match(read('components/'+name+'/index.wxss'),/outline:3rpx solid var\(--focus,#760b88\)/);
 assert.match(dialog,/\.dialog-input:focus-visible\{outline:3rpx solid var\(--focus,#760b88\)/);
 assert.match(dialog,/\.selector-dialog \.buttons\{[^}]*border-top:1rpx solid var\(--line,#e8def5\)/);
});
test('contrast-only changes retain native input geometry and existing compact control sizes',()=>{
 assert.match(app,/input\.input\{height:88rpx;min-height:88rpx;padding:0 24rpx;line-height:42rpx\}/);
 const dialog=read('components/business-dialog/index.wxss');
 assert.match(dialog,/\.dialog-input\{[^}]*height:92rpx;padding:0 22rpx/);
 assert.match(dialog,/button\.day\[size="mini"\]\{[^}]*height:64rpx;min-height:64rpx;max-height:64rpx/);
 assert.match(app,/button\.ui-button\[size="mini"\]\{[^}]*min-height:84rpx/);
});
