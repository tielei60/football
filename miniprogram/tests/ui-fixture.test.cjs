const test=require('node:test'),assert=require('node:assert/strict');
const {uiBridge}=require('./ui-fixture.cjs');
test('page fixture UI bridge retains cancellation rather than auto-confirming',()=>{let result;const ui=uiBridge({showModal:o=>o.success({confirm:false,cancel:true})});ui.showModal({}, {success:r=>result=r});assert.deepEqual(result,{confirm:false,cancel:true});});
test('page fixture UI bridge retains deferred callbacks and supplied toast recorder',()=>{let pending,result,toast;const ui=uiBridge({showModal:o=>pending=o,showToast:o=>toast=o});ui.showModal({}, {success:r=>result=r});assert.equal(result,undefined);pending.success({confirm:true});assert.equal(result.confirm,true);ui.showToast({}, {title:'saved'});assert.equal(toast.title,'saved');});
test('page fixture must explicitly supply modal behavior',()=>{assert.throws(()=>uiBridge({}).showModal({},{}),/supply modal/);});
