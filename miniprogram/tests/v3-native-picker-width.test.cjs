const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('选择器原生按钮不使用会收窄 slot 的 mini 模式，事件和禁用保留',()=>{
 const w=read('components/business-picker/index.wxml');
 assert.doesNotMatch(w,/size="mini"/);assert.match(w,/bindtap="open"/);assert.match(w,/disabled="{{disabled}}"/);assert.match(w,/<slot\/>/);
 const css=read('components/business-picker/index.wxss');assert.match(css,/min-height:44px/);assert.match(css,/width:100%!important/);
});
test('首页口号以块级两行呈现，避免原生空白折叠',()=>{
 const w=read('pages/home/index.wxml');assert.match(w,/<text class="hero-headline-line">一起踢球，<\/text><text class="hero-headline-line">更好的我们。<\/text>/);
 assert.match(read('pages/home/index.wxss'),/\.hero-headline-line\{display:block\}/);
});

test('比赛详情 hero 紧贴导航，消除14px空隙',()=>{
 assert.match(read('pages/match-detail/index.wxss'),/\.match-detail-page\{background:var\(--canvas\);padding-top:0\}/);
});
