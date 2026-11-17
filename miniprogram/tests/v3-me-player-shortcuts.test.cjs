const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const w=fs.readFileSync(path.join(__dirname,'../pages/me/index.wxml'),'utf8');
test('未关联球员不显示快捷区，关联球员仍保留四入口',()=>{
 const m=w.match(/<view wx:if="{{player}}" class="member-shortcuts">([\s\S]*?)<\/view><view wx:if="{{session.user.role==='admin'}}"/);assert.ok(m);
 const buttons=[...m[1].matchAll(/<button\b[^>]*>/g)].map(x=>x[0]);assert.equal(buttons.length,4);
 for(const handler of ['profile','matches','photos','tactics'])assert.ok(buttons.some(b=>b.includes('bindtap="'+handler+'"')));
 assert.equal((m[1].match(/wx:if="{{player}}"/g)||[]).length,2);
});
test('管理员管理权限和战术菜单保留，比赛Tab仍可到达',()=>{
 assert.match(w,/wx:if="{{session.user.role==='admin'}}" class="section management-section"/);
 assert.match(w,/wx:if="{{session.user.systemAdmin}}"[^>]*bindtap="systemAccounts"/);
 const account=w.slice(w.indexOf('class="section account-section"'));assert.match(account,/bindtap="tactics"/);
 const app=JSON.parse(fs.readFileSync(path.join(__dirname,'../app.json'),'utf8'));
 assert.ok(app.tabBar.list.some(x=>x.pagePath==='pages/schedule/index'));
});
