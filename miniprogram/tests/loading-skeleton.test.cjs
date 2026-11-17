const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function definition(name){let d;vm.runInNewContext(fs.readFileSync(path.join(root,'components',name,'index.js'),'utf8'),{Component:x=>d=x});return d;}
test('skeleton variants are bounded, static by default, and accept all page-state types',()=>{
 const d=definition('loading-skeleton');assert.equal(d.properties.animated.value,false);
 for(const type of ['list','form','detail','cards','bad']){
  const c={data:{type,rows:100},setData(p){Object.assign(this.data,p);}};
  d.methods.rebuild.call(c);assert.equal(c.data.items.length,8);assert.equal(c.data.variant,type==='bad'?'list':type);
 }
 const c={data:{type:'list',rows:-10},setData(p){Object.assign(this.data,p);}};d.methods.rebuild.call(c);assert.equal(c.data.items.length,1);
});
test('page-state preserves loading priority and retry while delegating skeleton',()=>{
 const w=fs.readFileSync(path.join(root,'components/page-state/index.wxml'),'utf8');
 assert.match(w,/loading-skeleton wx:if="{{loading}}"/);assert.match(w,/wx:elif="{{error}}"/);assert.match(w,/wx:elif="{{empty}}"/);
 const d=definition('page-state');let events=0;
 const c={data:{loading:true},triggerEvent(e){assert.equal(e,'retry');events++;}};
 d.methods.retry.call(c);assert.equal(events,0);c.data.loading=false;d.methods.retry.call(c);assert.equal(events,1);
 assert.equal(d.properties.skeletonType.value,'list');
});
test('skeleton hides decorative blocks from accessibility and respects reduced motion',()=>{
 const w=fs.readFileSync(path.join(root,'components/loading-skeleton/index.wxml'),'utf8'),css=fs.readFileSync(path.join(root,'components/loading-skeleton/index.wxss'),'utf8');
 assert.ok(w.includes('aria-role="status"'));assert.ok(w.includes('aria-busy="true"'));assert.ok(w.includes('aria-hidden="true"'));
 assert.ok(css.includes('prefers-reduced-motion:reduce'));assert.ok(css.includes('pointer-events:none'));
});
test('component buttons opt out of native default width; shared actions are shrinkable',()=>{
 for(const component of ['business-dialog','business-picker','page-state']){
 const w=fs.readFileSync(path.join(root,'components',component,'index.wxml'),'utf8');
 for(const m of w.matchAll(/<button\b[^>]*>/g)){
  // picker 的 slot 必须铺满可用列；原生 mini 会额外收窄内部宽度。
  if(component==='business-picker' && m[0].includes('bindtap="open"')){
   assert.ok(!m[0].includes('size="mini"'));
   const pickerCss=fs.readFileSync(path.join(root,'components',component,'index.wxss'),'utf8');
   assert.match(pickerCss,/\.trigger\s*\{[^}]*width:\s*100%/);
   assert.match(pickerCss,/\.trigger\s*\{[^}]*padding:\s*0/);
  }else assert.ok(m[0].includes('size="mini"'),component);
 }
 }
 const css=fs.readFileSync(path.join(root,'app.wxss'),'utf8');
 assert.ok(css.includes('.actions>button{flex:1 1 0;width:0;min-width:0'));
 assert.match(css,/\.filter-row\s*>\s*business-picker\{flex:1 1 0;width:0;min-width:0/);
});
