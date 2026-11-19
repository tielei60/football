// Isolated fixtures run the actual controller/admin lifecycle and official WXML compiler.
// This is not a native-device visual or production-data test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {wxmlToJs} = require('miniprogram-compiler');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const renderPage = new Function('window', wxmlToJs(root))({});
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...(tree.children || []).flatMap(nodes)] : []; }
const byClass = (tree, cls) => nodes(tree).filter(n => (n.attr?.class || '').split(' ').includes(cls));
const content = tree => typeof tree === 'string' ? tree : (tree?.children || []).map(content).join('');
const fixturePlayer = patch => ({id:'fixture-player',name:'匿名测试姓名',number:0,positions:['中场'],status:'active',membershipConfirmed:true,membershipKind:'guest',revision:4,avatar:'',...patch});
function fixture({reply, error, role = 'admin', modalResult} = {}) {
  let token = 'owner-a', modal, resolveModal, definition, currentRole = role;
  const requests = [], toasts = [], redirects = [];
  const ui = {
    showModal(_page, options) {modal = options; return modalResult ? Promise.resolve(modalResult) : new Promise(resolve => {resolveModal = resolve;});},
    abort() {resolveModal?.({confirm:false,aborted:true});},
    showToast(_page, options) {toasts.push(options.title);},
  };
  const api = {
    getSession: () => ({token}), ensureSession: async () => ({user:{role:currentRole}}),
    request: async (...args) => {requests.push(plain(args));if(error) throw error;return typeof reply === 'function' ? reply(...args) : reply || fixturePlayer({membershipKind:'member',revision:5});},
    capabilities: async () => ({wechat:false}),
  };
  const shared = {api,assetUrl:value=>value || '',safeSetData:(page,data)=>page.setData(data),fail:(page,error)=>page.setData({error:error.message}),unload(){this._disposed=true;}};
  const adminModule = {exports:{}};
  const wx = {stopPullDownRefresh(){},redirectTo:result=>redirects.push(result.url),setNavigationBarTitle(){}};
  vm.runInNewContext(read('pages/manage-team/admin.js'), {module:adminModule,require:name=>name==='../../utils/ui'?ui:shared,wx});
  vm.runInNewContext(read('pages/manage-player/index.js'), {Page:value=>{definition=value;},require:name=>name==='../manage-team/admin'?adminModule.exports:name==='../../utils/ui'?ui:{playerInitial:()=> '匿'},wx});
  const page = {...definition,id:'fixture-player',_epoch:1,_adminView:0,_ownerToken:token,_adminLoaded:true,
    data:{...plain(definition.data),id:'fixture-player',loading:false,authorized:true,membershipKind:'guest',revision:4,
      avatar:'unsaved-local-avatar',form:{name:'未保存姓名',number:'0',positions:['中场'],preferredFoot:'双脚',note:'未保存备注'}},
    setData(patch){Object.assign(this.data,patch);},
    _imageData:'unsaved-image-bytes',
  };
  return {page,requests,toasts,redirects,api,admin:adminModule.exports,get modal(){return modal;},
    confirm(value=true){assert.ok(resolveModal);resolveModal({confirm:value});},
    changeOwner(){token='owner-b';},changeRole(value){currentRole=value;}};
}
test('转正只提交目标ID与revision；保留全部未保存资料、头像、账号和历史入口',async()=>{
  const f=fixture();const draft=plain(f.page.data.form), pending=f.page.promote();
  assert.equal(f.page.data.promoteConfirming,true);assert.equal(f.requests.length,0);
  assert.match(f.modal.content,/照片和比赛历史均保留/);assert.match(f.modal.content,/账号需重新登录/);assert.match(f.modal.content,/未保存.*不会提交/);
  f.confirm();await pending;
  assert.deepEqual(f.requests,[['/players/fixture-player/promote','POST',{revision:4}]]);
  assert.equal(f.page.id,'fixture-player');assert.equal(f.page.data.id,'fixture-player');assert.equal(f.page.data.revision,5);assert.equal(f.page.data.membershipKind,'member');
  assert.deepEqual(plain(f.page.data.form),draft);assert.equal(f.page.data.avatar,'unsaved-local-avatar');assert.equal(f.page._imageData,'unsaved-image-bytes');
  assert.equal(f.page.data.busy,false);assert.equal(f.page.data.promoteConfirming,false);assert.deepEqual(f.toasts,['已转为正式球员']);
  await f.page.promote();assert.equal(f.requests.length,1);
});
test('取消和重复点击均不重复请求，确认锁最终释放',async()=>{
  for(const confirm of [false]){
    const f=fixture(),before=plain(f.page.data),pending=f.page.promote();
    await f.page.promote();f.confirm(confirm===undefined?false:confirm);await pending;
    assert.equal(f.requests.length,0);assert.deepEqual(plain(f.page.data),before);assert.equal(f.page._promotionPrompt,null);
  }
});
test('无弹框宿主返回中止时不提交且释放锁',async()=>{const f=fixture({modalResult:{confirm:false,aborted:true}});await f.page.promote();assert.equal(f.requests.length,0);assert.equal(f.page.data.promoteConfirming,false);assert.equal(f.page._promotionPrompt,null);});
for(const patch of [{loading:true},{busy:true},{conflict:true},{uncertain:true},{authorized:false},{error:'匿名错误'},{status:'inactive'},{membershipKind:'member'}]) test('转正入口门禁 '+JSON.stringify(patch),async()=>{
 const f=fixture();Object.assign(f.page.data,patch);await f.page.promote();assert.equal(f.modal,undefined);assert.equal(f.requests.length,0);
});
for(const change of ['owner','hide','unload','revision','id','epoch','role']) test('确认期间变化不得派发转正 '+change,async()=>{
 const f=fixture(),pending=f.page.promote();
 if(change==='owner')f.changeOwner();if(change==='hide')f.page.onHide();if(change==='unload')f.page.onUnload();if(change==='revision')f.page.data.revision++;if(change==='id')f.page.id='other-player';if(change==='epoch')f.page._epoch++;if(change==='role')f.changeRole('player');
 f.confirm();await pending;assert.equal(f.requests.length,0);assert.equal(f.page.data.membershipKind,'guest');assert.equal(f.toasts.length,0);
});
for(const status of [400,401,403,409,428,0,503]) test('转正错误 '+status+' 不改身份与草稿，冲突/未知结果阻止重复写',async()=>{
 const f=fixture({error:Object.assign(new Error('匿名失败'),{status})}),draft=plain(f.page.data.form),pending=f.page.promote();f.confirm();await pending;
 assert.equal(f.requests.length,1);assert.equal(f.page.data.membershipKind,'guest');assert.equal(f.page.data.revision,4);assert.deepEqual(plain(f.page.data.form),draft);assert.equal(f.page._imageData,'unsaved-image-bytes');
 assert.equal(f.page.data.busy,false);assert.equal(f.page.data.promoteConfirming,false);assert.equal(f.page.data.conflict,status===409);assert.equal(f.page.data.uncertain,status===0||status>=500);
 if(f.page.data.uncertain){assert.match(f.page.data.actionError,/转正结果未确认/);assert.doesNotMatch(f.page.data.actionError,/新建/);f.page.backToList();assert.deepEqual(f.redirects,['/pages/manage-players/index']);}
 if(f.page.data.uncertain||f.page.data.conflict){await f.page.promote();assert.equal(f.requests.length,1);}
});
for(const result of [null,{id:'other-player',membershipKind:'member',revision:5},{id:'fixture-player',membershipKind:'guest',revision:5},{id:'fixture-player',membershipKind:'member',revision:3}]) test('不完整或错对象回执不得乐观转正 '+JSON.stringify(result),async()=>{
 const f=fixture({reply:()=>result}),pending=f.page.promote();f.confirm();await pending;assert.equal(f.page.data.membershipKind,'guest');assert.equal(f.page.data.revision,4);assert.equal(f.page.data.uncertain,true);
});
test('请求期间换账号：旧结果不污染新身份；隐藏成功回执只在原身份返回时应用',async()=>{
 for(const change of ['owner','hide']){
  let resolve;const f=fixture({reply:()=>new Promise(r=>{resolve=r;})}),pending=f.page.promote();f.confirm();await flush();assert.equal(f.requests.length,1);
  if(change==='owner')f.changeOwner();else f.page.onHide();
  resolve(fixturePlayer({membershipKind:'member',revision:5}));await pending;
  assert.equal(f.page.data.membershipKind,'guest');assert.equal(f.page.data.revision,4);
  if(change==='hide'){
   assert.ok(f.page._adminReceipt);await f.admin.show.call(f.page);assert.equal(f.page.data.membershipKind,'member');assert.equal(f.page.data.revision,5);assert.equal(f.page.data.form.name,'未保存姓名');assert.equal(f.page._imageData,'unsaved-image-bytes');
  } else assert.equal(f.page._adminReceipt,undefined);
 }
});
test('当前revision已正式成员回执幂等可接受；普通保存不夹带身份字段',async()=>{
 const f=fixture({reply:fixturePlayer({membershipKind:'member',revision:4})}),pending=f.page.promote();f.confirm();await pending;
 assert.equal(f.page.data.membershipKind,'member');assert.equal(f.page.data.revision,4);
 await f.page.save();assert.equal(f.requests.length,2);const [url,method,body]=f.requests[1];assert.equal(url,'/players/fixture-player');assert.equal(method,'PUT');assert.equal('membershipKind' in body,false);assert.equal(body.avatar,'unsaved-image-bytes');
});
test('接口投影仅显式guest标记临时身份，不混淆状态待确认；昵称保留',()=>{
 const mod={exports:{}};
 vm.runInNewContext(read('pages/shared.js'),{module:mod,require:name=>name.includes('player-initial')?{playerInitial:()=> '匿'}:name.includes('media')?{imageSource:x=>x}:{}});
 for(const membershipKind of [undefined,'member','guest'])for(const membershipConfirmed of [false,true]){
  const projected=mod.exports.playerView(fixturePlayer({membershipKind,membershipConfirmed,nickname:'匿名昵称'}));
  assert.equal(projected.membershipKind,membershipKind==='guest'?'guest':'member');assert.equal(projected.nickname,'匿名昵称');assert.equal(projected.membershipConfirmed,membershipConfirmed);
 }
});
test('真实模板：两种列表只有小图标及无障碍名称，不出现临时文字；详情明确身份',()=>{
 const visible=[fixturePlayer(),fixturePlayer({id:'member',membershipKind:'member'}),fixturePlayer({id:'unknown',membershipKind:'member',membershipConfirmed:false})];
 for(const route of ['players','manage-players']){
  const data={visible,players:visible,loading:false,error:'',authorized:true};
  const tree=renderPage('pages/'+route+'/index.wxml')(data),icons=byClass(tree,'temporary-player-marker');
  assert.equal(icons.length,1);assert.equal(icons[0].attr.ariaLabel,'临时球员');assert.equal(icons[0].attr.ariaRole,'img');assert.equal(content(icons[0]),'');assert.doesNotMatch(content(tree),/临时球员/);
  for(const patch of [{loading:true},{error:'匿名失败'}])assert.equal(byClass(renderPage('pages/'+route+'/index.wxml')({...data,...patch}),'temporary-player-marker').length,0);
 }
 for(const membershipKind of ['member','guest']){
  const tree=renderPage('pages/player-detail/index.wxml')({loading:false,error:'',player:fixturePlayer({membershipKind})});
  assert.ok(content(tree).includes(membershipKind==='guest'?'临时球员':'正式球员'));assert.ok(content(tree).includes('出场照片'));
 }
});
test('管理模板：仅管理员已载入临时球员能看到转正，归档/冲突/未知/忙碌禁用',()=>{
 const f=fixture(), render=patch=>renderPage('pages/manage-player/index.wxml')({...f.page.data,...patch});
 assert.equal(byClass(render({}),'promote-player').length,1);
 for(const patch of [{id:''},{authorized:false},{loading:true},{error:'匿名失败'},{membershipKind:'member'}])assert.equal(byClass(render(patch),'promote-player').length,0);
 for(const patch of [{busy:true},{promoteConfirming:true},{conflict:true},{uncertain:true},{status:'inactive'}])assert.equal(byClass(render(patch),'promote-player')[0].attr.disabled,true);
});
test('新增身份与转正代码仅精确逆投影；原业务、照片上下文和所有基线哈希保留',()=>{
 const contract=require('./guest-player-ui-projection.json'),{normalize}=require('./guest-player-ui-projection.cjs');
 for(const [file,sha] of Object.entries(contract.sha256)){
  const source=read(file);assert.equal(crypto.createHash('sha256').update(normalize(file,source)).digest('hex'),sha,file);
  for(const {after} of contract.changes[file]){
   assert.throws(()=>normalize(file,source.replace(after,after+after)));assert.throws(()=>normalize(file,source.replace(after,after.replace(/\S/,'!'))));
  }
  assert.equal(normalize(file,source+'\nextra'),normalize(file,source)+'\nextra');
 }
});
