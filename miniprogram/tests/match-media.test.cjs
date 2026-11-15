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

const matchInfo={notice:"Saved notice"};
const listing={revision:3,photos:[],coverPhotoId:null};
function fixture(overrides={},wx={}){
 const posts=[];
 const h=setup("match-media",{
 getSession:()=>({...session,token:"A"}),
 request:async(path,method,data)=>{
  if(method){posts.push({path,method,data});return {revision:4};}
  return path.endsWith("/photos")?listing:matchInfo;
 },...overrides},wx);
 h.page.id="1";
 return {...h,posts};
}
function image(p){p._image="data:image/jpeg;base64,/9j/AAAA";p.setData({preview:"wxfile://picked",caption:"Caption"});}
test("album operations preserve unsaved notice and selected image",async()=>{
 const h=fixture();await h.page.refresh();image(h.page);
 h.page.input({currentTarget:{dataset:{field:"notice"}},detail:{value:"Draft"}});
 await h.page.cover({currentTarget:{dataset:{id:"photo"}}});
 assert.equal(h.page.data.notice,"Draft");assert.equal(h.page.data.preview,"wxfile://picked");
 assert.ok(h.events.some(e=>e[0]==="enableAlertBeforeUnload"));
});
test("save notice uses revision and same input survives reload",async()=>{
 const h=fixture();await h.page.refresh();
 const original=h.api.request;let saved;
 h.api.request=async(path,method,data)=>{if(method){saved=data.notice;return original(path,method,data);}return path.endsWith('/photos')?listing:{...matchInfo,notice:saved??matchInfo.notice};};
 h.page.input({currentTarget:{dataset:{field:"notice"}},detail:{value:"New"}});
 await h.page.saveNotice();
 assert.equal(h.posts[0].data.revision,3);assert.equal(h.posts[0].data.notice,"New");assert.equal(h.page.data.notice,"New");
});
test("unknown upload restores across instances with same requestId and notice",async()=>{
 const h=fixture();await h.page.refresh();image(h.page);h.page.setData({notice:"Draft"});
 const requests=[];
 const original=h.api.request;
 h.api.request=async(p,m,d)=>{if(m==="POST"){requests.push(d);throw new Error("offline");}return original(p,m,d);};
 await h.page.upload();assert.equal(h.page.data.uncertain,true);h.page.onUnload();
 const next=h.newPage();next.id="1";await next.refresh();
 assert.equal(next.data.uncertain,true);assert.equal(next.data.notice,"Draft");assert.ok(next._image);
 await next.upload();assert.equal(requests.length,2);assert.equal(requests[0].requestId,requests[1].requestId);
 assert.equal(JSON.stringify(next.data).includes("base64"),false);
});
test("in-flight upload cannot duplicate across pages and settled success does not resubmit",async()=>{
 const h=fixture();await h.page.refresh();image(h.page);
 let finish,calls=0;const original=h.api.request;
 h.api.request=(p,m,d)=>m==="POST"?(calls++,new Promise(r=>finish=r)):original(p,m,d);
 const upload=h.page.upload();await new Promise(r=>setImmediate(r));h.page.onUnload();
 const next=h.newPage();next.id="1";await next.refresh();await next.upload();assert.equal(calls,1);
 finish({revision:4});await upload;
 await next.upload();assert.equal(calls,1);assert.equal(next.data.uncertain,false);
});
test("different login clears pending and does not expose old image",async()=>{
 const h=fixture();await h.page.refresh();image(h.page);
 const original=h.api.request;
 h.api.request=(p,m,d)=>m==="POST"?Promise.reject(new Error("offline")):original(p,m,d);
 await h.page.upload();h.page.onUnload();h.api.getSession=()=>({...session,token:"B"});
 const next=h.newPage();next.id="1";await next.refresh();assert.equal(next.data.preview,"");assert.equal(next.data.uncertain,false);
});
test("409 upload keeps image and notice but requires reload",async()=>{
 const h=fixture();await h.page.refresh();image(h.page);h.page.setData({notice:"Draft"});
 h.api.request=async()=>{throw Object.assign(new Error("stale"),{status:409});};
 await h.page.upload();assert.equal(h.page.data.conflict,true);assert.equal(h.page.data.uncertain,false);
 assert.ok(h.page._image);assert.equal(h.page.data.notice,"Draft");
});
test("picture callback from older selection or save cannot override image",async()=>{
 const reads=[];const h=fixture({},{
 chooseMedia:o=>o.success({tempFiles:[{size:12,tempFilePath:"wxfile://"+reads.length}]}),
 getFileSystemManager:()=>({readFile:o=>reads.push(o)})
 });await h.page.refresh();h.page.choose();h.page.choose();
 reads[1].success({data:"/9j/BBBB"});reads[0].success({data:"/9j/AAAA"});
 assert.equal(h.page._image,"data:image/jpeg;base64,/9j/BBBB");
 h.page.choose();await h.page.saveNotice();reads[2].success({data:"/9j/CCCC"});
 assert.equal(h.page._image,"data:image/jpeg;base64,/9j/BBBB");
});
test("hiding for image picker and returning validates session without losing draft",async()=>{
 const h=fixture();await h.page.refresh();h.page.setData({notice:"Draft"});h.page.onHide();await h.page.onShow();
 assert.equal(h.page.data.notice,"Draft");assert.equal(h.page.data.loading,false);
 h.page.onHide();h.api.getSession=()=>({...session,token:"B"});await h.page.onShow();
 assert.equal(h.page.data.notice,"");assert.ok(h.page.data.error);
});
test("cancel explicit discard or remove makes no changes",async()=>{
 const h=fixture({}, {showModal:o=>o.success({confirm:false})});await h.page.refresh();h.page.setData({notice:"Draft"});
 h.page.reload();h.page.remove({currentTarget:{dataset:{id:"p"}}});
 assert.equal(h.page.data.notice,"Draft");assert.equal(h.posts.length,0);
});
test("late refresh cannot replace private revision",async()=>{
 const h=fixture();let resolve;h.api.request=p=>p.endsWith("/photos")?new Promise(r=>resolve=r):Promise.resolve(matchInfo);
 const old=h.page.refresh();await new Promise(r=>setImmediate(r));
 h.api.request=async p=>p.endsWith("/photos")?{...listing,revision:9}:matchInfo;
 await h.page.refresh();resolve(listing);await old;assert.equal(h.page.revision,9);
});
test("non-admin cannot change notice upload cover or delete",async()=>{
 const h=fixture({ensureSession:async()=>({...session,user:{role:"player"}})});await h.page.refresh();image(h.page);
 h.page.input({currentTarget:{dataset:{field:"notice"}},detail:{value:"No"}});
 await h.page.upload();await h.page.cover({currentTarget:{dataset:{id:"p"}}});h.page.remove({currentTarget:{dataset:{id:"p"}}});
 assert.equal(h.posts.length,0);assert.equal(h.page.data.notice,"Saved notice");
});

test('player image failure is explicit and retry only performs photo GET without losing notice',async()=>{
 let broken=true;const h=fixture({ensureSession:async()=>({...session,user:{role:'player'}})});await h.page.refresh();h.page.setData({photos:[{id:'p',src:'',loading:true,imageError:''}],notice:'Draft'});
 const calls=[];h.api.request=async(p,m)=>{calls.push([p,m]);if(broken)throw Error('network');return{dataUrl:'data:image/png;base64,AAAA'};};
 await h.page.loadPictures();assert.equal(h.page.data.photos[0].loading,false);assert.match(h.page.data.photos[0].imageError,/重试/);broken=false;await h.page.retryPhoto({currentTarget:{dataset:{id:'p'}}});assert.ok(h.page.data.photos[0].src);assert.equal(h.page.data.photos[0].imageError,'');assert.equal(h.page.data.notice,'Draft');assert.ok(calls.every(x=>x[1]===undefined));
});
test('old image errors stop batch after account switch and cannot change UI',async()=>{
 const h=fixture();await h.page.refresh();h.page.setData({photos:[{id:'p',src:'',imageError:''},{id:'q',src:'',imageError:''}]});let reject,calls=0;h.api.request=()=>{calls++;return new Promise((_,r)=>reject=r);};const w=h.page.loadPictures();h.api.getSession=()=>({...session,token:'B'});reject(Error('old'));await w;assert.equal(calls,1);assert.equal(h.page.data.photos[0].imageError,'');assert.equal(h.page.data.actionError,'');
});
test('hidden image success is discarded and return resumes missing images',async()=>{
 const h=fixture();await h.page.refresh();h.page.setData({photos:[{id:'p',src:'',imageError:''}]});let resolve;h.api.request=()=>new Promise(r=>resolve=r);const w=h.page.loadPictures();h.page.onHide();resolve({dataUrl:'data:image/png;base64,AAAA'});await w;assert.equal(h.page.data.photos[0].src,'');h.api.request=async()=>({dataUrl:'data:image/png;base64,AAAA'});await h.page.onShow();await new Promise(r=>setImmediate(r));assert.ok(h.page.data.photos[0].src);
});
test('preview checks account and suppresses late failures, current failures are visible',async()=>{
 let options;const h=fixture({}, {previewImage:o=>options=o});await h.page.refresh();h.page.setData({photos:[{id:'p',src:'wxfile://image'}]});const e={currentTarget:{dataset:{id:'p'}}};h.page.previewPhoto(e);options.fail();assert.match(h.page.data.actionError,/预览失败/);h.page.setData({actionError:''});h.page.previewPhoto(e);h.api.getSession=()=>({...session,token:'B'});options.fail();assert.equal(h.page.data.actionError,'');options=null;h.page.previewPhoto(e);assert.equal(options,null);
});
test('native image decode failure offers retry without changing photo metadata',async()=>{
 const h=fixture();await h.page.refresh();h.page.setData({photos:[{id:'p',caption:'Keep',src:'wxfile://bad'}]});h.page.photoError({currentTarget:{dataset:{id:'p'}}});assert.equal(h.page.data.photos[0].caption,'Keep');assert.equal(h.page.data.photos[0].src,'');assert.match(h.page.data.photos[0].imageError,/重试/);
});

test('current image 401 exposes expiry, but hidden or newer login never receives old redirect',async()=>{for(const mode of ['current','hidden','new']){const h=fixture();await h.page.refresh();h.page.setData({photos:[{id:'p',src:'',loading:true,imageError:''}]});let reject;h.api.request=()=>new Promise((_,r)=>reject=r);const w=h.page.loadPictures();h.api.getSession=()=>null;if(mode==='hidden')h.page.onHide();if(mode==='new')h.api.getSession=()=>({...session,token:'B'});reject(Object.assign(Error('expired'),{status:401}));await w;assert.equal(h.events.some(x=>x[0]==='redirectTo'),mode==='current');if(mode==='current')assert.equal(h.page.data.error,'expired');}});

test('write failure is scoped to original account and visible turn, own expiry still redirects',async()=>{
 for(const mode of ['current','hidden','new','reshow']){const h=fixture();await h.page.refresh();let reject;h.api.request=()=>new Promise((_,r)=>reject=r);const work=h.page.saveNotice();await new Promise(r=>setImmediate(r));h.api.getSession=()=>null;if(mode==='hidden')h.page.onHide();if(mode==='new')h.api.getSession=()=>({...session,token:'B'});if(mode==='reshow'){h.page.onHide();h.page._hidden=false;h.page._showTurn++;}reject(Object.assign(Error('old expired'),{status:401}));await work;assert.equal(h.events.some(x=>x[0]==='redirectTo'),mode==='current');if(mode!=='current')assert.equal(h.page.data.actionError,'');}
});
test('stale onShow validation failure cannot alter later show or new account',async()=>{
 for(const mode of ['current','hidden','new','refresh']){const h=fixture();await h.page.refresh();let reject;h.api.ensureSession=()=>new Promise((_,r)=>reject=r);const work=h.page.onShow();h.api.getSession=()=>null;if(mode==='hidden')h.page.onHide();if(mode==='new')h.api.getSession=()=>({...session,token:'B'});if(mode==='refresh')h.page._epoch++;reject(Object.assign(Error('old validation'),{status:401}));await work;assert.equal(h.events.some(x=>x[0]==='redirectTo'),mode==='current');if(mode!=='current')assert.equal(h.page.data.error,'');}
});
test('hidden upload success still settles receipt and requests refresh on return',async()=>{
 const h=fixture();await h.page.refresh();image(h.page);let finish;const request=h.api.request;h.api.request=(p,m,d)=>m==='POST'?new Promise(r=>finish=r):request(p,m,d);const work=h.page.upload();await new Promise(r=>setImmediate(r));h.page.onHide();finish({revision:4});await work;assert.equal(h.page.data.uncertain,false);assert.equal(h.page._needsRefresh,true);assert.equal(h.page._image,null);assert.equal(h.page.data.busy,false);
});
test('hide during write preflight prevents starting a new request',async()=>{const h=fixture();await h.page.refresh();let finish;h.api.ensureSession=()=>new Promise(r=>finish=r);const work=h.page.saveNotice();h.page.onHide();finish(session);await work;assert.equal(h.posts.length,0);assert.equal(h.page.data.busy,false);});

test('first and manual refresh discard hidden or switched-account responses before shared error/navigation',async()=>{
 for(const initial of [true,false])for(const mode of ['hidden','new','current'])for(const success of [true,false]){
  const h=fixture();if(!initial)await h.page.refresh();let finish,reject;
  h.api.request=p=>p.endsWith('/photos')?new Promise((a,b)=>{finish=a;reject=b;}):Promise.resolve(matchInfo);
  const w=h.page.refresh();await new Promise(r=>setImmediate(r));
  if(mode==='hidden')h.page.onHide();if(mode==='new')h.api.getSession=()=>({...session,token:'B'});
  if(success)finish({...listing,revision:99});else{if(mode!=='new')h.api.getSession=()=>null;reject(Object.assign(Error('expired refresh'),{status:401}));}
  await w;assert.equal(h.events.some(x=>x[0]==='redirectTo'),mode==='current'&&!success);
  if(mode!=='current'){assert.notEqual(h.page.revision,99);assert.equal(h.page.data.error,'');assert.equal(h.page.data.loading,true);}
  if(mode==='current'&&success)assert.equal(h.page.revision,99);
 }
});
test('refresh validation resolving after hide cannot dispatch member reads',async()=>{
 const h=fixture();let finish,calls=0;h.api.ensureSession=()=>new Promise(r=>finish=r);h.api.request=async()=>{calls++;return listing;};const w=h.page.refresh();h.page.onHide();finish(session);await w;assert.equal(calls,0);assert.equal(h.page._loaded,undefined);
});
test('manual refresh under new identity cannot retain another account draft',async()=>{
 const h=fixture();await h.page.refresh();h.page.setData({notice:'Private old draft',preview:'wxfile://old',caption:'Private caption'});h.page._image='old-private-image';h.api.getSession=()=>({...session,token:'B'});await h.page.refresh();assert.equal(h.page.data.notice,'Saved notice');assert.equal(h.page.data.preview,'');assert.equal(h.page.data.caption,'');assert.equal(h.page._image,null);
});

function sortable(h){h.page._loaded=true;h.page._owner='A';h.page._epoch=1;h.page.revision=8;h.page.setData({loading:false,admin:true,photos:[{id:1,caption:'甲'},{id:2,caption:'乙'},{id:3,caption:'丙'}],coverPhotoId:1,notice:'未保存说明'});h.page.refresh=async()=>{};}
const moveEvent=(id,delta)=>({currentTarget:{dataset:{id,delta}}});
test('比赛相册排序提交完整置换与旧版本，不乐观改变封面或草稿',async()=>{
 const h=fixture();sortable(h);await h.page.move(moveEvent(2,-1));
 assert.equal(h.posts.length,1);assert.equal(h.posts[0].path,'/matches/1/photos/order');assert.equal(h.posts[0].method,'PUT');
 assert.equal(JSON.stringify(h.posts[0].data),JSON.stringify({revision:8,photoIds:[2,1,3]}));
 assert.equal(h.page.data.coverPhotoId,1);assert.equal(h.page.data.notice,'未保存说明');assert.equal(h.page.data.photos[0].id,1);
});
test('排序首尾、非法方向、普通球员、隐藏和未知上传均不写',async()=>{
 const h=fixture();sortable(h);
 for(const e of [moveEvent(1,-1),moveEvent(3,1),moveEvent(2,0),moveEvent(99,1)])await h.page.move(e);
 h.page.data.admin=false;await h.page.move(moveEvent(2,-1));h.page.data.admin=true;h.page._hidden=true;await h.page.move(moveEvent(2,-1));h.page._hidden=false;h.page.data.uncertain=true;await h.page.move(moveEvent(2,-1));assert.equal(h.posts.length,0);
});
test('排序双击只发送一次，预检隐藏不得发出写请求',async()=>{
 let resolve;const h=fixture({ensureSession:()=>new Promise(r=>resolve=r)});sortable(h);
 const first=h.page.move(moveEvent(2,-1));await h.page.move(moveEvent(2,-1));h.page.onHide();resolve(session);await first;assert.equal(h.posts.length,0);
});
for(const status of [409,0,500])test('排序失败 '+status+' 保留原序并锁定至显式重新载入',async()=>{
 const h=fixture({request:async()=>{throw Object.assign(Error('失败'),{status});}});sortable(h);await h.page.move(moveEvent(2,-1));
 assert.equal(h.page.data.conflict,true);assert.equal(h.page.data.busy,false);assert.equal(h.page.data.photos[0].id,1);assert.equal(h.page.data.notice,'未保存说明');
 assert.match(h.page.data.actionError,status===409?/重新载入/:/排序结果尚未确认/);
});
test('排序旧账号迟到失败不写新账号错误',async()=>{
 let reject,token='A';const h=fixture({getSession:()=>({...session,token}),request:()=>new Promise((r,j)=>reject=j)});sortable(h);const task=h.page.move(moveEvent(2,-1));await new Promise(r=>setImmediate(r));token='B';reject(Object.assign(Error('旧失败'),{status:409}));await task;assert.equal(h.page.data.actionError,'');
});

test('须知三方比较：未编辑跟随服务器，脏稿冲突取消零写、确认原版本',async()=>{
 let server='Saved notice',revision=3;const writes=[];let confirm=false;
 const h=fixture({request:async(path,method,data)=>{if(method){writes.push(data);server=data.notice;revision++;return {revision};}return path.endsWith('/photos')?{...listing,revision}:{...matchInfo,notice:server,revision};}}, {showModal:()=>Promise.resolve({confirm})});
 await h.page.refresh();server='最新';revision++;await h.page.refresh();assert.equal(h.page.data.notice,'最新');
 h.page.setData({notice:'本地'});server='又一版';revision++;await h.page.refresh();assert.equal(h.page.data.noticeConflict,true);assert.equal(h.page.data.notice,'本地');
 await h.page.saveNotice();assert.equal(writes.length,0);confirm=true;await h.page.saveNotice();assert.equal(writes[0].revision,5);assert.equal(writes[0].notice,'本地');assert.equal(h.page.data.noticeConflict,false);
});
for(const change of ['hide','account','refresh'])test('须知确认期间'+change+'阻止旧保存',async()=>{
 let resolve;const h=fixture({}, {showModal:()=>new Promise(r=>resolve=r)});await h.page.refresh();h.page.setData({notice:'草稿',noticeConflict:true});const task=h.page.saveNotice();
 if(change==='hide')h.page.onHide();else if(change==='account')h.api.getSession=()=>({...session,token:'B'});else await h.page.refresh();
 resolve({confirm:true});await task;assert.equal(h.posts.length,0);
});
