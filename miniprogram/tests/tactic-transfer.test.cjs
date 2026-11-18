const {uiBridge}=require('./ui-fixture.cjs');
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const session = {
  user: { id: 1, teamId: 1, role: "admin", playerId: "p1" },
  team: { id: 1, name: "测试球队" },
};
function setup(name, overrides = {}, wxOverrides = {}) {
  const events = [];
  let definition;
  const api = {
    ensureSession: async () => session,
    getSession: () => session,
    request: async () => [],
    clearSession() {
      events.push(["clear"]);
    },
    ...overrides,
  };
  const storage = new Map();
  const wx = new Proxy(
    {
      stopPullDownRefresh() {},
      getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),
      showModal(options) {
        options.success({ confirm: true });
      },
      ...wxOverrides,
    },
    {
      get(target, key) {
        return target[key] || ((options) => events.push([key, options]));
      },
    },
  );
  const context = vm.createContext({
    console,
    Map,
    Set,
    Date,
    Promise,
    encodeURIComponent,
    wx,
    Page(value) {
      definition = value;
    },
  });
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const source = fs.readFileSync(file, "utf8");
    const wrapped = vm.runInContext(
      "(function(require,module,exports){" + source + "\n})",
      context,
      { filename: file },
    );
    wrapped(
      (reference) => {
        if (reference.endsWith("/utils/ui")) return uiBridge(wx);
        if (reference.endsWith("/utils/api")) return api;
        if (reference.endsWith("/utils/media"))
          return {
            imageSource(value) {
              events.push(["imageSource", value]);
              if (
                typeof value === "string" &&
                value.startsWith("data:image/png;base64,")
              )
                return "wxfile://test/avatar.png";
              return "";
            },
          };
        if (reference.endsWith("/config"))
          return { apiBaseUrl: "https://club.example" };
        return load(path.resolve(path.dirname(file), reference + ".js"));
      },
      mod,
      mod.exports,
    );
    return mod.exports;
  }
  load(path.join(root, "pages", name, "index.js"));
  function instantiate() { return {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".");
        let target = this.data;
        for (const part of parts.slice(0, -1)) target = target[part];
        target[parts.at(-1)] = value;
      }
    },
  };
  }
  const page = instantiate();
  return {
    newPage: instantiate,
    page,
    api,
    events,
    shared: load(path.join(root, "pages/shared.js")),
  };
}

const transfer=require("../utils/tactic-transfer");
const backup={tactics:[{title:"Training",tags:[],favorite:false,formationName:null,thumbnail:null,board:{pieces:[{pieceId:"p",kind:"player",x:1,y:2,label:"Demo"}],markings:[]}}],versions:[{tacticNumber:0,note:"Old",createdAt:1,board:{pieces:[],markings:[]}}],exportedAt:1};
test("canonical Web backup round-trips without losing versions",()=>{
 assert.deepEqual(transfer.parse(transfer.serialize(backup)),backup);
});
test("reject malformed format, dangling versions, unknown credential fields and oversized data",()=>{
 for(const b of [{...backup,token:"secret"},{...backup,versions:[{tacticNumber:1,board:{pieces:[],markings:[]}}]},{...backup,tactics:[{...backup.tactics[0],board:{pieces:[{pieceId:"p",x:1,y:2,password:"secret"}],markings:[]}}]}])assert.throws(()=>transfer.validate(b));
 assert.throws(()=>transfer.parse("x"));assert.throws(()=>transfer.parse(" ".repeat(transfer.MAX_BYTES+1)));
 const unknown=structuredClone(backup);unknown.tactics[0].board.extra="extension";assert.throws(()=>transfer.serialize(unknown));
});
test("nested demonstration references and duplicate IDs are validated",()=>{
 const b=structuredClone(backup);b.tactics[0].board.demonstration={demonstrationId:"d",title:"D",participants:[],stages:[{stageNumber:0,positions:[{pieceId:"missing",x:1,y:2}]}],runs:[]};
 assert.throws(()=>transfer.validate(b));
 b.tactics[0].board=structuredClone(backup.tactics[0].board);b.tactics[0].board.pieces.push({...b.tactics[0].board.pieces[0]});assert.throws(()=>transfer.validate(b));
});
function fixture(overrides={},wx={}){
 const writes=[],files=new Map(),events=[];
 const h=setup("tactic-transfer",{getSession:()=>({...session,token:"A"}),request:async(p,m,d)=>{if(m){writes.push(d);return {importedCount:1};}return backup;},...overrides},
 {env:{USER_DATA_PATH:"wxfile://user"},getFileSystemManager:()=>({writeFileSync:(p,d)=>files.set(p,d),unlinkSync:p=>files.delete(p)}),...wx});
 return {...h,writes,files};
}
function selected(p){p._collection=structuredClone(backup);p.setData({fileName:"test.json",tacticCount:1,versionCount:1});}
test("player is forbidden and stale session cannot write",async()=>{
 const h=fixture({ensureSession:async()=>({...session,user:{role:"player"}})});await h.page.refresh();selected(h.page);await h.page.executeImport();assert.equal(h.writes.length,0);
 const admin=fixture();await admin.page.refresh();selected(admin.page);admin.api.getSession=()=>({...session,token:"B"});await admin.page.executeImport();assert.equal(admin.writes.length,0);
});
test("selection reads locally only; cancel import makes no POST",async()=>{
 const h=fixture({}, {chooseMessageFile:o=>o.success({tempFiles:[{name:"b.json",path:"wxfile://chosen",size:500}]}),
 getFileSystemManager:()=>({readFile:o=>{o.success({data:JSON.stringify(backup)});o.complete();}}),
 showModal:o=>o.success({confirm:false})});
 await h.page.refresh();h.page.choose();assert.equal(h.page.data.tacticCount,1);assert.equal(h.writes.length,0);h.page.importFile();assert.equal(h.writes.length,0);
});
test("unknown import survives recreation and retries exact collectionName",async()=>{
 const requests=[],h=fixture({request:async(p,m,d)=>{requests.push(d);throw new Error("offline");}});await h.page.refresh();selected(h.page);await h.page.executeImport();assert.equal(h.page.data.pending,true);h.page.onUnload();
 const next=h.newPage();await next.refresh();await next.executeImport();assert.equal(requests.length,2);assert.equal(requests[0].collectionName,requests[1].collectionName);assert.equal(JSON.stringify(next.data).includes("versions"),false);
});
test("in-flight import cannot duplicate and late success cannot become new import",async()=>{
 let finish,calls=0;const h=fixture({request:()=>{calls++;return new Promise(r=>finish=r);}});
 await h.page.refresh();selected(h.page);const work=h.page.executeImport();await new Promise(r=>setImmediate(r));h.page.onUnload();
 const next=h.newPage();await next.refresh();await next.executeImport();assert.equal(calls,1);
 finish({importedCount:1});await work;await next.executeImport();assert.equal(calls,1);assert.equal(next.data.fileName,"");
});
test("login change drops pending private backup",async()=>{
 const h=fixture({request:async()=>{throw new Error("offline");}});await h.page.refresh();selected(h.page);await h.page.executeImport();h.page.onUnload();h.api.getSession=()=>({...session,token:"B"});
 const next=h.newPage();await next.refresh();assert.equal(next.data.pending,false);assert.equal(next.data.fileName,"");assert.equal(next._collection,undefined);
});
test("export is local only, strips collectionName and cleans only its own file",async()=>{
 const h=fixture();await h.page.refresh();await h.page.exportFile();assert.equal(h.files.size,1);assert.equal(h.page.data.exportReady,true);
 const value=JSON.parse([...h.files.values()][0]);assert.deepEqual(value,backup);assert.equal(h.writes.length,0);
 assert.equal(h.events.some(e=>e[0]==="shareFileMessage"),false);h.page.onUnload();assert.equal(h.files.size,0);
});
test("failed file parsing never sends data; unsupported save does not share",async()=>{
 const h=fixture({}, {chooseMessageFile:o=>o.success({tempFiles:[{name:"x.json",path:"x",size:1}]}),
 getFileSystemManager:()=>({readFile:o=>{o.success({data:"!"});o.complete();}}),saveFileToDisk:null});
 await h.page.refresh();h.page.choose();assert.ok(h.page.data.actionError);assert.equal(h.writes.length,0);
});

test("hide or unload during preflight cannot dispatch a new import/export",async()=>{
 for(const operation of ["executeImport","exportFile"])for(const lifecycle of ["onHide","onUnload"]){
  const h=fixture();await h.page.refresh();selected(h.page);
  let finish;h.api.ensureSession=()=>new Promise(r=>finish=r);
  const work=h.page[operation]();h.page[lifecycle]();finish(session);await work;
  assert.equal(h.writes.length,0);assert.equal(h.files.size,0);
 }
});
function persistentStorage(map){return {getStorageSync:k=>map.get(k),setStorageSync:(k,v)=>map.set(k,structuredClone(v)),removeStorageSync:k=>map.delete(k)};}
test("process restart preserves only receipt and blocks new import until explicit confirmation",async()=>{
 const store=new Map(),wx=persistentStorage(store);
 const first=fixture({request:async()=>{throw new Error("lost response");}},wx);
 await first.page.refresh();selected(first.page);await first.page.executeImport();first.page.onUnload();
 assert.equal(store.size,1);
 const record=[...store.values()][0];
 assert.deepEqual(Object.keys(record).sort(),["createdAt","taskName"]);
 const serialized=JSON.stringify([...store]);assert.equal(serialized.includes("Training"),false);assert.equal(serialized.includes('"token"'),false);
 let confirmed=false,calls=0;
 const second=fixture({request:async()=>{calls++;return {importedCount:1};}},{...wx,showModal:o=>o.success({confirm:confirmed})});
 await second.page.refresh();assert.equal(second.page.data.recoveryBlocked,true);
 selected(second.page);await second.page.executeImport();assert.equal(calls,0);
 second.page.resolveRecovery();assert.equal(store.size,1);
 confirmed=true;second.page.resolveRecovery();assert.equal(store.size,0);assert.equal(second.page.data.recoveryBlocked,false);assert.equal(calls,0);
});
test("receipt is scoped by account and team, not login token",async()=>{
 const store=new Map(),wx=persistentStorage(store),h=fixture({request:async()=>{throw new Error("offline");}},wx);
 await h.page.refresh();selected(h.page);await h.page.executeImport();
 const other=fixture({getSession:()=>({...session,user:{...session.user,id:2},token:"B"})},wx);
 await other.page.refresh();assert.equal(other.page.data.recoveryBlocked,false);assert.equal(store.size,1);
 const same=fixture({getSession:()=>({...session,token:"C"})},wx);
 await same.page.refresh();assert.equal(same.page.data.recoveryBlocked,true);
});
test("storage write failure blocks POST; success clears receipt even after unload",async()=>{
 const bad=fixture({}, {setStorageSync:()=>{throw new Error("disk full");}});await bad.page.refresh();selected(bad.page);await bad.page.executeImport();assert.equal(bad.writes.length,0);
 const store=new Map();let finish;
 const h=fixture({request:()=>new Promise(r=>finish=r)},persistentStorage(store));
 await h.page.refresh();selected(h.page);const work=h.page.executeImport();await new Promise(r=>setImmediate(r));assert.equal(store.size,1);h.page.onUnload();finish({importedCount:1});await work;assert.equal(store.size,0);
});
test("401 after uncertain attempt cannot erase receipt of possibly committed import",async()=>{
 const store=new Map(),h=fixture({request:async()=>{throw new Error("lost");}},persistentStorage(store));
 await h.page.refresh();selected(h.page);await h.page.executeImport();
 h.api.request=async()=>{throw Object.assign(new Error("expired"),{status:401});};
 await h.page.executeImport();assert.equal(store.size,1);
});

for(const phase of ['read','parse','invalid'])test('重新选定文件'+phase+'失败清除旧集合与成功摘要',async()=>{
 let chooser,reader;const h=fixture({}, {chooseMessageFile:o=>chooser=o,getFileSystemManager:()=>({readFile:o=>reader=o})});await h.page.refresh();selected(h.page);h.page.setData({message:'旧文件已校验'});h.page.choose();chooser.success({tempFiles:[{name:phase==='invalid'?'bad.txt':'new.json',size:100,path:'new'}]});
 if(phase==='read'){reader.fail();reader.complete();}if(phase==='parse'){reader.success({data:'!'});reader.complete();}
 assert.equal(h.page._collection,null);assert.equal(h.page.data.fileName,'');assert.equal(h.page.data.tacticCount,0);assert.equal(h.page.data.versionCount,0);assert.equal(h.page.data.message,'');h.page.importFile();assert.equal(h.writes.length,0);
});
test('文件选择取消保留旧有效集合，不发导入请求',async()=>{
 let chooser;const h=fixture({}, {chooseMessageFile:o=>chooser=o});await h.page.refresh();selected(h.page);const old=h.page._collection;h.page.choose();chooser.fail({errMsg:'chooseMessageFile:fail cancel'});assert.equal(h.page._collection,old);assert.equal(h.page.data.fileName,'test.json');assert.equal(h.writes.length,0);
});
test('正常原生文件选择hide/show仍可完成本地解析',async()=>{
 let chooser,reader;const h=fixture({}, {chooseMessageFile:o=>chooser=o,getFileSystemManager:()=>({readFile:o=>reader=o})});await h.page.refresh();h.page.choose();h.page.onHide();await h.page.onShow();chooser.success({tempFiles:[{name:'new.json',size:100,path:'new'}]});reader.success({data:JSON.stringify(backup)});reader.complete();assert.equal(h.page.data.fileName,'new.json');assert.equal(h.page.data.tacticCount,1);assert.equal(h.page.data.busy,false);assert.equal(h.writes.length,0);
});
test('两次文件选择旧success/fail/complete不能覆盖新集合或解除新读取忙态',async()=>{
 const choosers=[],readers=[];const h=fixture({}, {chooseMessageFile:o=>choosers.push(o),getFileSystemManager:()=>({readFile:o=>readers.push(o)})});await h.page.refresh();h.page.choose();h.page.choose();choosers[0].success({tempFiles:[{name:'old.json',size:100,path:'old'}]});assert.equal(readers.length,0);choosers[1].success({tempFiles:[{name:'new.json',size:100,path:'new'}]});readers[0].success({data:JSON.stringify(backup)});readers[0].complete();
 h.page.choose();choosers[2].success({tempFiles:[{name:'last.json',size:100,path:'last'}]});readers[0].fail();readers[0].complete();assert.equal(h.page.data.busy,true);assert.equal(h.page.data.actionError,'');readers[1].success({data:JSON.stringify(backup)});readers[1].complete();assert.equal(h.page.data.fileName,'last.json');
});
for(const stage of ['chooser','reader'])test('换账号后旧'+stage+'回调不污染新页面',async()=>{
 let chooser,reader;const h=fixture({}, {chooseMessageFile:o=>chooser=o,getFileSystemManager:()=>({readFile:o=>reader=o})});await h.page.refresh();h.page.choose();if(stage==='reader')chooser.success({tempFiles:[{name:'old.json',size:100,path:'old'}]});h.api.getSession=()=>({...session,token:'B'});await h.page.refresh();h.page.setData({message:'新账号'});
 if(stage==='chooser')chooser.success({tempFiles:[{name:'old.json',size:100,path:'old'}]});else{reader.success({data:JSON.stringify(backup)});reader.fail();reader.complete();}
 assert.equal(h.page.data.fileName,'');assert.equal(h.page.data.message,'新账号');assert.equal(h.page.data.busy,false);
});
for(const transition of ['account','hide','resume'])test('刷新旧401在'+transition+'后不导航或污染',async()=>{
 const h=fixture();await h.page.refresh();let reject;h.api.ensureSession=()=>new Promise((_,r)=>reject=r);const old=h.page.refresh();
 if(transition==='account')h.api.getSession=()=>({...session,token:'B'});else{h.page.onHide();if(transition==='resume'){h.api.ensureSession=async()=>session;await h.page.onShow();}}
 const before=h.page.data.error;reject(Object.assign(Error('旧401'),{status:401}));await old;assert.equal(h.page.data.error,before);assert.equal(h.events.filter(x=>x[0]==='redirectTo').length,0);
});
test('导入页卸载后选图success与读取结果不恢复私有集合',async()=>{
 let chooser,reader;const h=fixture({}, {chooseMessageFile:o=>chooser=o,getFileSystemManager:()=>({readFile:o=>reader=o})});await h.page.refresh();h.page.choose();chooser.success({tempFiles:[{name:'old.json',size:100,path:'old'}]});h.page.onUnload();reader.success({data:JSON.stringify(backup)});reader.complete();assert.equal(h.page._collection,null);
});
for(const status of [401,403])test('当前账号真正'+status+'清理会话后仍显示失效信息',async()=>{
 const h=fixture();await h.page.refresh();h.api.ensureSession=async()=>{h.api.getSession=()=>null;throw Object.assign(Error('当前账号失效'),{status});};await h.page.refresh();assert.equal(h.page.data.error,'当前账号失效');assert.equal(h.page.data.loading,false);assert.equal(h.page.data.admin,false);assert.equal(h.events.filter(x=>x[0]==='redirectTo').length,status===401?1:0);
});
test('API确认旧会话失效：换账号再退出后旧401仍不导航',async()=>{
 const h=fixture();await h.page.refresh();let reject;h.api.ensureSession=()=>new Promise((_,r)=>reject=r);const task=h.page.refresh();h.api.getSession=()=>null;reject(Object.assign(Error('旧401'),{status:401,staleSession:true}));await task;assert.equal(h.page.data.error,'');assert.equal(h.events.filter(x=>x[0]==='redirectTo').length,0);
});

for(const resumed of [false,true])test('导出响应在离页'+(resumed?'再返回':'')+'后不生成过期文件或提示',async()=>{
 let finish;const h=fixture({request:()=>new Promise(r=>finish=r)});
 await h.page.refresh();const work=h.page.exportFile();await new Promise(r=>setImmediate(r));
 h.page.onHide();if(resumed)await h.page.onShow();h.page.setData({message:'当前页面提示'});
 finish(backup);await work;assert.equal(h.files.size,0);assert.equal(h.page.data.exportReady,false);assert.equal(h.page.data.message,'当前页面提示');assert.equal(h.page.data.busy,false);
});
test('导出旧错误在离页再返回后不污染当前提示',async()=>{
 let fail;const h=fixture({request:()=>new Promise((_,r)=>fail=r)});
 await h.page.refresh();const work=h.page.exportFile();await new Promise(r=>setImmediate(r));
 h.page.onHide();await h.page.onShow();h.page.setData({actionError:'当前提示'});
 fail(Error('过期网络失败'));await work;assert.equal(h.page.data.actionError,'当前提示');assert.equal(h.files.size,0);
});
test('导出会话预检期间离页再返回不发出旧导出请求',async()=>{
 let finish,calls=0;const h=fixture({request:async()=>{calls++;return backup}});await h.page.refresh();
 h.api.ensureSession=()=>new Promise(r=>finish=r);const work=h.page.exportFile();h.page.onHide();h.api.ensureSession=async()=>session;await h.page.onShow();finish(session);await work;
 assert.equal(calls,0);assert.equal(h.files.size,0);assert.equal(h.page.data.busy,false);
});

test('无损备份兼容服务端支持的末阶段旧曲线，但仍拒绝真正越界引用',()=>{
 const v=structuredClone(backup);v.tactics[0].board.demonstration={demonstrationId:'legacy',title:'旧演示',participants:[{pieceId:'p',x:1,y:2}],stages:[{stageNumber:0,positions:[{pieceId:'p',x:1,y:2}]}],runs:[{pieceId:'p',fromStage:0,bend:{x:2,y:3}}]};
 assert.deepEqual(transfer.parse(transfer.serialize(v)),v);
 v.tactics[0].board.demonstration.runs[0].fromStage=1;assert.throws(()=>transfer.validate(v));
});
test('每套战术超过50个历史版本明确拒绝，避免服务端静默裁剪',()=>{
 const v=structuredClone(backup);v.versions=Array.from({length:50},(_,i)=>({...structuredClone(backup.versions[0]),createdAt:i}));assert.doesNotThrow(()=>transfer.parse(JSON.stringify(v)));
 v.versions.push({...structuredClone(backup.versions[0]),createdAt:50});assert.throws(()=>transfer.parse(JSON.stringify(v)),/50.*避免.*丢失/);
});
test('历史上限按每套统计，导出不裁剪既有数据',()=>{
 const v=structuredClone(backup);v.tactics.push(structuredClone(v.tactics[0]));v.versions=[0,1].flatMap(tacticNumber=>Array.from({length:50},(_,i)=>({...structuredClone(backup.versions[0]),tacticNumber,createdAt:i})));
 assert.equal(transfer.parse(JSON.stringify(v)).versions.length,100);
 v.versions.push({...structuredClone(backup.versions[0]),createdAt:51});assert.equal(JSON.parse(transfer.serialize(v)).versions.length,101);
});

for(const [result,message]of[
 [{importedCount:0,repeated:true,receiptVerification:'legacy-unverified'},'历史导入记录已存在，本次未重复导入。请到战术列表核对内容，勿重复选择同一备份。'],
 [{importedCount:0,repeated:true,receiptVerification:'verified'},'此前导入已确认，本次未重复新增战术。'],
 [{importedCount:1,repeated:false,receiptVerification:'verified'},'导入已确认，新增 1 套战术。'],
 [{importedCount:0,repeated:true},'本次未新增战术，无法核验历史内容。请到战术列表核对。'],
 [{importedCount:0},'本次未新增战术，无法核验历史内容。请到战术列表核对。'],
 [{importedCount:1},'导入已确认，新增 1 套战术。'],
])test('导入收据提示区分验证状态：'+JSON.stringify(result),async()=>{
 const store=new Map(),requests=[],h=fixture({request:async(p,m,d)=>{requests.push(d);return result;}},persistentStorage(store));
 await h.page.refresh();selected(h.page);await h.page.executeImport();
 assert.equal(h.page.data.message,message);assert.equal(h.page.data.pending,false);assert.equal(h.page.data.fileName,'');assert.equal(h.page._collection,null);assert.equal(store.size,0);
 await h.page.executeImport();assert.equal(requests.length,1);
});
test('首次同名异内容409不显示成功、不自动重复导入',async()=>{
 const store=new Map(),requests=[],h=fixture({request:async(p,m,d)=>{requests.push(d);throw Object.assign(Error('同名导入内容不一致'),{status:409});}},persistentStorage(store));
 await h.page.refresh();selected(h.page);await h.page.executeImport();
 assert.equal(requests.length,1);assert.equal(h.page.data.message,'');assert.equal(h.page.data.actionError,'同名导入内容不一致');assert.equal(h.page.data.pending,false);assert.equal(store.size,0);
 await h.page.refresh();assert.equal(requests.length,1);
});
test('未知结果后409仍保留同一任务和防重复收据，后续已验证重复成功才解除',async()=>{
 const store=new Map(),requests=[],h=fixture({request:async(p,m,d)=>{requests.push(structuredClone(d));throw Error('响应丢失');}},persistentStorage(store));
 await h.page.refresh();selected(h.page);await h.page.executeImport();const guard=JSON.stringify([...store]);
 h.page.onUnload();const next=h.newPage();await next.refresh();
 h.api.request=async(p,m,d)=>{requests.push(structuredClone(d));throw Object.assign(Error('同名导入内容不一致'),{status:409});};await next.executeImport();
 assert.equal(next.data.pending,true);assert.equal(next.data.message,'');assert.match(next.data.actionError,/结果未确认/);assert.equal(JSON.stringify([...store]),guard);assert.deepEqual(requests[1],requests[0]);
 next.choose();assert.equal(requests.length,2);
 h.api.request=async(p,m,d)=>{requests.push(structuredClone(d));return {importedCount:0,repeated:true,receiptVerification:'verified'};};await next.executeImport();
 assert.deepEqual(requests[2],requests[0]);assert.equal(next.data.message,'此前导入已确认，本次未重复新增战术。');assert.equal(next.data.pending,false);assert.equal(store.size,0);assert.equal(next._collection,null);
 await next.executeImport();assert.equal(requests.length,3);
});
test('17O具名文件默认原样透传名称，不擅自创建独立副本',async()=>{const h=fixture();await h.page.refresh();selected(h.page);h.page._collection.collectionName='  原始请求名  ';await h.page.executeImport();assert.equal(h.writes[0].collectionName,'  原始请求名  ');});
test('17O显式独立副本使用新任务且未知结果重试全文不变',async()=>{const writes=[];const h=fixture({request:async(p,m,d)=>{writes.push(d);throw Error('offline');}});await h.page.refresh();selected(h.page);h.page._collection.collectionName='named';h.page.setData({namedCollection:true});h.page.toggleCopy();assert.equal(h.page.data.asCopy,true);await h.page.executeImport();assert.notEqual(writes[0].collectionName,'named');h.page.toggleCopy();assert.equal(h.page.data.asCopy,true);const next=h.newPage();await next.refresh();await next.executeImport();assert.deepEqual(writes[1],writes[0]);});
test('17O本地拒绝非法显式名称，绝不回退随机任务',async()=>{for(const value of ['', '   ', '\t\n', null,12,{},'x'.repeat(301)]){assert.throws(()=>transfer.parse(JSON.stringify({...backup,collectionName:value})));const h=fixture();await h.page.refresh();selected(h.page);h.page._collection.collectionName=value;await h.page.executeImport();assert.equal(h.writes.length,0);assert.ok(h.page.data.actionError);}});
test('17O无名文件完成后再次选择仍独立追加',async()=>{const h=fixture();await h.page.refresh();selected(h.page);await h.page.executeImport();selected(h.page);await h.page.executeImport();assert.equal(h.writes.length,2);assert.notEqual(h.writes[0].collectionName,h.writes[1].collectionName);});
test('17O具名未知重试全文相同，409及legacy沿用原结果保护',async()=>{for(const outcome of ['conflict','legacy','unknown']){const requests=[];let call=0;const h=fixture({request:async(p,m,d)=>{requests.push(structuredClone(d));call++;if(outcome==='conflict')throw Object.assign(Error('同名导入内容不一致'),{status:409});if(outcome==='legacy')return{importedCount:0,repeated:true,receiptVerification:'legacy-unverified'};if(call===1)throw Error('offline');return{importedCount:0,repeated:true,receiptVerification:'verified'};}});await h.page.refresh();selected(h.page);h.page._collection.collectionName='fixed-name';await h.page.executeImport();assert.equal(requests[0].collectionName,'fixed-name');if(outcome==='unknown'){await h.page.executeImport();assert.deepEqual(requests[1],requests[0]);assert.match(h.page.data.message,/未重复新增/);}else if(outcome==='conflict'){assert.equal(h.page.data.pending,false);assert.match(h.page.data.actionError,/不一致/);assert.equal(h.page.data.message,'');}else assert.match(h.page.data.message,/历史导入记录/);}});
test('17O副本选择切换文件或账号复位，忙碌与待核对期间不能切换',async()=>{let current={...session,token:'A'},file={...backup,collectionName:'named'};const h=fixture({getSession:()=>current},{chooseMessageFile:o=>o.success({tempFiles:[{name:'named.json',path:'x',size:800}]}),getFileSystemManager:()=>({readFile:o=>{o.success({data:JSON.stringify(file)});o.complete();}})});await h.page.refresh();h.page.choose();assert.equal(h.page.data.namedCollection,true);h.page.toggleCopy();assert.equal(h.page.data.asCopy,true);h.page.data.busy=true;h.page.toggleCopy();assert.equal(h.page.data.asCopy,true);h.page.data.busy=false;h.page.choose();assert.equal(h.page.data.asCopy,false);h.page.toggleCopy();current={...session,token:'B'};await h.page.refresh();assert.equal(h.page.data.asCopy,false);assert.equal(h.page.data.namedCollection,false);assert.equal(h.page._collection,null);});
test('17O确认文案区分默认具名与明确副本，不承诺必新增',async()=>{let modal;const h=fixture({}, {showModal:o=>{modal=o;o.success({confirm:false});}});await h.page.refresh();selected(h.page);h.page._collection.collectionName='named';h.page.data.namedCollection=true;h.page.importFile();assert.match(modal.content,/相同内容不重复新增/);assert.doesNotMatch(modal.content,/将新增/);h.page.toggleCopy();h.page.importFile();assert.match(modal.content,/即使此前导入/);assert.equal(h.writes.length,0);});
test('17O旧pending随机任务名恢复时不被文件名覆盖',async()=>{const requests=[];const h=fixture({request:async(p,m,d)=>{requests.push(structuredClone(d));throw Error('offline');}});await h.page.refresh();selected(h.page);await h.page.executeImport();const originalTask=requests[0].collectionName;h.page._collection.collectionName='旧文件中的名称';const next=h.newPage();await next.refresh();await next.executeImport();assert.equal(requests[1].collectionName,originalTask);assert.deepEqual(requests[1],requests[0]);assert.notEqual(requests[1].collectionName,'旧文件中的名称');});
test('17O确认框打开后副本选择变化，迟到确认不发送导入',async()=>{let modal;const h=fixture({}, {showModal:o=>{modal=o;}});await h.page.refresh();selected(h.page);h.page._collection.collectionName='named';h.page.data.namedCollection=true;h.page.importFile();assert.ok(modal);h.page.toggleCopy();assert.equal(h.page.data.asCopy,true);modal.success({confirm:true});await new Promise(r=>setImmediate(r));assert.equal(h.writes.length,0);assert.equal(h.page.data.busy,false);});
