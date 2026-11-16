const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
for(const [page,cls,handler,condition] of [['match-edit','clear-kickoff','clearTime','form.kickoff'],['manage-player','account-toggle','toggleAccount',"status==='active'&&(!hasAccount||passwordEnabled)"]])test(page+'紧凑入口保留门禁并用高优先级固定44px命中区',()=>{
 const source=read('pages/'+page+'/index.wxml'),css=read('pages/'+page+'/index.wxss'),global=read('app.wxss');
 const tag=[...source.matchAll(/<button\b[^>]*>/g)].map(m=>m[0]).find(t=>t.includes('bindtap="'+handler+'"'));
 assert.ok(tag);assert.ok(tag.includes(cls));assert.ok(tag.includes('wx:if="{{'+condition+'}}"'));assert.ok(tag.includes('disabled="{{loading || (busy)}}"'));assert.ok(tag.includes('size="mini"'));
 const selector='.page button.ui-button.ui-compact.'+cls+'[size="mini"]';
 assert.ok(css.includes(selector+'{min-height:44px;min-width:44px;box-sizing:border-box}'));
 assert.match(global,/button\.ui-button\.ui-compact\[size="mini"\]\{min-height:72rpx/);
 // 静态级联：新选择器(0,5,1)严格高于共享compact(0,3,1)，且不存在更晚同选择器覆盖。
 assert.equal(css.split(selector).length,2);
 for(const width of [320,375,430])assert.ok(44>72*width/750,'此前rpx最小值在该宽度不足44px');
});
