const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
function setup(wx){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../utils/location.js'),'utf8'),{module,wx,Promise,Error,Number});return module.exports;}
test('native map coordinates require explicit GCJ02 and finite paired coordinates',()=>{
 const l=setup({});assert.equal(l.point({latitude:0,longitude:0,coordinateSystem:'gcj02'}),true);
 for(const p of [{latitude:1,longitude:2},{latitude:NaN,longitude:2,coordinateSystem:'gcj02'},{latitude:91,longitude:2,coordinateSystem:'gcj02'},{latitude:null,longitude:2,coordinateSystem:'gcj02'}])assert.ok(!l.point(p));
});
test('location cancel preserves selection, denial never invokes picker, no automatic current-location call',async()=>{
 let picks=0;const l=setup({requirePrivacyAuthorize(o){o.success();},chooseLocation(o){picks++;o.fail({errMsg:'chooseLocation:fail cancel'});}});assert.equal(await l.choose(),null);assert.equal(picks,1);
 const denied=setup({requirePrivacyAuthorize(o){o.fail();},chooseLocation(){throw new Error('must not pick');}});await assert.rejects(denied.choose(),/隐私授权/);
});
test('native map forwards valid picker result and openLocation receives only selected venue',async()=>{
 let opened;const l=setup({chooseLocation(o){o.success({name:'测试球场',address:'虚构地址',latitude:30,longitude:120});},openLocation(o){opened=o;o.success();}});
 const selected=await l.choose();assert.equal(selected.coordinateSystem,'gcj02');await l.open(selected);assert.equal(opened.latitude,30);assert.equal(opened.name,'测试球场');await assert.rejects(l.open({}),/尚未设置/);
});
