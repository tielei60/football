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
