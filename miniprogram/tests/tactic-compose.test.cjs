const {runPage}=require('./ui-fixture.cjs');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');const model=require('../utils/tactic-compose');
const board=()=>({pieces:[{pieceId:0,kind:'player',x:200,y:300,label:'一号',shirtNumber:0,playerId:'roster-1',unknown:7},{pieceId:'ball',kind:'ball',x:400,y:500}],markings:[{kind:'text',custom:'keep'}],unknown:{keep:true}});
function demo(){let b=model.apply(board(),{type:'init-demonstration',demonstrationId:'demo'});b.demonstration.extra=1;b.demonstration.stages[0].future=2;return model.apply(b,{type:'add-stage',afterStage:0,stage:{title:'推进'}});}
test('composition initializes and copies stages preserving future fields, independent participants and snapshots',()=>{const b=board(),next=model.apply(b,{type:'init-demonstration',demonstrationId:'d'});assert.equal(next.demonstration.participants[0].pieceId,0);assert.equal(b.demonstration,undefined);let d=demo();assert.equal(d.demonstration.stages[1].future,2);d=model.apply(d,{type:'move-participant',stageNumber:1,pieceId:0,x:600,y:300});assert.equal(d.demonstration.stages[0].positions[0].x,200);assert.equal(d.pieces[0].x,200);assert.equal(d.unknown.keep,true);});
test('insert/delete reindexes only affected routes and preserves unrelated custom run data',()=>{let d=demo();d=model.apply(d,{type:'add-stage',afterStage:1});d=model.apply(d,{type:'set-run',fromStage:1,pieceId:0,bend:{x:500,y:300}});d.demonstration.runs[0].extra=1;d=model.apply(d,{type:'add-stage',afterStage:0});assert.equal(d.demonstration.runs[0].fromStage,2);assert.equal(d.demonstration.runs[0].extra,1);d=model.apply(d,{type:'delete-stage',stageNumber:0});assert.equal(d.demonstration.runs[0].fromStage,1);d=model.apply(d,{type:'delete-stage',stageNumber:1});assert.equal(d.demonstration.runs.length,0);assert.deepEqual(d.demonstration.stages.map(s=>s.stageNumber),[0,1]);});
test('attributes preserve identity, clearing zero number omits property and targets remain independent',()=>{let d=demo();const patch=model.piecePatch(d.pieces[0],{label:'改名',shirtNumber:'',position:'GK'});assert.equal(patch.shirtNumber,null);d=model.apply(d,{type:'update-piece',pieceId:0,patch});assert.equal('shirtNumber'in d.pieces[0],false);assert.equal(d.pieces[0].playerId,'roster-1');assert.equal(d.demonstration.participants[0].label,'一号');assert.equal(d.demonstration.participants[0].shirtNumber,0);assert.throws(()=>model.piecePatch(d.pieces[0],{label:'',position:'',shirtNumber:'1.5'}),/整数/);});
const source=fs.readFileSync(path.join(__dirname,'../pages/tactic-compose/index.js'),'utf8');
function fixture(request,role='admin',modalReply=()=>({confirm:true})){let def;const calls=[],guards=[];let token='private';const api={getSession:()=>({token}),ensureSession:async()=>({user:{role}}),request:async(...args)=>{calls.push(args);return request?request(...args):{tactic:{title:'测试',board:demo()},version:'a'};}};runPage(source,{Page:d=>def=d,require:p=>p==='../shared'?{api,fail:(p,e)=>p.setData({error:e.message})}:require(p.replace('../../utils/','../utils/')),wx:{showModal:o=>o.success(modalReply()),showToast(){},enableAlertBeforeUnload(){guards.push(true)},disableAlertBeforeUnload(){guards.push(false)},getWindowInfo:()=>({windowWidth:372,windowHeight:700})},Date,JSON,Number,Math,encodeURIComponent});const p={...def,data:structuredClone(def.data),setData(d,cb){Object.assign(this.data,d);cb?.();},draw(){},paint(){}};p.onLoad({id:'1'});return{p,calls,guards,setToken:t=>token=t};}
test('page stage add, move, curve and metadata form sequential commands preserving canonical indices',async()=>{const f=fixture();await f.p.onShow();f.p.addStage();assert.equal(f.p.data.stageIndex,1);f.p.setData({stageTitle:'三角配合',duration:5});f.p.applyStage();f.p.setData({toolIndex:1,canvasWidth:826,canvasHeight:1250});f.p.touchStart({touches:[{x:526,y:200}]});f.p.touchMove({touches:[{x:426,y:300}]});f.p.touchEnd();assert.equal(f.p._commands[2].type,'move-participant');assert.equal(f.p._commands[2].pieceId,0);assert.equal(f.p._model.board.demonstration.stages[1].positions[0].x,300);await f.p.save();const write=f.calls.find(c=>c[1]==='PUT');assert.equal(write[2].commands.length,3);assert.equal(write[2].version,'a');assert.equal(JSON.stringify(f.p.data).includes('private'),false);});
test('page rejects player and historical editing; unknown save locks; late response cannot replace refreshed state',async()=>{const denied=fixture(null,'player');await denied.p.onShow();assert.match(denied.p.data.error,/管理员/);assert.equal(denied.calls.length,0);const historical=fixture();historical.p.query={id:'1',matchId:'1'};await historical.p.refresh();assert.match(historical.p.data.error,/历史/);let resolve;const f=fixture(async(url,method)=>method==='PUT'?new Promise(r=>resolve=r):{tactic:{title:'fresh',board:demo()},version:'a'});await f.p.onShow();f.p.addStage();const pending=f.p.save();await f.p.refresh();resolve({tactic:{title:'late',board:demo()},version:'old'});await pending;assert.equal(f.p._model.title,'fresh');const failed=fixture(async(url,method)=>{if(method==='PUT')throw Object.assign(Error('offline'),{status:0});return{tactic:{title:'x',board:demo()},version:'a'};});await failed.p.onShow();failed.p.addStage();await failed.p.save();await failed.p.save();assert.equal(failed.calls.filter(c=>c[1]==='PUT').length,1);assert.equal(failed.p.data.conflict,true);});
test('cancelled phase drag does not enqueue; different login cannot commit retained data',async()=>{const f=fixture();await f.p.onShow();f.p.setData({toolIndex:1,canvasWidth:826,canvasHeight:1250});f.p.touchStart({touches:[{x:526,y:200}]});f.p.touchMove({touches:[{x:426,y:300}]});f.p.touchCancel();assert.equal(f.p._commands.length,0);assert.equal(f.p._model.board.demonstration.stages[0].positions[0].x,200);f.setToken('other');f.p.addStage();assert.equal(f.p._commands.length,0);});
test('invalid stage title and missing curve endpoints never poison local commands',async()=>{const f=fixture();await f.p.onShow();f.p.setData({stageTitle:'x'.repeat(61)});f.p.applyStage();assert.equal(f.p._commands.length,0);assert.match(f.p.data.actionError,/60/);let d=demo();d.demonstration.stages[1].positions=[];assert.throws(()=>model.apply(d,{type:'set-run',fromStage:0,pieceId:0,bend:{x:400,y:200}}),/同时出现/);});
test('attribute scope excludes ball and form drafts cannot be silently discarded by mutations',async()=>{const f=fixture();await f.p.onShow();f.p.select({currentTarget:{dataset:{key:'tab'}},detail:{value:1}});assert.equal(f.p.data.players.length,1);f.p.setData({label:'未应用名称'});f.p.addStage();assert.equal(f.p._commands.length,0);assert.match(f.p.data.actionError,/先应用/);f.p.applyPlayer();assert.equal(f.p._commands[0].type,'update-piece');assert.equal(f.p._model.board.demonstration.participants[0].label,'一号');});
test('local composition and server commands produce identical canonical models including future fields',async()=>{const {applyTacticCommands}=await import('../../server/native-tactic-commands.mjs');const {tacticVersion}=await import('../../server/tactic-version.mjs');let current={title:'Parity',board:board()};const commands=[{type:'init-demonstration',demonstrationId:'d',title:'战术演示'},{type:'add-stage',afterStage:0,stage:{title:'推进',durationSeconds:4}},{type:'move-participant',stageNumber:1,pieceId:0,x:600,y:500},{type:'set-run',fromStage:0,pieceId:0,bend:{x:300,y:600}},{type:'update-stage',stageNumber:1,patch:{title:'完成',durationSeconds:5}},{type:'update-piece',pieceId:0,patch:{label:'前场',shirtNumber:null}},{type:'update-participant',pieceId:0,patch:{label:'演示前场'}},{type:'add-stage',afterStage:0},{type:'delete-stage',stageNumber:1}];let local=current.board;for(const c of commands)local=model.apply(local,c);const store={getTactic:()=>current,saveTactic:(id,{tactic})=>tactic};const result=applyTacticCommands(store,1,{version:tacticVersion(current),commands});assert.deepEqual(local,result.tactic.board);});

test('unapplied stage and player inputs enable exit guard and clearing to source clears it',async()=>{const f=fixture();await f.p.onShow();const old=f.p.data.stageTitle;f.p.input({currentTarget:{dataset:{key:'stageTitle'}},detail:{value:'draft'}});assert.equal(f.guards.at(-1),true);assert.equal(f.p._commands.length,0);f.p.input({currentTarget:{dataset:{key:'stageTitle'}},detail:{value:old}});assert.equal(f.guards.at(-1),false);f.p.select({currentTarget:{dataset:{key:'tab'}},detail:{value:1}});f.p.input({currentTarget:{dataset:{key:'shirtNumber'}},detail:{value:'99'}});assert.equal(f.guards.at(-1),true);assert.equal(f.p._commands.length,0);});
test('late phase touch after unload is ignored safely',async()=>{const f=fixture();await f.p.onShow();f.p.setData({toolIndex:1,canvasWidth:826,canvasHeight:1250});f.p.touchStart({touches:[{x:526,y:200}]});f.p.touchMove({touches:[{x:426,y:300}]});f.p.onUnload();assert.doesNotThrow(()=>f.p.touchEnd());assert.equal(f.p._model,null);});

for(const state of ['loading','error'])test('编排'+state+'期间旧输入拖动命令保存均忽略，重载完成可继续编辑',async()=>{
 let mode='ok',finish;const f=fixture(async(url,method)=>{if(method==='PUT')throw Error('本测试不应写服务器');if(mode==='loading')return new Promise(r=>finish=r);if(mode==='error')throw Error('重载失败');return {tactic:{title:'测试',board:demo()},version:'a'};});await f.p.onShow();f.p.addStage();mode=state;const pending=f.p.refresh();await new Promise(r=>setImmediate(r));if(state==='error')await pending;
 const before=JSON.stringify(f.p._model),commands=f.p._commands.length,title=f.p.data.stageTitle;f.p.input({currentTarget:{dataset:{key:'stageTitle'}},detail:{value:'旧输入'}});f.p.setData({toolIndex:1,canvasWidth:826,canvasHeight:1250});f.p.touchStart({touches:[{x:526,y:200}]});f.p.touchMove({touches:[{x:426,y:300}]});f.p.touchEnd();f.p.commit({type:'add-stage',afterStage:0});await f.p.save();
 assert.equal(f.p.allowed(),false);assert.equal(f.p.data.stageTitle,title);assert.equal(JSON.stringify(f.p._model),before);assert.equal(f.p._commands.length,commands);assert.equal(f.calls.filter(x=>x[1]==='PUT').length,0);
 mode='ok';if(state==='loading'){finish({tactic:{title:'恢复',board:demo()},version:'b'});await pending;}else await f.p.refresh();assert.equal(f.p.allowed(),true);f.p.addStage();assert.equal(f.p._commands.length,1);
});

// 服务端真实命令层+匿名内存存储先成功写入，再模拟客户端丢响应；不是 HTTP/SQLite 或实际 UI 测试。
for (const cancelFirst of [false,true]) test('服务端已写但响应丢失，'+(cancelFirst?'取消核对保稿后确认读回':'确认核对读回')+'且不重复写',async()=>{
  const {applyTacticCommands}=await import('../../server/native-tactic-commands.mjs');
  const {tacticVersion}=await import('../../server/tactic-version.mjs');
  let current={title:'匿名丢响应回归',board:demo()},writes=0,reads=0,confirm=!cancelFirst;
  const originalVersion=tacticVersion(current);
  const store={
    getTactic:()=>structuredClone(current),
    saveTactic:(id,{tactic,expectedVersion})=>{
      assert.equal(id,1);
      assert.equal(expectedVersion,tacticVersion(current));
      current=structuredClone(tactic);writes++;
      return structuredClone(current);
    }
  };
  const f=fixture(async(url,method,payload)=>{
    assert.equal(url,'/tactics/1/commands');
    if(method==='PUT'){
      applyTacticCommands(store,1,payload);
      throw Object.assign(Error('匿名模拟：已保存但客户端未收到响应'),{status:0});
    }
    reads++;
    return {tactic:structuredClone(current),version:tacticVersion(current)};
  },'admin',()=>({confirm,cancel:!confirm}));
  await f.p.onShow();
  f.p.input({currentTarget:{dataset:{key:'stageTitle'}},detail:{value:'匿名已保存阶段'}});
  f.p.applyStage();
  const draft=JSON.stringify(f.p._model),commands=JSON.stringify(f.p._commands),undo=JSON.stringify(f.p._undo);
  await f.p.save();
  assert.equal(writes,1);
  assert.notEqual(tacticVersion(current),originalVersion);
  assert.equal(current.board.demonstration.stages[0].title,'匿名已保存阶段');
  assert.equal(f.p.data.conflict,true);assert.equal(f.p.data.busy,false);assert.equal(f.p.data.changes,1);
  assert.equal(JSON.stringify(f.p._model),draft);
  assert.equal(JSON.stringify(f.p._commands),commands);assert.equal(JSON.stringify(f.p._undo),undo);
  await f.p.save();f.p.addStage();
  assert.equal(writes,1);assert.equal(f.calls.filter(c=>c[1]==='PUT').length,1);
  assert.equal(JSON.stringify(f.p._commands),commands);
  if(cancelFirst){
    f.p.reload();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,1);assert.equal(f.p.data.conflict,true);
    assert.equal(JSON.stringify(f.p._model),draft);assert.equal(JSON.stringify(f.p._undo),undo);
    confirm=true;
  }
  f.p.reload();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads,2);assert.equal(f.p.data.error,'');assert.equal(f.p.data.loading,false);
  assert.equal(JSON.stringify(f.p._model),JSON.stringify(current));assert.equal(f.p._version,tacticVersion(current));
  assert.equal(f.p.data.conflict,false);assert.equal(f.p.data.changes,0);assert.equal(f.p._commands.length,0);assert.equal(f.p._undo.length,0);
  await f.p.save();
  assert.equal(writes,1);assert.equal(f.calls.filter(c=>c[1]==='PUT').length,1);
});
