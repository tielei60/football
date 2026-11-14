const {uiBridge}=require('./ui-fixture.cjs');
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const session = {
  user: { role: "admin", playerId: "p1" },
  team: { name: "测试球队" },
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
  const wx = new Proxy(
    {
      stopPullDownRefresh() {},
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

const pdf=require('../utils/tactic-pdf');
const jpeg=Uint8Array.from([255,216,255,192,0,17,8,0,2,0,3,3,1,17,0,2,17,0,3,17,0,255,217]);
test("PDF cross-reference offsets, stream lengths, dimensions and A4 are exact",()=>{
 const result=Buffer.from(pdf.jpegToPdf(jpeg)),text=result.toString('latin1');
 assert.ok(text.startsWith('%PDF-1.4'));assert.ok(text.includes('/Width 3 /Height 2'));
 assert.ok(text.includes('/MediaBox [0 0 595.28 841.89]'));
 const xref=Number(text.match(/startxref\n(\d+)/)[1]);assert.equal(text.slice(xref,xref+4),'xref');
 const rows=text.slice(xref).split('\n').slice(3,8);
 rows.forEach((row,i)=>assert.equal(text.slice(Number(row.slice(0,10)),Number(row.slice(0,10))+7),(i+1)+' 0 obj'));
 assert.ok(result.includes(Buffer.from(jpeg)));assert.equal(text.includes('/JavaScript'),false);
});
test("PDF rejects oversized and malformed JPEG before writing",()=>{
 for(const data of [new Uint8Array(),new Uint8Array(8*1024*1024+1),Uint8Array.from([255,216,255,217])])assert.throws(()=>pdf.jpegToPdf(data));
 const bad=jpeg.slice();bad[11]=4;assert.throws(()=>pdf.jpegToPdf(bad));
});
const tactic={title:"Demo",board:{pieces:[{pieceId:1,kind:"player",x:100,y:100,label:"Player"}],markings:[]}};
function fixture(overrides={},wxOverrides={}){
 const files=new Map(),calls=[];
 const ctx=new Proxy({}, {get:(o,k)=>o[k]||(()=>{}),set:(o,k,v)=>{o[k]=v;return true;}});
 const node={getContext:()=>ctx};
 const fsMock={unlinkSync:p=>files.delete(p),copyFileSync:(a,b)=>files.set(b,files.get(a)),readFileSync:p=>files.get(p),writeFileSync:(p,b)=>files.set(p,b),statSync:p=>({size:files.get(p)?.byteLength||12})};
 const h=setup('tactic-export',{getSession:()=>({...session,token:"A"}),request:async(path)=>{calls.push(path);return {tactic,version:"v"};},...overrides},{
 env:{USER_DATA_PATH:"wxfile://private"},getFileSystemManager:()=>fsMock,
 createSelectorQuery:()=>({in(){return this;},select(){return this;},fields(){return this;},exec(cb){cb([{node}]);}}),
 canvasToTempFilePath:o=>{files.set("wxfile://temp",jpeg.buffer);o.success({tempFilePath:"wxfile://temp"});},
 ...wxOverrides
 });
 h.page.query={id:"1"};h.page._files=new Set();
 return {...h,files,calls};
}
test("local PNG/PDF generate without uploads; unload cleans owned files",async()=>{
 const h=fixture();await h.page.refresh();await h.page.png();assert.equal(h.page.data.format,'PNG');assert.equal(h.files.size,1);
 await h.page.pdf();assert.equal(h.page.data.format,'PDF');assert.equal(h.files.size,1);
 assert.ok(Buffer.from([...h.files.values()][0]).toString().startsWith('%PDF'));
 assert.equal(h.calls.length,1);assert.equal(h.events.some(e=>['shareFileMessage','saveImageToPhotosAlbum'].includes(e[0])),false);
 h.page.onUnload();assert.equal(h.files.size,0);
});
test("historical export uses saved snapshot and never current template",async()=>{
 const h=fixture({request:async()=>({tacticSnapshots:[{sourceTacticId:9,tactic:{...tactic,title:'Old'},captureSource:'association'}]})});
 h.page.query={matchId:"1",sourceId:"9"};await h.page.refresh();
 assert.equal(h.page.data.title,'Old');assert.match(h.page.data.source,/历史/);
});
test("unsupported or shortened content rejects export rather than silently clipping",async()=>{
 const bad=structuredClone(tactic);bad.board.pieces[0].label='a'.repeat(17);
 const h=fixture({request:async()=>({tactic:bad})});await h.page.refresh();assert.ok(h.page.data.error);await h.page.png();assert.equal(h.files.size,0);
});
test("player and changed login cannot produce exports",async()=>{
 const h=fixture({ensureSession:async()=>({...session,user:{role:'player'}})});await h.page.refresh();await h.page.png();assert.equal(h.files.size,0);
 const a=fixture();await a.page.refresh();a.api.getSession=()=>({...session,token:'B'});await a.page.pdf();assert.equal(a.files.size,0);
});
test("hidden preflight does not create canvas or files",async()=>{
 const h=fixture();await h.page.refresh();let resolve;
 h.api.ensureSession=()=>new Promise(r=>resolve=r);
 const work=h.page.png();h.page.onHide();resolve(session);await work;assert.equal(h.files.size,0);
});
test("late canvas completion after unload removes temporary output",async()=>{
 let finish;const h=fixture({}, {canvasToTempFilePath:o=>{finish=o.success;}});await h.page.refresh();
 const work=h.page.png();await new Promise(r=>setImmediate(r));h.page.onUnload();h.files.set('wxfile://late',jpeg.buffer);finish({tempFilePath:'wxfile://late'});await work;assert.equal(h.files.size,0);
});
