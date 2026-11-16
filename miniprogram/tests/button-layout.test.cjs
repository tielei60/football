const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
test('match management actions retain handlers, permissions and bounded touch targets',()=>{
 const w=read('pages/match-detail/index.wxml'), css=read('pages/match-detail/index.wxss');
 for(const h of ['openLocation','edit','rosterEdit','media']){
  const tag=[...w.matchAll(/<button\b[^>]*>/g)].find(m=>m[0].includes('bindtap="'+h+'"'))?.[0];
  assert.ok(tag,h);assert.ok(tag.includes('size="mini"'),h);
 }
 assert.match(w,/<view wx:if="{{admin}}" class="match-management">/);
 assert.match(css,/match-management-button\[size="mini"\],[^}]*match-media-button\[size="mini"\]\{[^}]*min-height:88rpx/);
 assert.match(css,/fact-navigation\[size="mini"\]\{[^}]*min-height:88rpx/);
});
test('schedule create is admin-only after tabs, full-width with at least 44px touch height',()=>{
 const w=read('pages/schedule/index.wxml'),css=read('pages/schedule/index.wxss');
 assert.match(w,/<view wx:if="{{admin}}" class="schedule-admin-action"><button disabled="{{loading}}" class="ui-button ui-block schedule-create" bindtap="create" size="mini">/);
 const tabs=w.indexOf('class="tabs"'),create=w.indexOf('class="schedule-admin-action"');assert.ok(tabs>=0&&create>tabs);
 assert.match(css,/button\.schedule-create\[size="mini"\]\{min-height:44px;width:100%;margin:0/);
});
test('all ordinary page buttons use explicit sizing while tactical and map controls retain scoped sizing',()=>{
 const excluded=new Set(['tactic-board','tactic-compose','tactic-setup','manage-venue']);
 for(const dir of fs.readdirSync(path.join(root,'pages'))){
  if(excluded.has(dir))continue;const file=path.join(root,'pages',dir,'index.wxml');if(!fs.existsSync(file))continue;
  for(const m of fs.readFileSync(file,'utf8').matchAll(/<button\b[^>]*>/g)){const scoped=dir==='match-detail'&&m[0].includes('class="fact-navigation"');assert.ok(scoped||m[0].includes('ui-button'),dir);assert.ok(m[0].includes('size="mini"'),dir);}
 }
 const css=read('app.wxss');
 assert.ok(css.includes('.page .actions>button.ui-button[size="mini"]{flex:1 1 0;width:0'));
 assert.ok(css.includes('.page .management-grid>button.ui-button[size="mini"]'));
 assert.ok(read('pages/tactic-board/index.wxss').includes('.page .edit-actions>button.edit-action{flex:1 1 0;width:0'));
});
test('match location is shown as text and navigation uses only a validated snapshot',()=>{
 const w=read('pages/match-detail/index.wxml');
 assert.doesNotMatch(w,/<map\b/);
 const tag=[...w.matchAll(/<button\b[^>]*>/g)].find(m=>m[0].includes('bindtap="openLocation"'))?.[0];
 assert.ok(tag);assert.ok(tag.includes('wx:if="{{venueLocation.valid}}"'));
 assert.equal((w.match(/bindtap="openLocation"/g)||[]).length,1);
 assert.ok(w.includes('{{venueLocation.message}}'));
});
