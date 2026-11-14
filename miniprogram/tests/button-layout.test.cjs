const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
test('match management actions retain handlers and permissions with full-width separated controls',()=>{
 const w=read('pages/match-detail/index.wxml');
 for(const h of ['openLocation','edit','rosterEdit','media']){
  const tag=[...w.matchAll(/<button\b[^>]*>/g)].find(m=>m[0].includes('bindtap="'+h+'"'))?.[0];
  assert.ok(tag,h);assert.ok(tag.includes('ui-block'),h);assert.ok(tag.includes('size="mini"'),h);
  if(['edit','rosterEdit'].includes(h))assert.ok(tag.includes('wx:if="{{admin}}"'));
 }
 assert.match(read('app.wxss'),/button\.ui-button\.ui-block\[size="mini"\]\{width:100%;margin-top:16rpx/);
});
test('schedule create button uses bounded content height and no inherited native fixed width',()=>{
 const w=read('pages/schedule/index.wxml'),css=read('pages/schedule/index.wxss');
 assert.match(w,/class="small primary no-wrap ui-button ui-compact"/);
 assert.ok(css.includes('min-width:148rpx;min-height:76rpx;padding:18rpx 22rpx;line-height:1.4;white-space:nowrap'));
});
test('all ordinary page buttons use explicit sizing while tactical and map controls retain scoped sizing',()=>{
 const excluded=new Set(['tactic-board','tactic-compose','tactic-setup','manage-venue']);
 for(const dir of fs.readdirSync(path.join(root,'pages'))){
  if(excluded.has(dir))continue;const file=path.join(root,'pages',dir,'index.wxml');if(!fs.existsSync(file))continue;
  for(const m of fs.readFileSync(file,'utf8').matchAll(/<button\b[^>]*>/g)){assert.ok(m[0].includes('ui-button'),dir);assert.ok(m[0].includes('size="mini"'),dir);}
 }
 const css=read('app.wxss');
 assert.ok(css.includes('.page .actions>button.ui-button[size="mini"]{flex:1 1 0;width:0'));
 assert.ok(css.includes('.page .management-grid>button.ui-button[size="mini"]'));
 assert.ok(read('pages/tactic-board/index.wxss').includes('.page .edit-actions>button.edit-action{flex:1 1 0;width:0'));
});
test('match map appears only with a validated snapshot and yields to business dialogs',()=>{
 const w=read('pages/match-detail/index.wxml');
 assert.ok(w.includes('wx:if="{{venueLocation.valid}}"'));
 assert.ok(w.includes('hidden="{{businessUiBlocking}}"'));
 assert.ok(w.includes('latitude="{{venueLocation.latitude}}"'));
 assert.ok(w.includes('show-location="{{false}}"'));
 assert.equal((w.match(/bindtap="openLocation"/g)||[]).length,1);
 assert.ok(w.includes('{{venueLocation.message}}'));
 assert.ok(read('pages/match-detail/index.wxss').includes('height:460rpx'));
});
