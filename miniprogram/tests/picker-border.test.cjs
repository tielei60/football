// 静态样式约束；实际边框闭合须用微信截图对比验证。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
test('picker trigger allows slot border to render without larger clipping radius or a second border',()=>{
 const css=fs.readFileSync(path.join(root,'components/business-picker/index.wxss'),'utf8');
 const trigger=css.match(/button\.trigger\[size="mini"\]\{([^}]+)\}/)[1];
 assert.match(trigger,/border-radius:12rpx/);
 assert.match(trigger,/overflow:visible/);
 assert.doesNotMatch(css,/overflow:\s*hidden|border-radius:\s*16rpx/);
 assert.match(css,/\.trigger\s*\{[^}]*border:\s*0/);
 assert.match(css,/\.trigger::after\s*\{\s*border:\s*0/);
 assert.match(css,/button\.trigger:focus-visible\{[^}]*border-radius:12rpx/);
 assert.match(trigger,/padding:0;margin:0/);
 assert.match(trigger,/font-size:inherit/);
 const app=fs.readFileSync(path.join(root,'app.wxss'),'utf8');
 assert.match(app,/\.picker\{[^}]*border:1rpx solid var\(--control-border,#8d6a9e\);border-radius:12rpx/);
});
