const { uiBridge } = require("./ui-fixture.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const session = {
  user: { id: 1, role: "admin", playerId: "p1" },
  team: { id: 1, name: "测试球队" },
};
function setup(name, overrides = {}, wxOverrides = {}) {
  const events = [];
  const disk = new Map();
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
      env: { USER_DATA_PATH: "/wx-test" },
      getFileSystemManager: () => ({
        mkdirSync() {},
        writeFileSync(p, v) {
          disk.set(p, Buffer.from(v, "base64"));
        },
        statSync(p) {
          if (!disk.has(p)) throw Error("ENOENT");
          return { size: disk.get(p).length };
        },
        unlinkSync(p) {
          if (!disk.delete(p)) throw Error("ENOENT");
        },
        readdirSync(dir) {
          return [...disk.keys()]
            .filter((p) => p.startsWith(dir + "/"))
            .map((p) => p.slice(dir.length + 1));
        },
      }),
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
  function instantiate() {
    return {
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
    disk,
    shared: load(path.join(root, "pages/shared.js")),
  };
}

const listing = {
  player: { id: "p1", name: "演练球员", number: null, status: "active" },
  revision: 3,
  photos: [
    { id: 1, caption: "First" },
    { id: 2, caption: "Second" },
  ],
  coverPhotoId: 1,
};
function fixture(overrides = {}, wxOverrides = {}) {
  const storage = new Map(),
    posts = [];
  const h = setup(
    "player-photos",
    {
      getSession: () => ({ ...session, token: "A" }),
      request: async (path, method, data) => {
        if (method) {
          posts.push({ path, method, data });
          return { ...listing, revision: 4 };
        }
        return path.endsWith("/photos")
          ? listing
          : { dataUrl: "data:image/png;base64,iVBORw0KGgoBAgME" };
      },
      ...overrides,
    },
    {
      getStorageSync: (k) => storage.get(k),
      setStorageSync: (k, v) => storage.set(k, v),
      removeStorageSync: (k) => storage.delete(k),
      ...wxOverrides,
    },
  );
  h.page.id = "p1";
  return { ...h, storage, posts };
}
const event = (id, delta) => ({ currentTarget: { dataset: { id, delta } } });
function image(p) {
  p._image = "data:image/png;base64,iVBORw0KGgoBAgME";
  p.setData({ preview: "wxfile://picked", caption: "New" });
}
test("metadata projects safe fields; read-only member cannot mutate", async () => {
  const h = fixture({
    ensureSession: async () => ({
      ...session,
      user: { id: 1, role: "player" },
    }),
  });
  await h.page.refresh();
  assert.equal(h.page.data.admin, false);
  await h.page.cover(event(2));
  assert.equal(h.posts.length, 0);
  assert.equal(JSON.stringify(h.page.data).includes("data:image"), false);
});
test("caption and order use album revision, never player or avatar endpoint", async () => {
  const h = fixture();
  await h.page.refresh();
  h.page.captionInput({ ...event(1), detail: { value: "Draft" } });
  await h.page.saveCaption(event(1));
  assert.equal(h.posts[0].data.caption, "Draft");
  assert.equal(h.posts[0].data.revision, 3);
  await h.page.move(event(2, -1));
  assert.deepEqual(Array.from(h.posts[1].data.photoIds), [2, 1]);
  assert.ok(h.posts.every((x) => x.path.startsWith("/players/p1/photos")));
});
test("409 retains caption and blocks writes pending reload", async () => {
  const h = fixture();
  await h.page.refresh();
  h.page.captionInput({ ...event(1), detail: { value: "Keep" } });
  h.api.request = async () => {
    throw Object.assign(new Error("Conflict"), { status: 409 });
  };
  await h.page.saveCaption(event(1));
  assert.equal(h.page.data.conflict, true);
  assert.equal(h.page.data.photos[0].draft, "Keep");
  assert.equal(h.page.editable(), false);
});
test("unknown upload reuses same id across instances and stores receipt without image/token", async () => {
  const h = fixture();
  await h.page.refresh();
  image(h.page);
  const ids = [];
  h.api.request = async (path, method, data) => {
    if (method) {
      ids.push(data.requestId);
      throw new Error("Unknown");
    }
    return path.endsWith("/photos")
      ? listing
      : { dataUrl: "data:image/png;base64,iVBORw0KGgoBAgME" };
  };
  await h.page.upload();
  assert.equal(h.page.data.uncertain, true);
  assert.equal(h.storage.size, 1);
  assert.equal(JSON.stringify([...h.storage]).includes("data:image"), false);
  assert.equal(JSON.stringify([...h.storage]).includes("token"), false);
  const p = h.newPage();
  p.id = "p1";
  await p.refresh();
  assert.equal(p.data.uncertain, true);
  await p.upload();
  assert.equal(ids[0], ids[1]);
});
test("persisted receipt without in-memory image blocks fresh uploads until explicit check", async () => {
  const h = fixture({}, { getStorageSync: () => ({ requestId: "old" }) });
  await h.page.refresh();
  assert.equal(h.page.data.recoveryBlocked, true);
  image(h.page);
  await h.page.upload();
  assert.equal(h.posts.length, 0);
});
test("hidden preflight never dispatches a write or receipt", async () => {
  const h = fixture();
  await h.page.refresh();
  image(h.page);
  let resolve;
  h.api.ensureSession = () => new Promise((r) => (resolve = r));
  const task = h.page.upload();
  h.page.onHide();
  resolve(session);
  await task;
  assert.equal(h.posts.length, 0);
  assert.equal(h.storage.size, 0);
});
test("double upload and second page cannot repeat in-flight request", async () => {
  const h = fixture();
  await h.page.refresh();
  image(h.page);
  let finish,
    count = 0;
  const read = h.api.request;
  h.api.request = (p, m, d) =>
    m ? (count++, new Promise((r) => (finish = r))) : read(p, m, d);
  const task = h.page.upload();
  await new Promise((r) => setImmediate(r));
  await h.page.upload();
  const p = h.newPage();
  p.id = "p1";
  await p.refresh();
  await p.upload();
  assert.equal(count, 1);
  finish(listing);
  await task;
  assert.equal(h.storage.size, 0);
});
test("old image selection callback after account change does not write preview", async () => {
  let choose;
  const h = fixture({}, { chooseMedia: (o) => (choose = o) });
  await h.page.refresh();
  h.page.choose();
  h.api.getSession = () => ({ ...session, token: "B" });
  choose.success({ tempFiles: [{ size: 1, tempFilePath: "wxfile://old" }] });
  assert.equal(h.page.data.preview, "");
});

test("native picker hide/show keeps chosen file and caption without duplicate refresh", async () => {
  let chooser, read;
  const h = fixture(
    {},
    {
      chooseMedia: (o) => (chooser = o),
      getFileSystemManager: () => ({ readFile: (o) => (read = o) }),
    },
  );
  await h.page.refresh();
  h.page.setData({ caption: "保留说明" });
  h.page.choose();
  h.page.onHide();
  await h.page.onShow();
  chooser.success({
    tempFiles: [{ size: 20, tempFilePath: "wxfile://chosen" }],
  });
  read.success({ data: "iVBORw0KGgoAAA" });
  assert.equal(h.page.data.preview, "wxfile://chosen");
  assert.equal(h.page.data.caption, "保留说明");
  assert.equal(h.posts.length, 0);
});
test("preview hide/show preserves caption drafts and session change hides old photos", async () => {
  let preview;
  const h = fixture({}, { previewImage: (o) => (preview = o) });
  await h.page.refresh();
  await h.page.loadPictures();
  h.page.captionInput({ ...event(1), detail: { value: "尚未保存" } });
  h.page.previewPhoto(event(1));
  assert.ok(preview);
  h.page.onHide();
  await h.page.onShow();
  assert.equal(h.page.data.photos[0].draft, "尚未保存");
  h.page.onHide();
  h.api.getSession = () => ({ ...session, token: "B" });
  await h.page.onShow();
  assert.equal(h.page.data.photos.length, 0);
  assert.ok(h.page.data.error);
});
test("nine photos load serially as short paths, preserve server order and stop after hide", async () => {
  let inFlight = 0,
    peak = 0,
    count = 0;
  const h = fixture({
    request: async (path) => {
      if (path.endsWith("/photos"))
        return {
          ...listing,
          photos: Array.from({ length: 9 }, (_, i) => ({
            id: 9 - i,
            caption: "照片",
          })),
        };
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      count++;
      return { dataUrl: "data:image/png;base64,iVBORw0KGgoBAgME" };
    },
  });
  await h.page.refresh();
  await h.page.loadPictures();
  assert.equal(h.page.data.photos.length, 9);
  assert.equal(h.page.data.photos[0].id, 9);
  assert.ok(peak <= 2); // refresh may begin one request before explicit retry supersedes it
  assert.equal(JSON.stringify(h.page.data).includes("base64"), false);
  h.page.onHide();
  const before = count;
  await h.page.loadPictures();
  assert.equal(count, before);
});
test("navigation entries are explicit and album never substitutes avatar", () => {
  for (const name of ["manage-player", "player-detail"]) {
    const html = fs.readFileSync(
      path.join(root, "pages", name, "index.wxml"),
      "utf8",
    );
    assert.equal((html.match(/bindtap="openPhotos"/g) || []).length, 1);
  }
  const source = fs.readFileSync(
    path.join(root, "pages/player-photos/index.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /request\([^\n]*avatar/);
  const html = fs.readFileSync(
    path.join(root, "pages/player-photos/index.wxml"),
    "utf8",
  );
  assert.match(html, /playerName/);
  assert.match(html, /busy\|\|conflict\|\|uncertain\|\|recoveryBlocked/);
});

test("dedicated cache survives system preview hide, reuses on refresh and clears on unload", async () => {
  const h = fixture();
  await h.page.refresh();
  await h.page.loadPictures();
  const paths = h.page.data.photos.map((p) => p.src);
  assert.ok(paths.every((p) => p.includes("/football-player-photo-images/")));
  assert.equal(h.disk.size, 2);
  h.page.onHide();
  assert.equal(h.disk.size, 2);
  await h.page.onShow();
  await h.page.refresh();
  assert.deepEqual(
    h.page.data.photos.map((p) => p.src),
    paths,
  );
  h.page.onUnload();
  assert.equal(h.disk.size, 0);
  assert.equal(
    h.page.cachePicture("late", "data:image/png;base64,iVBORw0KGgoBAgME"),
    "",
  );
});
test("successful removal and server-pruned IDs release only album cached files", async () => {
  const h = fixture();
  await h.page.refresh();
  await h.page.loadPictures();
  const removed = h.page.data.photos[0].src;
  h.api.request = async (p, m) =>
    p.endsWith("/photos")
      ? { ...listing, photos: [listing.photos[1]] }
      : { dataUrl: "data:image/png;base64,iVBORw0KGgoBAgME" };
  await h.page.refresh();
  assert.equal(h.disk.has(removed), false);
  assert.equal(h.disk.size, 1);
});
test("pending candidate request IDs get isolated paths, completed candidate cannot become duplicate draft", async () => {
  const h = fixture();
  await h.page.refresh();
  image(h.page);
  h.api.request = async (p, m) => {
    if (m) throw Error("unknown");
    return p.endsWith("/photos")
      ? listing
      : { dataUrl: "data:image/png;base64,iVBORw0KGgoBAgME" };
  };
  await h.page.upload();
  const second = h.newPage();
  second.id = "p1";
  await second.refresh();
  const pendingPath = second.data.preview;
  assert.ok(pendingPath.includes("/football-player-photo-images/"));
  h.api.request = async (p, m) =>
    m
      ? listing
      : p.endsWith("/photos")
        ? listing
        : { dataUrl: "data:image/png;base64,iVBORw0KGgoBAgME" };
  await h.page.upload();
  await second.refresh();
  assert.equal(second.data.preview, "");
  assert.equal(second._image, null);
  assert.equal(h.disk.has(pendingPath), false);
});
test("image error invalidates corrupt local entry so retry fetch can create a new path", async () => {
  const h = fixture();
  await h.page.refresh();
  await h.page.loadPictures();
  const old = h.page.data.photos[0].src;
  h.page.photoError(event(1));
  assert.equal(h.disk.has(old), false);
  await h.page.retryPhoto(event(1));
  assert.notEqual(h.page.data.photos[0].src, old);
  assert.ok(h.page.data.photos[0].src);
});

for (const status of [400, 409])
  test(
    "pending " +
      status +
      " refresh clears only released cache preview and retains caption",
    async () => {
      const h = fixture();
      await h.page.refresh();
      image(h.page);
      const read = async (p) =>
        p.endsWith("/photos")
          ? listing
          : { dataUrl: "data:image/png;base64,iVBORw0KGgoBAgME" };
      h.api.request = async (p, m) => {
        if (m) throw Error("unknown");
        return read(p);
      };
      await h.page.upload();
      const second = h.newPage();
      second.id = "p1";
      await second.refresh();
      const preview = second.data.preview;
      assert.ok(h.disk.has(preview));
      h.api.request = async (p, m) => {
        if (m) throw Object.assign(Error("rejected"), { status });
        return read(p);
      };
      await second.upload();
      assert.equal(second.data.uncertain, false);
      await second.refresh();
      assert.equal(second.data.preview, "");
      assert.equal(second._image, null);
      assert.equal(second.data.caption, "New");
      assert.equal(h.disk.has(preview), false);
      assert.match(second.data.actionError, /重新选择照片.*说明已保留/);
    },
  );
test("ordinary system selected preview survives a rejected upload and preserving refresh", async () => {
  const h = fixture();
  await h.page.refresh();
  image(h.page);
  const imageData = h.page._image;
  h.api.request = async (p, m) => {
    if (m) throw Object.assign(Error("rejected"), { status: 400 });
    return p.endsWith("/photos")
      ? listing
      : { dataUrl: "data:image/png;base64,iVBORw0KGgoBAgME" };
  };
  await h.page.upload();
  await h.page.refresh();
  assert.equal(h.page.data.preview, "wxfile://picked");
  assert.equal(h.page._image, imageData);
  assert.equal(h.page.data.caption, "New");
  assert.equal(h.page.data.actionError, "");
});
test('从AI返回通过真实onShow刷新封面列表并保留同账号说明和选图草稿',async()=>{
 const h=fixture();await h.page.onShow();h.page.data.photos[0].draft='未保存说明';image(h.page);const raw=h.page._image;
 h.page.openAi();assert.equal(h.page._needsRefresh,true);h.page.onHide();
 let reads=0;h.api.request=async p=>{if(p.endsWith('/photos')){reads++;return {...listing,revision:8,coverPhotoId:3,photos:[...listing.photos,{id:3,caption:'模拟封面',generated:true,simulation:true}]};}return {dataUrl:'data:image/png;base64,iVBORw0KGgoBAgME'};};
 await h.page.onShow();assert.equal(reads,1);assert.equal(h.page.revision,8);assert.equal(h.page.data.photos.length,3);assert.equal(h.page.data.coverPhotoId,3);assert.equal(h.page.data.photos[0].draft,'未保存说明');assert.equal(h.page.data.caption,'New');assert.equal(h.page.data.preview,'wxfile://picked');assert.equal(h.page._image,raw);assert.equal(h.page._needsRefresh,false);
});
test('AI未写入即返回仍安全重读且不丢草稿（不模拟系统导航失败回调）',async()=>{
 const h=fixture({}, {navigateTo(){}});await h.page.onShow();h.page.data.photos[0].draft='原草稿';h.page.openAi();h.page.onHide();await h.page.onShow();assert.equal(h.page.data.coverPhotoId,1);assert.equal(h.page.data.photos[0].draft,'原草稿');assert.equal(h.page._needsRefresh,false);
});
test('AI返回前换账号不读取旧球员相册或保留旧草稿',async()=>{
 const h=fixture();await h.page.onShow();image(h.page);h.page.openAi();h.page.onHide();let reads=0;h.api.getSession=()=>({...session,token:'B'});h.api.request=async()=>{reads++;return listing;};await h.page.onShow();assert.equal(reads,0);assert.equal(h.page.data.photos.length,0);assert.equal(h.page.data.preview,'');assert.match(h.page.data.error,/登录已变化/);
});
test('AI返回的旧元数据请求迟到不能覆盖较新相册与封面',async()=>{
 const h=fixture();await h.page.onShow();h.page.openAi();h.page.onHide();let resolve,reads=0;
 h.api.request=async p=>{if(p.endsWith('/photos')){if(++reads===1)return new Promise(r=>resolve=r);return {...listing,revision:12,coverPhotoId:2};}return {dataUrl:'data:image/png;base64,iVBORw0KGgoBAgME'};};
 const returning=h.page.onShow();for(let i=0;i<8;i++)await Promise.resolve();assert.equal(typeof resolve,'function');await h.page.refresh();resolve({...listing,revision:9,coverPhotoId:1});await returning;assert.equal(h.page.revision,12);assert.equal(h.page.data.coverPhotoId,2);
});

test('说明三方比较按照片ID，未编辑跟随最新、脏稿保留且要求确认',async()=>{
 let rows=structuredClone(listing.photos),revision=3,confirm=false;const writes=[];
 const h=fixture({request:async(path,method,data)=>{if(method){writes.push(data);rows=rows.map(x=>x.id===1?{...x,caption:data.caption}:x);revision++;return {...listing,photos:rows,revision};}return path.endsWith('/photos')?{...listing,photos:rows,revision}:{dataUrl:'data:image/png;base64,iVBORw0KGgoBAgME'};}},{showModal:()=>Promise.resolve({confirm})});
 await h.page.refresh();rows[0].caption='远程一';revision++;await h.page.refresh();assert.equal(h.page.data.photos[0].draft,'远程一');
 h.page.captionInput({currentTarget:{dataset:{id:1}},detail:{value:'本地草稿'}});rows=[rows[1],{...rows[0],caption:'远程二'}];revision++;await h.page.refresh();const p=h.page.data.photos.find(x=>x.id===1);assert.equal(p.draft,'本地草稿');assert.equal(p.captionConflict,true);
 await h.page.saveCaption(event(1));assert.equal(writes.length,0);confirm=true;await h.page.saveCaption(event(1));assert.deepEqual(JSON.parse(JSON.stringify(writes[0])),{revision:5,caption:'本地草稿'});assert.equal(h.page.data.photos.find(x=>x.id===1).captionConflict,false);
});
for(const change of ['hide','account','refresh','remove'])test('照片说明确认期间'+change+'阻止旧保存',async()=>{
 let resolve;const h=fixture({}, {showModal:()=>new Promise(r=>resolve=r)});await h.page.refresh();h.page.data.photos[0].draft='草稿';h.page.data.photos[0].captionConflict=true;const task=h.page.saveCaption(event(1));
 if(change==='hide')h.page.onHide();else if(change==='account')h.api.getSession=()=>({...session,token:'B'});else if(change==='remove')h.page.setData({photos:[]});else await h.page.refresh();
 resolve({confirm:true});await task;assert.equal(h.posts.length,0);
});
for(const status of [0,500,409,400])test('球员排序失败'+status+'按不确定性锁定',async()=>{
 const h=fixture();await h.page.refresh();let calls=0;h.api.request=async(path,method)=>{if(method)calls++;throw Object.assign(Error('失败'),{status});};await h.page.move(event(1,1));assert.equal(h.page.data.conflict,status!==400);if(status!==400){await h.page.move(event(1,1));assert.equal(calls,1);}
});
for(const change of ['hide','account'])test('球员排序未知响应在'+change+'后不污染页面',async()=>{
 const h=fixture();await h.page.refresh();let reject;h.api.request=()=>new Promise((_,r)=>reject=r);const task=h.page.move(event(1,1));await new Promise(r=>setImmediate(r));if(change==='hide')h.page.onHide();else h.api.getSession=()=>({...session,token:'B'});reject(Object.assign(Error('断网'),{status:0}));await task;assert.equal(h.page.data.conflict,false);if(change==='hide')assert.equal(h.page._needsRefresh,true);
});

test('说明确认后服务器再次变化仍以捕获版本提交并由409锁定',async()=>{
 const h=fixture({}, {showModal:()=>Promise.resolve({confirm:true})});await h.page.refresh();h.page.data.photos[0].draft='保留草稿';h.page.data.photos[0].captionConflict=true;let sent;
 h.api.request=async(path,method,data)=>{if(method){sent=data;throw Object.assign(Error('版本变化'),{status:409});}return {};};await h.page.saveCaption(event(1));assert.equal(sent.revision,3);assert.equal(h.page.data.conflict,true);assert.equal(h.page.data.photos[0].draft,'保留草稿');
});

test('同账号隐藏后返回，原排序迟到未知仍锁定核对',async()=>{
 const h=fixture();await h.page.refresh();let reject;
 const original=h.api.request;h.api.request=(path,method,data)=>method?new Promise((_,r)=>reject=r):original(path,method,data);
 const task=h.page.move(event(1,1));await new Promise(r=>setImmediate(r));h.page.onHide();await h.page.onShow();reject(Object.assign(Error('断网'),{status:0}));await task;
 assert.equal(h.page.data.conflict,true);assert.match(h.page.data.actionError,/核对/);
 h.api.request=original;await h.page.refresh();assert.equal(h.page.data.conflict,false);
});

test('超过2MB的选图在读取和上传前拒绝',async()=>{
 let selected,reads=0;const h=fixture({}, {chooseMedia:o=>selected=o,getFileSystemManager:()=>({readFile(){reads++;}})});
 await h.page.refresh();h.page.choose();selected.success({tempFiles:[{size:2097153,tempFilePath:'wxfile://oversize'}]});
 assert.match(h.page.data.actionError,/2 MB/);assert.equal(reads,0);assert.equal(h.posts.length,0);assert.equal(h.page.data.preview,'');
});
test('声明小文件但读到超限字节仍拒绝，不写预览',async()=>{
 let selected;const h=fixture({}, {chooseMedia:o=>selected=o,getFileSystemManager:()=>({readFile:o=>o.success({data:'iVBORw0KGgo'+'A'.repeat(2800000)})})});
 await h.page.refresh();h.page.choose();selected.success({tempFiles:[{size:20,tempFilePath:'wxfile://oversize-body'}]});
 assert.match(h.page.data.actionError,/2 MB/);assert.equal(h.page.data.preview,'');assert.equal(h.posts.length,0);
});
test('9张容量不发起新的上传请求',async()=>{
 const h=fixture();await h.page.refresh();h.page.setData({photos:Array.from({length:9},(_,id)=>({id,caption:'',draft:''}))});image(h.page);await h.page.upload();assert.equal(h.posts.length,0);assert.equal(h.storage.size,0);
});
