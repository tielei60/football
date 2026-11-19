const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(role='player', playerId='p', members=[], responses=[]){let def,token='a',response='',readError=null,serverStatus='published';const puts=[],reads=[],effects=[];const s={api:{getSession:()=>({token}),request:async(url,method,body)=>{if(method==='PUT')return new Promise((resolve,reject)=>puts.push({body,resolve:()=>{response=body.response;resolve({})},reject}));reads.push(url);if(readError)throw readError;return url==='/players'?members:{status:serverStatus,response,rsvps:responses,roster:[]}}},matchView:m=>m,replies:{},value:x=>x,assetUrl:x=>x||'',fail(p,e){p.setData({error:e.message});effects.push(e.status)},unload(){this._disposed=true;this._epoch=(this._epoch||0)+1},async load(p,work){const epoch=p._epoch=(p._epoch||0)+1;p._disposed=false;p.setData({loading:true,error:''});try{const data=await work({user:{role,playerId},team:{name:'t'}});if(epoch===p._epoch&&!p._disposed)p.setData(data)}catch(e){if(epoch===p._epoch&&!p._disposed)s.fail(p,e)}finally{if(epoch===p._epoch&&!p._disposed)p.setData({loading:false})}}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/match-detail/index.js'),'utf8'),{Page:x=>def=x,require:p=>p==='../shared'?s:p.includes('/ui')?{abort(){},showToast:()=>effects.push('toast')}:{matchVenue:()=>({}),point:()=>null},Map,Promise,JSON,encodeURIComponent});return{puts,reads,effects,api:s.api,page:()=>({...def,id:'3',_replyOwner:token,data:{...structuredClone(def.data),loading:false,canReply:true,match:{response:''}},setData(d){Object.assign(this.data,d)}}),token:t=>token=t,status:s=>serverStatus=s,readError:e=>readError=e};}
const event=response=>({currentTarget:{dataset:{response}}});
const tick=()=>new Promise(r=>setImmediate(r));
test('same-token reopened page cannot dispatch a second PUT before first settles and reconciliation finishes',async()=>{const f=fixture(),old=f.page(),next=f.page();const first=old.reply(event('yes'));old.onHide();old.onUnload();const blocked=next.reply(event('no'));await tick();assert.equal(f.puts.length,1);assert.equal(f.reads.length,0);assert.equal(next.data.reconciling,true);f.puts[0].resolve();await Promise.all([first,blocked]);assert.equal(next.data.match.response,'yes');assert.equal(next.data.replyPending,false);const second=next.reply(event('no'));assert.equal(f.puts.length,2);f.puts[1].resolve();await second;assert.equal(next.data.match.response,'no');assert.equal(next.data.busy,false)});
test('unknown result remains locked until GET succeeds; repeated taps only reconcile',async()=>{const f=fixture(),p=f.page();const first=p.reply(event('yes'));f.puts[0].reject(Object.assign(Error('offline'),{status:0}));await first;assert.equal(p.data.replyPending,true);f.readError(Error('read offline'));await p.reply(event('no'));assert.equal(f.puts.length,1);assert.equal(p.data.replyPending,true);assert.equal(p.data.reconciling,false);f.readError(null);await p.refresh();assert.equal(p.data.replyPending,false);const next=p.reply(event('no'));assert.equal(f.puts.length,2);f.puts[1].resolve();await next});
test('known server rejection releases lock, while another token is never blocked by old token',async()=>{const f=fixture(),a=f.page();const first=a.reply(event('yes'));f.puts[0].reject(Object.assign(Error('closed'),{status:409}));await first;assert.equal(a.data.replyPending,false);const retry=a.reply(event('maybe'));assert.equal(f.puts.length,2);a.onHide();f.token('b');const b=f.page(),other=b.reply(event('no'));assert.equal(f.puts.length,3);f.puts[2].resolve();await other;const value=b.data.match.response;f.puts[1].resolve();await retry;assert.equal(b.data.match.response,value)});
test('two waiting page reads cannot clear a later mutation entry',async()=>{const f=fixture(),a=f.page(),b=f.page();const first=a.reply(event('yes'));a.onHide();const waiting=b.refresh();await tick();f.puts[0].resolve();await Promise.all([first,waiting]);const newer=b.reply(event('no'));const c=f.page(),waitNew=c.reply(event('maybe'));await tick();assert.equal(f.puts.length,2);assert.equal(c.data.reconciling,true);f.puts[1].resolve();await Promise.all([newer,waitNew]);assert.equal(c.data.match.response,'no')});

test('loaded A page must not submit after session switches to B',async()=>{const f=fixture(),p=f.page();await p.refresh();assert.equal(p.data.canReply,true);f.token('b');const work=p.reply(event('yes'));const count=f.puts.length;if(count)f.puts[0].resolve();await work;assert.equal(count,0,'old identity page must not send PUT under new identity');});
for(const status of ['cancelled','completed'])test('closed '+status+' known409 preserves response until explicit refresh disables reply',async()=>{const f=fixture(),p=f.page();await p.refresh();f.status(status);const work=p.reply(event('yes'));f.puts[0].reject(Object.assign(Error('仅已发布的比赛可以报名。'),{status:409}));await work;assert.equal(p.data.match.response,'');assert.equal(p.data.replyPending,false);assert.equal(p.data.busy,false);assert.equal(f.effects.includes('toast'),false);assert.match(p.data.actionError,/已发布/);assert.equal(p.data.canReply,true);await p.refresh();assert.equal(p.data.canReply,false);await p.reply(event('no'));assert.equal(f.puts.length,1);});
for(const code of [0,500])for(const status of ['cancelled','completed'])test('unknown '+code+' reconciles closed '+status+' without replay',async()=>{const f=fixture(),p=f.page();await p.refresh();const work=p.reply(event('maybe'));f.puts[0].reject(Object.assign(Error('lost'),{status:code}));await work;assert.equal(p.data.replyPending,true);f.status(status);await p.reply(event('no'));assert.equal(f.puts.length,1);assert.equal(p.data.replyPending,false);assert.equal(p.data.canReply,false);assert.equal(p.data.match.response,'');assert.equal(f.effects.includes('toast'),false);});

test('fresh B reload permits B reply, without permanently blocking switched page',async()=>{const f=fixture(),p=f.page();await p.refresh();f.token('b');await p.reply(event('yes'));assert.equal(f.puts.length,0);await p.refresh();assert.equal(p._replyOwner,'b');const work=p.reply(event('yes'));assert.equal(f.puts.length,1);f.puts[0].resolve();await work;assert.equal(p.data.match.response,'yes');});
test('initial and failed refresh do not grant a reply owner',async()=>{const f=fixture(),p=f.page();delete p._replyOwner;await p.reply(event('yes'));assert.equal(f.puts.length,0);await p.refresh();f.readError(Error('读取失败'));await p.refresh();assert.equal(p._replyOwner,null);await p.reply(event('yes'));assert.equal(f.puts.length,0);f.readError(null);await p.refresh();const work=p.reply(event('yes'));f.puts[0].resolve();await work;assert.equal(p.data.match.response,'yes');});
for(const mode of ['hidden','unload','account','newer'])test('unfinished refresh cannot grant stale owner: '+mode,async()=>{const f=fixture(),p=f.page();await p.refresh();const request=f.api.request;let finish;f.api.request=async(url,method,body)=>method==='PUT'?request(url,method,body):url==='/players'?[]:new Promise(r=>finish=r);const pending=p.refresh();await tick();assert.equal(p._replyOwner,null);await p.reply(event('yes'));assert.equal(f.puts.length,0);if(mode==='hidden')p.onHide();if(mode==='unload')p.onUnload();if(mode==='account')f.token('b');if(mode==='newer'){f.token('b');f.api.request=request;await p.refresh();}finish({status:'published',response:'',rsvps:[],roster:[]});await pending;assert.equal(p._replyOwner,mode==='newer'?'b':null);if(mode!=='newer'){await p.reply(event('yes'));assert.equal(f.puts.length,0);}});

test('关联球员的管理员可以报名，未关联的管理员不能报名',async()=>{
 const f=fixture('admin','p'),p=f.page();await p.refresh();assert.equal(p.data.canReply,true);
 const work=p.reply(event('yes'));assert.equal(f.puts.length,1);assert.equal(f.puts[0].body.response,'yes');f.puts[0].resolve();await work;assert.equal(p.data.match.response,'yes');
 const unlinked=fixture('admin',null),q=unlinked.page();await q.refresh();assert.equal(q.data.canReply,false);await q.reply(event('yes'));assert.equal(unlinked.puts.length,0);
});

test('报名人员按状态分组，保留头像、姓名和缺失头像的首字',async()=>{
 const f=fixture('admin','p',[{id:'p',name:'张铁磊',avatar:'/avatar.png'},{id:'q',name:'小涛'}],[{playerId:'q',response:'maybe'},{playerId:'p',response:'yes'},{playerId:'missing',response:'no'}]);
 const p=f.page();await p.refresh();const groups=JSON.parse(JSON.stringify(p.data.replyGroups));
 assert.deepEqual(groups.map(g=>g.label),['参加','待定','请假']);
 assert.equal(groups[0].players[0].avatar,'/avatar.png');assert.equal(groups[0].players[0].name,'张铁磊');
 assert.equal(groups[1].players[0].avatar,'');assert.equal(groups[1].players[0].initial,'小');assert.equal(groups[2].players[0].name,'历史成员');
});

// 成功提示只针对本次已确认参加，不从核对、失败或迟到结果推断成功。
test('参加成功显示用户主动分享弹层，重复点击和刷新不再提示',async()=>{
 const f=fixture('admin','p'),p=f.page();await p.refresh();const work=p.reply(event('yes'));f.puts[0].resolve();await work;
 assert.equal(p.data.signupShareOpen,true);p.dismissSignupShare();await p.reply(event('yes'));
 assert.equal(f.puts.length,1);assert.equal(p.data.signupShareOpen,false);await p.refresh();assert.equal(p.data.signupShareOpen,false);
});
for(const response of ['maybe','no'])test(response+'更新不触发报名分享邀请',async()=>{
 const f=fixture(),p=f.page();await p.refresh();const work=p.reply(event(response));f.puts[0].resolve();await work;assert.equal(p.data.signupShareOpen,false);
});
for(const mode of ['hidden','account','failed','unknown','read-failed'])test('分享提示不受无效回执触发：'+mode,async()=>{
 const f=fixture(),p=f.page();await p.refresh();const work=p.reply(event('yes'));
 if(mode==='hidden')p.onHide();if(mode==='account')f.token('b');if(mode==='read-failed')f.readError(Error('读取失败'));
 if(mode==='failed'||mode==='unknown')f.puts[0].reject(Object.assign(Error('未确认'),{status:mode==='failed'?409:0}));else f.puts[0].resolve();
 await work;assert.equal(p.data.signupShareOpen,false);
});
test('未关联管理员得到正规账号路径提示，不按姓名或唯一球员猜测',async()=>{
 const f=fixture('admin',null,[{id:'only',name:'管理员'}]),p=f.page();await p.refresh();
 assert.equal(p.data.canReply,false);assert.match(p.data.replyUnavailable,/系统账号/);await p.reply(event('yes'));assert.equal(f.puts.length,0);
});
test('分享弹层采用原生用户分享按钮，不自动调用外部分享',()=>{
 const w=fs.readFileSync(path.join(__dirname,'../pages/match-detail/index.wxml'),'utf8');
 assert.match(w,/wx:if="{{signupShareOpen}}"/);assert.match(w,/signup-share-confirm" open-type="share"/);assert.match(w,/暂不分享/);
});

test('分享时已换账号不沿用旧比赛上下文，弹层关闭',async()=>{const f=fixture(),p=f.page();await p.refresh();p.setData({signupShareOpen:true});f.token('b');assert.equal(p.onShareAppMessage().path,'/pages/home/index');assert.equal(p.data.signupShareOpen,false);});

for(const mode of ['refresh','hidden','disposed','loading','error'])test('无效页面不分享旧比赛：'+mode,async()=>{const f=fixture(),p=f.page();await p.refresh();if(mode==='refresh')p._replyOwner=null;if(mode==='hidden')p._hidden=true;if(mode==='disposed')p._disposed=true;if(mode==='loading')p.data.loading=true;if(mode==='error')p.data.error='读取失败';assert.equal(p.onShareAppMessage().path,'/pages/home/index');});

test('详情对方队徽经本地素材转换并保留坏图回退',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../pages/match-detail/index.js'),'utf8');
 const markup=require('node:fs').readFileSync(require('node:path').join(__dirname,'../pages/match-detail/index.wxml'),'utf8');
 assert.match(source,/opponentCrest: s\.assetUrl\(raw\.opponentSnapshot\?\.logo\)/);assert.match(markup,/wx:if="\{\{match\.opponentCrest\}\}"/);assert.match(markup,/binderror="opponentImageError"/);
});
