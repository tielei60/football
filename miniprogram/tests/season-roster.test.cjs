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

const snapshot={playerId:"p1",name:"Old name",number:0,positions:["Old position"]};
const current=[{id:"p1",name:"New name",number:9,positions:["New position"],status:"inactive",avatar:"LARGE"},
{id:"p2",name:"Second",number:null,positions:[],status:"active"}];
function fixture(extra={},wx={}){
 let writes=[];
 const h=setup("season-roster",{
 getSession:()=>({...session,token:"A"}),
 request:async(path,method,data)=>{
  if(method==="PUT"){writes.push(data);return {season:{name:"Season",revision:8},roster:data.roster.map(r=>({...snapshot,...r}))};}
  return path==="/players"?current:{season:{name:"Season",revision:7},roster:[snapshot]};
 },...extra},wx);
 h.page.id="1";
 return {...h,writes};
}
test("season snapshots and zero number take precedence; no raw avatar enters data",async()=>{
 const h=fixture();await h.page.refresh();
 assert.equal(h.page.data.rows[0].name,"Old name");
 assert.equal(h.page.data.rows[0].number,"0");
 assert.equal(h.page.data.rows[0].positions,"Old position");
 assert.equal(h.page.data.rows[0].status,"inactive");
 assert.equal(JSON.stringify(h.page.data).includes("LARGE"),false);
});
test("player can read but cannot mutate roster",async()=>{
 const h=fixture({ensureSession:async()=>({...session,user:{role:"player"}})});
 await h.page.refresh();
 h.page.add();await h.page.save();
 assert.equal(h.page.data.admin,false);
 assert.equal(h.page.data.players.length,0);
 assert.equal(h.writes.length,0);
});
test("add/remove keeps snapshot until saved; only id and number are submitted",async()=>{
 const h=fixture();await h.page.refresh();
 h.page.remove({currentTarget:{dataset:{id:"p1"}}});
 h.page.setData({candidateIndex:0});
 h.page.add();
 assert.equal(h.page.data.rows[0].name,"Old name");
 h.page.setData({candidateIndex:0});h.page.add();
 await h.page.save();
 assert.deepEqual(JSON.parse(JSON.stringify(h.writes)),[{revision:7,roster:[{playerId:"p1",number:0},{playerId:"p2",number:null}]}]);
 assert.equal(h.page.data.revision,8);
});
test("cancel remove and reload preserve draft",async()=>{
 const h=fixture({}, {showModal:o=>o.success({confirm:false})});await h.page.refresh();
 h.page.number({currentTarget:{dataset:{id:"p1"}},detail:{value:"15"}});
 h.page.remove({currentTarget:{dataset:{id:"p1"}}});h.page.reload();
 assert.equal(h.page.data.rows.length,1);assert.equal(h.page.data.rows[0].number,"15");
});
test("409 retains draft and old revision without blind retry",async()=>{
 const h=fixture();await h.page.refresh();
 h.api.request=async()=>{throw Object.assign(new Error("conflict"),{status:409});};
 h.page.number({currentTarget:{dataset:{id:"p1"}},detail:{value:"15"}});
 await h.page.save();
 assert.equal(h.page.data.conflict,true);assert.equal(h.page.data.rows[0].number,"15");assert.equal(h.page.data.revision,7);
});
test("network failure allows revision-safe retry and validation blocks invalid numbers",async()=>{
 const h=fixture();await h.page.refresh();
 h.page.number({currentTarget:{dataset:{id:"p1"}},detail:{value:"1.5"}});
 await h.page.save();assert.equal(h.writes.length,0);
 h.page.number({currentTarget:{dataset:{id:"p1"}},detail:{value:""}});
 h.api.request=async()=>{throw new Error("offline");};
 await h.page.save();assert.equal(h.page.data.busy,false);assert.equal(h.page.data.rows[0].number,"");
});
test("duplicate save and unloaded response cannot overwrite page",async()=>{
 const h=fixture();await h.page.refresh();
 let resolve,calls=0;
 h.api.request=()=>{calls++;return new Promise(r=>resolve=r);};
 const first=h.page.save();await new Promise(r=>setImmediate(r));
 await h.page.save();assert.equal(calls,1);
 h.page.onUnload();resolve({season:{revision:8},roster:[]});await first;
 assert.equal(h.page.data.revision,7);
});
test("changed login cannot submit old draft",async()=>{
 const h=fixture();await h.page.refresh();
 h.api.getSession=()=>({...session,token:"B"});
 await h.page.save();assert.equal(h.writes.length,0);
});
test("hidden successful save is reconciled on authenticated return",async()=>{
 const h=fixture();await h.page.refresh();
 let resolve;h.api.request=()=>new Promise(r=>resolve=r);
 const work=h.page.save();await new Promise(r=>setImmediate(r));h.page.onHide();
 resolve({season:{revision:8},roster:[snapshot]});await work;
 assert.equal(h.page.data.revision,7);
 await h.page.onShow();assert.equal(h.page.data.revision,8);assert.equal(h.page.data.busy,false);
});
test("late load cannot replace newer draft revision",async()=>{
 const h=fixture();let resolve;
 h.api.request=path=>path==="/players"?Promise.resolve(current):new Promise(r=>resolve=r);
 const old=h.page.refresh();await new Promise(r=>setImmediate(r));
 h.api.request=async path=>path==="/players"?current:{season:{name:"New",revision:9},roster:[]};
 await h.page.refresh();resolve({season:{name:"Old",revision:7},roster:[snapshot]});await old;
 assert.equal(h.page.data.revision,9);assert.equal(h.page._original.length,0);
});

for(const status of [undefined,502,409,400])test('赛季阵容保存回执分类 '+status,async()=>{
 const h=fixture();await h.page.refresh();h.page.number({currentTarget:{dataset:{id:'p1'}},detail:{value:'15'}});
 const draft=JSON.stringify(h.page.data.rows),original=h.page._original;let writes=0;
 h.api.request=async()=>{writes++;throw Object.assign(Error('明确校验失败'),{status});};
 await h.page.save();
 assert.equal(h.page.data.actionError,status===409?'赛季已被修改，输入已保留，请重新载入核对。':status===400?'明确校验失败':'保存结果尚未确认，输入已保留。请返回并重新打开赛季阵容核对，勿直接重复保存。');
 assert.equal(h.page.data.conflict,status===409);assert.equal(h.page.data.busy,false);
 assert.equal(JSON.stringify(h.page.data.rows),draft);assert.equal(h.page._original,original);assert.equal(h.page.data.revision,7);
 assert.equal(writes,1);if(status===409){await h.page.save();assert.equal(writes,1);}
});
