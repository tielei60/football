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


// 真实控制器 + 模拟已提交的后端状态；不宣称原生网络故障验证。
const event=(field,value)=>({currentTarget:{dataset:{field}},detail:{value}});
const click=(id,delta)=>({currentTarget:{dataset:{id,delta}}});
const plain=x=>JSON.parse(JSON.stringify(x));
test("第九张上传已提交但响应丢失：冻结编辑并跨页同收据恢复",async()=>{
 let revision=8,photos=Array.from({length:8},(_,i)=>({id:i+1,caption:"照片"})),receipt;
 const calls=[];
 const h=setup("match-media",{getSession:()=>({...session,token:"A"}),request:async(p,m,d)=>{
  if(m){calls.push({p,m,d:plain(d)});assert.equal(m,"POST");
   if(!receipt){receipt=plain(d);photos.push({id:9,caption:d.caption});revision++;throw Error("响应丢失");}
   assert.deepEqual(plain(d),receipt);return {revision,photo:{id:9}};
  }
  if(/\/photos\/\d+$/.test(p))return {dataUrl:"data:image/png;base64,AA=="};
  return p.endsWith("/photos")?{photos:plain(photos),revision,coverPhotoId:1}:{notice:"服务器须知",revision};
 }});
 h.page.id="1";await h.page.refresh();
 h.page._image="data:image/png;base64,AA==";h.page.setData({preview:"wxfile://chosen",caption:"第九张",notice:"本地草稿"});
 await h.page.upload();assert.equal(h.page.data.uncertain,true);assert.equal(photos.length,9);
 const before=plain(h.page.data);h.page.choose();h.page.input(event("caption","不可替换"));h.page.input(event("notice","不可替换"));
 await h.page.saveNotice();h.page.remove(click(1));await h.page.cover(click(2));await h.page.move(click(2,-1));
 assert.equal(calls.length,1);assert.equal(h.events.some(x=>x[0]==="chooseMedia"),false);assert.equal(h.page.data.caption,before.caption);assert.equal(h.page.data.notice,before.notice);assert.equal(h.page.data.preview,before.preview);
 h.page.onUnload();const next=h.newPage();next.id="1";await next.refresh();
 assert.equal(next.data.photos.length,9);assert.equal(next.data.uncertain,true);assert.equal(next.data.caption,"第九张");assert.equal(next.data.notice,"本地草稿");
 await next.upload();assert.equal(calls.length,2);assert.deepEqual(calls[1].d,calls[0].d);assert.equal(photos.length,9);assert.equal(revision,9);
 assert.equal(next.data.uncertain,false);assert.equal(next.data.preview,"");assert.equal(next._image,null);
});

test("排序已提交响应未知：取消重载零请求，确认仅GET恢复真实顺序",async()=>{
 let revision=4,photos=[{id:1},{id:2}],confirm=false;const calls=[];
 const h=setup("match-media",{getSession:()=>({...session,token:"A"}),request:async(p,m,d)=>{
  calls.push({p,m:m||"GET",d: d&&plain(d)});
  if(m){assert.equal(p,"/matches/1/photos/order");assert.equal(m,"PUT");photos=d.photoIds.map(id=>({id}));revision++;throw Error("响应丢失");}
  if(/\/photos\/\d+$/.test(p))return {dataUrl:"data:image/png;base64,AA=="};
  return p.endsWith("/photos")?{photos:plain(photos),revision,coverPhotoId:1}:{notice:"服务器须知",revision};
 }},{showModal:options=>{options.success?.({confirm});return Promise.resolve({confirm});}});
 h.page.id="1";await h.page.refresh();await new Promise(r=>setImmediate(r));calls.length=0;
 await h.page.move(click(2,-1));assert.equal(h.page.data.conflict,true);assert.deepEqual(plain(h.page.data.photos.map(x=>x.id)),[1,2]);
 await h.page.move(click(2,-1));assert.equal(calls.filter(x=>x.m==="PUT").length,1);
 const count=calls.length;h.page.reload();await new Promise(r=>setImmediate(r));assert.equal(calls.length,count);assert.equal(h.page.data.conflict,true);
 confirm=true;h.page.reload();await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));
 assert.ok(calls.length>count);assert.ok(calls.slice(count).every(x=>x.m==="GET"));assert.equal(calls.filter(x=>x.m==="PUT").length,1);
 assert.equal(h.page.data.conflict,false);assert.equal(h.page.revision,5);assert.equal(revision,5);assert.deepEqual(plain(h.page.data.photos.map(x=>x.id)),[2,1]);assert.equal(h.page.data.coverPhotoId,1);
});
