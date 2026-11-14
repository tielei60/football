// 使用真实页面定义和延迟 nextTick/selector 回调，不代替原生合成器实测。
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../pages/tactic-compose/index.js'),'utf8');
function harness(){
 let definition,token='fictional-owner';const ticks=[],queries=[],prepared=[],painted=[];
 const canvas={prepareSurface(node){prepared.push(node);return{}},draw(){},scene(){return{pieces:[]}}};
 const api={getSession:()=>({token}),ensureSession:()=>new Promise(()=>{})};
 const wx={nextTick:f=>ticks.push(f),getWindowInfo:()=>({windowWidth:375,windowHeight:700,pixelRatio:3}),createSelectorQuery(){return{in(){return this},select(){return this},fields(){return this},exec(f){queries.push(f)}}}};
 vm.runInNewContext(source,{Page:p=>definition=p,wx,require:id=>id.includes('tactic-canvas')?canvas:id.endsWith('/ui')?{abort(){}}:id.endsWith('/shared')?{api}:id.includes('tactic-editor')?{clone:x=>x}:{}});
 const p={...definition,data:{...definition.data,loading:false,hasDemo:true,focusCanvas:false,tab:0,stageTitle:'未应用标题'},_model:{board:{demonstration:{participants:[],stages:[]}}},_commands:[{type:'sentinel'}],_undo:[{}],_owner:token,_generation:1,_hidden:false,_disposed:false,setData(x,cb){Object.assign(this.data,x);cb?.()},paint(){if(this._ctx)painted.push(this._ctx)}};
 const oldNode={id:'old'};const tick=()=>{while(ticks.length)ticks.shift()();};const respond=(node=oldNode)=>{let guard=0;while(queries.length){assert.ok(++guard<10);queries.shift()([{node,top:150}]);}};
 return{p,ticks,queries,prepared,painted,tick,respond,oldNode,setToken:v=>token=v};
}
for(const queued of ['nextTick','selector'])test('hide/show rejects old '+queued+' while session restoration pending',()=>{const h=harness(),p=h.p,model=p._model,commands=p._commands,undo=p._undo;p.draw();if(queued==='selector')h.tick();p.onHide();p.onShow();h.tick();h.respond();assert.equal(h.prepared.length,0);assert.equal(h.painted.length,0);assert.equal(p._model,model);assert.equal(p._commands,commands);assert.equal(p._undo,undo);assert.equal(p.data.stageTitle,'未应用标题');assert.equal(p._rect,null);});
test('hide/show ABA rejects old selector after loading has already cleared',()=>{const h=harness();h.p.draw();h.tick();h.p.onHide();h.p._hidden=false;h.p.setData({loading:false});h.respond();assert.equal(h.prepared.length,0);});
test('tab away and back invalidates old selector without dropping drafts',()=>{const h=harness(),p=h.p,commands=p._commands,undo=p._undo;const event=v=>({currentTarget:{dataset:{key:'tab'}},detail:{value:v}});p.sync=()=>{};p.resize=()=>{};p.leaveGuard=()=>{};p.draw();h.tick();p.performSelect(event(1));p.performSelect(event(0));h.respond();assert.equal(h.prepared.length,0);assert.equal(p._commands,commands);assert.equal(p._undo,undo);assert.equal(p.data.stageTitle,'未应用标题');h.tick();h.respond({id:'new'});assert.equal(h.prepared.length,1);assert.equal(h.prepared[0].id,'new');});
for(const state of [{loading:true},{tab:1},{hasDemo:false}])test('late measurement checks current conditional canvas state '+JSON.stringify(state),()=>{const h=harness();h.p.draw();h.tick();Object.assign(h.p.data,state);h.respond();assert.equal(h.prepared.length,0);});
test('account switch blocks old node',()=>{const h=harness();h.p.draw();h.tick();h.setToken('new-owner');h.respond();assert.equal(h.prepared.length,0);});
test('refresh invalidates old surface before awaiting session',()=>{const h=harness();h.p.draw();h.tick();h.p.refresh();h.respond();assert.equal(h.prepared.length,0);assert.equal(h.p._ctx,null);});
test('unload rejects pending node; normal draw still paints',()=>{const h=harness();h.p.draw();h.tick();h.respond();assert.equal(h.prepared.length,1);assert.equal(h.painted.length,1);h.p.draw();h.tick();h.p.onUnload();h.respond();assert.equal(h.prepared.length,1);assert.equal(h.p._rect,null);});
