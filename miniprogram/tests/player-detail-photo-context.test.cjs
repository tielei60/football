const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function harness() {
  let session = {token:'a',serverOrigin:'https://test.invalid',user:{id:1},team:{id:1}};
  let request = async url => url === '/players' ? [{id:'p1',name:'甲',positions:[]}] : {players:[],filter:{label:'全部'}};
  const navigations = [];
  const wx = {navigateTo: v=>navigations.push(v.url),stopPullDownRefresh(){}};
  const api = {getSession:()=>session,ensureSession:async()=>({user:session.user,team:session.team}),request:(...args)=>request(...args)};
  const module = {exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/shared.js'),'utf8'),{
    module,wx,require: name=> name.includes('api') ? api : name.includes('media') ? {imageSource:x=>x} : {playerInitial:()=> '甲'},
  });
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/player-detail/index.js'),'utf8'),{
    Page:x=>definition=x,wx,require:name=>name.includes('shared') ? module.exports : {abort(){}},
  });
  const page = {...definition,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};
  page.onLoad({id:'p1'});
  return {page,navigations,setSession:s=>session=s,current:()=>session,setRequest:r=>request=r};
}
test('成功加载同一账号及球员后才允许进入照片，凭据不进入页面数据',async()=>{
  const h=harness();h.page.openPhotos();assert.equal(h.navigations.length,0);
  await h.page.refresh();h.page.openPhotos();assert.equal(h.navigations[0],'/pages/player-photos/index?id=p1');
  assert.equal(JSON.stringify(h.page.data).includes('token'),false);
});
test('账号、球队、服务地址或令牌改变后不能沿用旧照片入口',async()=>{
  for(const change of [s=>null,s=>({...s,token:'b'}),s=>({...s,serverOrigin:'https://other.invalid'}),s=>({...s,user:{id:2}}),s=>({...s,team:{id:2}})]){
    const h=harness();await h.page.refresh();h.setSession(change(h.current()));h.page.openPhotos();assert.equal(h.navigations.length,0);
  }
});
test('展示球员或路由球员不一致，以及隐藏卸载均拒绝导航',async()=>{
  for(const change of [p=>p.id='p2',p=>p.data.player.id='p2',p=>p.onHide(),p=>p.onUnload()]){
    const h=harness();await h.page.refresh();change(h.page);h.page.openPhotos();assert.equal(h.navigations.length,0);
  }
});
test('刷新失败不复用旧入口',async()=>{
  const h=harness();await h.page.refresh();h.setRequest(async()=>{throw Error('失败');});
  await h.page.refresh();h.page.openPhotos();assert.equal(h.navigations.length,0);
  assert.equal(h.page._photoContext,null);
});
test('刷新期间及旧请求迟到不覆盖新账号的照片上下文',async()=>{
  const h=harness();let resolve;const gate=new Promise(r=>resolve=r);
  h.setRequest(async url=>{await gate;return url==='/players'?[{id:'p1',name:'甲'}]:{players:[]};});
  const old=h.page.refresh();await Promise.resolve();h.page.openPhotos();assert.equal(h.navigations.length,0);
  h.setSession({...h.current(),token:'b',user:{id:2}});
  h.setRequest(async url=>url==='/players'?[{id:'p1',name:'乙'}]:{players:[]});
  await h.page.refresh();resolve();await old;h.page.openPhotos();assert.equal(h.navigations.length,1);
  assert.equal(h.page._photoContext.token,'b');assert.equal(h.page.data.player.name,'乙');
});
test('原地换账号时旧响应不会生成可用入口或回填旧球员',async()=>{
  const h=harness();let resolve;const gate=new Promise(r=>resolve=r);
  h.setRequest(async url=>{await gate;return url==='/players'?[{id:'p1',name:'甲'}]:{players:[]};});
  const pending=h.page.refresh();await Promise.resolve();
  h.setSession({...h.current(),token:'b',user:{id:2}});resolve();await pending;
  h.page.openPhotos();assert.equal(h.navigations.length,0);assert.equal(h.page.data.player,null);
});
test('加载、错误和忙碌状态不放行；失败后重新加载成功可进入',async()=>{
  const h=harness();await h.page.refresh();
  for(const [key,value] of [['loading',true],['error','失败'],['busy',true]]){
    h.page.data[key]=value;h.page.openPhotos();assert.equal(h.navigations.length,0);h.page.data[key]=key==='error'?'':false;
  }
  h.setRequest(async()=>{throw Error('失败');});await h.page.refresh();
  h.setRequest(async url=>url==='/players'?[{id:'p1',name:'甲'}]:{players:[]});
  await h.page.refresh();h.page.openPhotos();assert.equal(h.navigations.length,1);
});
