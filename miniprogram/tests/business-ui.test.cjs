const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function setup({defer=false}={}){
 let token='A',bridge;const timers=new Map(),commits=[],states=[],events=[];let timerId=0;
 const host={connect:b=>bridge=b,present:s=>states.push(s),clearInput:()=>events.push('clear')};
 const page={data:{untouched:42},_epoch:1,_generation:2,_viewEpoch:3,
  selectComponent:()=>host,setData(patch,callback){Object.assign(this.data,patch);if(callback){if(defer)commits.push(callback);else callback();}},
  onBusinessUiOpen(){events.push('open');},onBusinessUiClosed(){events.push('close');}};
 const sandbox={module:{exports:{}},require:id=>{if(id==='./picker-model')return require('../utils/picker-model');assert.equal(id,'./api');return{getSession:()=>token?{token}:null};},setTimeout:(fn)=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(fs.readFileSync(path.join(root,'utils/ui.js'),'utf8'),sandbox);
 return {ui:sandbox.module.exports,page,events,states,timers,commits,setToken:v=>token=v,
 confirm:value=>bridge.confirm(states.at(-1).modal.id,value),cancel:()=>bridge.cancel(states.at(-1).modal.id),detach:()=>bridge.detach()};
}
test('confirm retains callbacks and clears overlay before business guard',async()=>{
 const h=setup(),calls=[];
 const promise=h.ui.showModal(h.page,{title:'Save',success:r=>{assert.equal(h.page.data.businessUiBlocking,false);calls.push(r.confirm);},complete:()=>calls.push('complete')});
 assert.equal(h.page.data.untouched,42);assert.equal(h.page.data.businessUiBlocking,true);
 h.confirm('');assert.equal((await promise).confirm,true);assert.deepEqual(calls,[true,'complete']);assert.equal(h.page.data.businessUiBlocking,false);
});
test('queued modal runs callbacks after committed close, then opens next',async()=>{
 const h=setup({defer:true}),calls=[];
 const first=h.ui.showModal(h.page,{success:()=>{assert.equal(h.page.data.businessUiBlocking,false);calls.push('first');}});
 const second=h.ui.showModal(h.page,{success:()=>calls.push('second')});
 h.commits.shift()();h.confirm('');assert.deepEqual(calls,[]);
 h.commits.shift()();assert.deepEqual(calls,['first']);assert.equal(h.page.data.businessUiBlocking,true);
 h.commits.shift()();h.cancel();h.commits.shift()();await Promise.all([first,second]);assert.deepEqual(calls,['first','second']);
});
test('explicit cancel calls success(cancel) and complete, alert cannot mask-cancel',async()=>{
 const h=setup(),calls=[];const promise=h.ui.showModal(h.page,{success:r=>calls.push(r.cancel),complete:()=>calls.push('done')});
 h.cancel();await promise;assert.deepEqual(calls,[true,'done']);
 const alert=h.ui.showModal(h.page,{showCancel:false});h.cancel();assert.equal(h.page.data.businessUiBlocking,true);h.confirm();assert.equal((await alert).confirm,true);
});
test('hide/unload abort settles all promises without any stale callbacks',async()=>{
 const h=setup(),calls=[];const options={success:()=>calls.push('success'),complete:()=>calls.push('complete')};
 const a=h.ui.showModal(h.page,options),b=h.ui.showModal(h.page,options),toast=h.ui.showToast(h.page,{title:'Saved'});calls.length=0;
 h.page._hidden=true;h.ui.abort(h.page);
 for(const result of await Promise.all([a,b,toast]))assert.equal(result.aborted,true);
 assert.deepEqual(calls,[]);assert.equal(h.timers.size,0);assert.equal(h.page.data.businessUiBlocking,false);
});
test('session and generation changes suppress confirm and complete',async()=>{
 for(const mutate of [h=>h.setToken('B'),h=>h.page._epoch++,h=>h.page._generation++,h=>h.page._viewEpoch++]){
 const h=setup();let calls=0;const promise=h.ui.showModal(h.page,{success:()=>calls++,complete:()=>calls++});mutate(h);h.confirm();assert.equal((await promise).aborted,true);assert.equal(calls,0);
 }
});
test('abort during pending render commit never invokes navigation callback',async()=>{
 const h=setup({defer:true});let navigated=false;
 const promise=h.ui.showModal(h.page,{complete:()=>navigated=true});h.commits.shift()();h.confirm();
 h.page._hidden=true;h.ui.abort(h.page);h.commits.shift()();await promise;assert.equal(navigated,false);
});
test('toast timers and loading are isolated per-page and close explicitly',async()=>{
 const h=setup();const toast=h.ui.showToast(h.page,{title:'Saved',icon:'success',duration:500});
 assert.equal(h.states.at(-1).transient.icon,'success');[...h.timers.values()][0]();assert.equal((await toast).aborted,false);
 const loading=h.ui.showLoading(h.page,{title:'Working',mask:true});assert.equal(h.states.at(-1).transient.type,'loading');
 h.ui.hideToast(h.page);assert.equal(h.page.data.businessUiBlocking,true);h.ui.hideLoading(h.page);await loading;assert.equal(h.page.data.businessUiBlocking,false);
});
test('no host never falls back to native or navigates',async()=>{
 const h=setup();h.page.selectComponent=()=>null;let calls=0;
 const result=await h.ui.showModal(h.page,{complete:()=>calls++});assert.equal(result.aborted,true);assert.equal(calls,0);
});
test('component input is masked, bounded and removed on cancel/detach',()=>{
 let definition;vm.runInNewContext(fs.readFileSync(path.join(root,'components/business-dialog/index.js'),'utf8'),{Component:d=>definition=d});
 const component={...definition.methods,data:structuredClone(definition.data),setData(p){Object.assign(this.data,p);}};
 let value,detached=false;component.connect({confirm:(_,v)=>value=v,cancel:()=>component.clearInput(),detach:()=>detached=true});
 component.present({modal:{id:1,editable:true,password:true,value:'',maxlength:4},transient:null});
 component.input({detail:{value:'123456'}});assert.equal(component.data.inputValue,'1234');component.confirm();assert.equal(value,'1234');
 component.data.modal.showCancel=true;component.cancel();assert.equal(component.data.inputValue,'');assert.equal(component.data.inputFocus,false);
 definition.lifetimes.detached.call(component);assert.equal(detached,true);
});
test('component has accessible roles, input labels, keyboard confirmation and safe-area styles',()=>{
 const wxml=fs.readFileSync(path.join(root,'components/business-dialog/index.wxml'),'utf8'),css=fs.readFileSync(path.join(root,'components/business-dialog/index.wxss'),'utf8');
 for(const text of ['aria-role="dialog"','aria-role="alert"','aria-label=','bindconfirm="confirm"','password="{{modal.password}}"'])assert.ok(wxml.includes(text));
 assert.ok(css.includes('safe-area-inset-bottom'));assert.ok(css.includes('min-height:88rpx'));
});

test('unmasked toast does not hide canvas; masked loading does',async()=>{
 const h=setup();const t=h.ui.showToast(h.page,{title:'Saved'});
 assert.notEqual(h.page.data.businessUiBlocking,true);assert.equal(h.events.includes('open'),false);
 h.ui.hideToast(h.page);await t;
 const load=h.ui.showLoading(h.page,{title:'Working',mask:true});assert.equal(h.page.data.businessUiBlocking,true);
 h.ui.hideLoading(h.page);await load;assert.equal(h.page.data.businessUiBlocking,false);
});
test('modal Promise waits for committed unblock, and abort before commit resolves aborted',async()=>{
 const h=setup({defer:true});let resolved=false;
 const task=h.ui.showModal(h.page,{}).then(r=>{resolved=true;return r;});
 h.commits.shift()();h.confirm();await Promise.resolve();assert.equal(resolved,false);
 h.commits.shift()();const result=await task;assert.equal(result.confirm,true);assert.equal(h.page.data.businessUiBlocking,false);
 const second=h.ui.showModal(h.page,{});h.commits.shift()();h.confirm();h.ui.abort(h.page);h.commits.shift()();
 assert.equal((await second).aborted,true);
});

test('picker shares modal queue, returns typed value only after confirmation',async()=>{
 const h=setup();let done;
 const p=h.ui.showPicker(h.page,{mode:'selector',range:['A','B'],value:0}).then(r=>done=r);
 assert.equal(h.states.at(-1).modal.kind,'picker');assert.equal(done,undefined);
 h.confirm(1);await p;assert.equal(done.value,1);assert.equal(done.confirm,true);
 const cancel=h.ui.showPicker(h.page,{mode:'time',value:'09:30'});h.cancel();assert.equal((await cancel).cancel,true);
});
test('picker host preserves draft through unrelated toast render and confirms day with weekday',()=>{
 let definition;const model=require('../utils/picker-model');
 vm.runInNewContext(fs.readFileSync(path.join(root,'components/business-dialog/index.js'),'utf8'),{Component:d=>definition=d,require:()=>model});
 const component={...definition.methods,data:structuredClone(definition.data),setData(p){for(const [key,value]of Object.entries(p)){if(key==='modal.pickerState')this.data.modal.pickerState=value;else this.data[key]=value;}}};
 let result;component.connect({confirm:(_,v)=>result=v});
 const original={id:1,kind:'picker',pickerState:model.create({mode:'date',value:'2026-11-13'})};
 component.present({modal:structuredClone(original),transient:null});
 component.pickerOption({currentTarget:{dataset:{value:'2026-11-14'}}});
 assert.match(component.data.pickerSummary,/周六/);component.present({modal:structuredClone(original),transient:{title:'Info'}});
 assert.equal(component.data.modal.pickerState.draft,'2026-11-14');component.confirm();assert.equal(result,'2026-11-14');
 component.pickerYears();component.pickerYear({currentTarget:{dataset:{value:2028}}});
 assert.equal(component.data.modal.pickerState.viewYear,2028);assert.equal(component.data.modal.pickerState.draft,'2026-11-14');
});
test('picker lifecycle abort and invalid empty selection never emits confirmation',async()=>{
 const h=setup();const p=h.ui.showPicker(h.page,{range:['A']});h.page._hidden=true;h.ui.abort(h.page);assert.equal((await p).aborted,true);
 let definition;const model=require('../utils/picker-model');
 vm.runInNewContext(fs.readFileSync(path.join(root,'components/business-dialog/index.js'),'utf8'),{Component:d=>definition=d,require:()=>model});
 let confirmed=false;const component={...definition.methods,data:{modal:{id:1,kind:'picker',pickerState:model.create({range:[]})}},_bridge:{confirm:()=>confirmed=true}};
 component.confirm();assert.equal(confirmed,false);
});

test('time picker uses compact content height and explicit shrinkable action columns',()=>{
 let definition;
 vm.runInNewContext(fs.readFileSync(path.join(root,'components/business-dialog/index.js'),'utf8'),{Component:d=>definition=d});
 const height=definition.methods.bodySize({kind:'picker',pickerState:{mode:'time'}});
 assert.equal(height,432);
 assert.ok(height<definition.methods.bodySize({kind:'picker',pickerState:{mode:'date'}}));
 const css=fs.readFileSync(path.join(root,'components/business-dialog/index.wxss'),'utf8');
 assert.match(css,/\.buttons>button\{flex:1 1 0;width:0;min-width:0/);
 assert.match(css,/\.time-scroll\{flex:1 1 0;width:0;min-width:0/);
});

test('calendar and year controls explicitly override native button width without grid',()=>{
 const css=fs.readFileSync(path.join(root,'components/business-dialog/index.wxss'),'utf8');
 assert.match(css,/\.picker-panel button\.nav-step\{flex:0 0 64rpx;width:64rpx/);
 assert.match(css,/\.picker-panel button\.calendar-heading\{flex:1 1 0;width:0;min-width:0/);
 assert.match(css,/\.picker-panel \.calendar-grid\{display:flex;flex-wrap:wrap/);
 assert.ok(css.includes('width:calc(14.285714% - 8rpx)'));
 assert.ok(css.includes('width:calc(33.333333% - 10rpx)'));
 assert.match(css,/\.picker-panel \.year-grid\{display:flex;flex-wrap:wrap/);
});

test('mini calendar controls reset intrinsic padding and keep two-digit dates on one line',()=>{
 const css=fs.readFileSync(path.join(root,'components/business-dialog/index.wxss'),'utf8');
 const day=css.match(/\.dialog \.picker-panel \.calendar-grid button\.day\[size="mini"\]\{([^}]+)\}/)[1];
 for(const rule of ['padding:0','white-space:nowrap','word-break:normal','line-height:64rpx','max-height:64rpx','font-size:25rpx'])assert.ok(day.includes(rule),rule);
 for(const name of ['nav-step','calendar-heading','time-option'])assert.ok(css.includes('button.'+name+'[size="mini"]'));
 assert.ok(css.includes('.year-grid button.option[size="mini"]'));
});

test('selector initial anchor does not jump as draft changes or toast rerenders',()=>{
 let d;const model=require('../utils/picker-model');
 vm.runInNewContext(fs.readFileSync(path.join(root,'components/business-dialog/index.js'),'utf8'),{Component:x=>d=x,require:()=>model});
 const c={...d.methods,data:structuredClone(d.data),setData(p){for(const[k,v]of Object.entries(p)){if(k==='modal.pickerState')this.data.modal.pickerState=v;else this.data[k]=v;}}};
 const modal={id:4,kind:'picker',pickerState:model.create({mode:'selector',range:Array.from({length:30},(_,i)=>'Option '+i),value:20})};
 c.present({modal,transient:null});assert.equal(c.data.selectorAnchor,'picker-option-20');
 c.pickerOption({currentTarget:{dataset:{value:25}}});assert.equal(c.data.modal.pickerState.draft,25);assert.equal(c.data.selectorAnchor,'picker-option-20');
 c.present({modal,transient:{title:'Info'}});assert.equal(c.data.modal.pickerState.draft,25);assert.equal(c.data.selectorAnchor,'picker-option-20');
 const w=fs.readFileSync(path.join(root,'components/business-dialog/index.wxml'),'utf8');assert.ok(w.includes('class="selection-mark'));assert.ok(w.includes('scroll-into-view="{{selectorAnchor}}"'));
});
test('picker accessibility combines semantic title and current value',()=>{
 let d;vm.runInNewContext(fs.readFileSync(path.join(root,'components/business-picker/index.js'),'utf8'),{Component:x=>d=x,require:()=>({})});
 const c={properties:{mode:'selector',title:'Position',value:1,range:['A','B']},setData(p){this.data=p;}};
 d.methods.updateLabel.call(c);assert.ok(c.data.defaultLabel.includes('Position'));assert.ok(c.data.defaultLabel.includes('B'));
});

test('superseded unblock waits for masked loading close before settling and pumping',async()=>{
 const h=setup({defer:true});let resolved=false;const calls=[];
 const first=h.ui.showModal(h.page,{success:()=>{assert.equal(h.page.data.businessUiBlocking,false);calls.push('first');}}).then(r=>{resolved=true;return r;});
 h.commits.shift()();h.confirm();
 const loading=h.ui.showLoading(h.page,{mask:true});
 const second=h.ui.showModal(h.page,{});
 while(h.commits.length)h.commits.shift()();
 await Promise.resolve();assert.equal(resolved,false);assert.deepEqual(calls,[]);
 assert.equal(h.states.at(-1).modal,null);
 h.ui.hideLoading(h.page);await loading;
 await Promise.resolve();assert.equal(resolved,false);
 h.commits.shift()();assert.equal((await first).confirm,true);assert.deepEqual(calls,['first']);
 assert.ok(h.states.at(-1).modal);
 h.commits.shift()();h.cancel();h.commits.shift()();assert.equal((await second).cancel,true);
});
for(const reason of ['hide','unload','account'])test('superseded settlement aborts safely on '+reason,async()=>{
 const h=setup({defer:true});let calls=0;
 const first=h.ui.showModal(h.page,{success:()=>calls++,complete:()=>calls++});
 h.commits.shift()();h.confirm();h.ui.showLoading(h.page,{mask:true});
 if(reason==='account')h.setToken('B');
 else {if(reason==='hide')h.page._hidden=true;else h.page._disposed=true;h.ui.abort(h.page);}
 while(h.commits.length)h.commits.shift()();
 if(reason==='account'){h.ui.hideLoading(h.page);while(h.commits.length)h.commits.shift()();}
 assert.equal((await first).aborted,true);assert.equal(calls,0);
});
test('unblock hook may reblock without prematurely executing settlement',async()=>{
 const h=setup({defer:true});let once=true,called=0;
 h.page.onBusinessUiClosed=()=>{if(once){once=false;h.ui.showLoading(h.page,{mask:true});}};
 const task=h.ui.showModal(h.page,{success:()=>called++});h.commits.shift()();h.confirm();
 while(h.commits.length)h.commits.shift()();assert.equal(called,0);
 h.ui.hideLoading(h.page);while(h.commits.length)h.commits.shift()();
 assert.equal((await task).confirm,true);assert.equal(called,1);
});
