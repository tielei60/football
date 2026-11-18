const {runPage}=require('./ui-fixture.cjs');
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function setup(options={}){let definition;let token='owner';const calls=[],storage=options.storage||new Map();const shared={api:{getSession:()=>({token,serverOrigin:'https://club.example',user:{id:1},team:{id:1}}),request:async(...a)=>{calls.push(a);if(options.fail)throw options.fail;return options.venue||{id:1};}},load:async(page,work)=>page.setData(await work({user:{role:'admin'}})),unload(){this._disposed=true;},fail(){}};const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),showToast(){},navigateBack(){calls.push(['back']);},showModal(o){o.success({confirm:true});}};
const location={...require('../utils/location'),choose:async()=>options.choice??null,open:async()=>{}};
runPage(fs.readFileSync(path.join(__dirname,'../pages/manage-venue/index.js'),'utf8'),{Page(d){definition=d;},require(n){return n.includes('location')?location:shared;},wx,Promise,Error});
const page={...definition,data:structuredClone(definition.data),_ownerToken:'owner',setData(p){Object.assign(this.data,p);}};page.data.form.name='测试球场';return {page,calls,newPage(){return {...definition,data:structuredClone(definition.data),setData:page.setData}},setToken(v){token=v;}};}
test('venue create locks uncertain submission and does not automatically retry',async()=>{const {page,calls}=setup({fail:Object.assign(new Error('offline'),{status:0})});await page.save();assert.equal(page.data.uncertain,true);await page.save();assert.equal(calls.length,1);});
test('venue conflict keeps form, and account switch blocks stale draft',async()=>{const {page}=setup({fail:Object.assign(new Error('conflict'),{status:409})});page.id=1;await page.save();assert.equal(page.data.conflict,true);assert.equal(page.data.form.name,'测试球场');const other=setup();other.setToken('different');await other.page.save();assert.equal(other.calls.length,0);assert.equal(other.page.data.conflict,true);});
test('cancelled map picker leaves previous venue untouched',async()=>{const {page}=setup();const before=JSON.stringify(page.data.form);await page.choose();assert.equal(JSON.stringify(page.data.form),before);assert.equal(page.data.busy,false);});

test('venue unknown creation survives page unload and reentry for same login only',async()=>{const h=setup({fail:Object.assign(new Error('offline'),{status:0})});await h.page.save();h.page.onUnload();const next=h.newPage();await next.refresh();assert.equal(next.data.uncertain,true);assert.equal(next.data.form.name,'测试球场');h.setToken('new-login');const changed=h.newPage();await changed.refresh();assert.equal(changed.data.uncertain,true);});

// 原生选点仅使用替身，不调用位置权限或实际地图服务。
test('venue loaded and chosen markers have explicit pixel sizes; clear removes them',async()=>{
 const venue={name:'匿名球场',address:'测试',latitude:0,longitude:0,coordinateSystem:'gcj02',revision:1,status:'active'};
 const h=setup({venue,choice:{...venue,latitude:30,longitude:120}});h.page.id=1;await h.page.refresh();
 assert.deepEqual(h.page.data.markers,[{id:1,latitude:0,longitude:0,title:venue.name,width:24,height:32}]);
 await h.page.choose();assert.equal(h.page.data.markers[0].latitude,30);assert.equal(h.page.data.markers[0].width,24);assert.equal(h.page.data.markers[0].height,32);
 h.page.clear();assert.equal(h.page.data.markers.length,0);
});
test('venue with invalid stored coordinates has no marker',async()=>{const h=setup({venue:{name:'匿名',latitude:null,longitude:120,coordinateSystem:'gcj02'}});h.page.id=1;await h.page.refresh();assert.equal(h.page.data.markers.length,0);});
test('editing and choosing a map position preserves the field number in the saved venue',async()=>{const venue={name:'球场',fieldNumber:'A',address:'地址',latitude:30,longitude:120,coordinateSystem:'gcj02',revision:1,status:'active'};const h=setup({venue,choice:{name:'球场',address:'新地址',latitude:31,longitude:121,coordinateSystem:'gcj02'}});h.page.id=1;await h.page.refresh();assert.equal(h.page.data.form.fieldNumber,'A');await h.page.choose();await h.page.save();assert.equal(h.calls[1][2].fieldNumber,'A');});
