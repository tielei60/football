const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function page(name){let definition;let token='A';const s={api:{getSession:()=>({token})}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages',name,'index.js'),'utf8'),{Page:d=>definition=d,require:r=>r.endsWith('/shared')?s:r.endsWith('/admin')?{s}: {},wx:{},console});const p={...definition,data:structuredClone(definition.data),setData(v){Object.assign(this.data,v);}};return{p,setToken:t=>token=t};}
const rows=[{id:'a',name:'甲',number:null,positions:[],status:'active',membershipConfirmed:false},{id:'b',name:'乙',positions:[],status:'inactive',membershipConfirmed:false},{id:'c',name:'丙',positions:[],status:'active'},{id:'d',name:'丁',positions:[],status:'inactive',membershipConfirmed:true}];
for(const name of ['players','manage-players'])test(name+' 待确认含两种技术状态，缺字段保持旧语义',()=>{const {p}=page(name);p.data.status='unconfirmed';const filter=()=>name==='players'?p.filter(rows,'',p.data.status):p.filter(rows);assert.equal(filter().map(x=>x.id).sort().join(','),'a,b');p.data.status='active';assert.equal(filter().map(x=>x.id).sort().join(','),'c');p.data.status='inactive';assert.equal(filter().map(x=>x.id).sort().join(','),'d');});
test('三项成员状态选择保留未知的技术状态，明确选择才确认',()=>{const {p}=page('manage-player');Object.assign(p.data,{authorized:true,loading:false,status:'inactive',membershipConfirmed:false});p._ownerToken='A';p.membership({detail:{value:0}});assert.equal(p.data.status,'inactive');assert.equal(p.data.membershipConfirmed,false);p.membership({detail:{value:1}});assert.equal(p.data.status,'active');assert.equal(p.data.membershipConfirmed,true);p.membership({detail:{value:2}});assert.equal(p.data.status,'inactive');assert.equal(p.data.membershipConfirmed,true);});
test('成员状态同账号且无冲突才可编辑，不允许非法值',()=>{const {p,setToken}=page('manage-player');Object.assign(p.data,{authorized:true,loading:false,status:'active',membershipConfirmed:true});p._ownerToken='A';p.data.conflict=true;p.membership({detail:{value:0}});assert.equal(p.data.membershipConfirmed,true);p.data.conflict=false;setToken('B');p.membership({detail:{value:0}});assert.equal(p.data.membershipConfirmed,true);setToken('A');p.membership({detail:{value:3}});assert.equal(p.data.membershipConfirmed,true);});
function listingPage(name,rows){let def,token='A',epoch=0;const s={api:{getSession:()=>({token}),request:async()=>rows},playerView:p=>p,teamView:t=>t,load:async(p,work)=>{const e=++epoch,t=token;const result=await work({team:{id:"anonymous",name:"匿名球队"},user:{role:"player"}});if(e===epoch&&t===token)p.setData(result);}};const a={s,load:s.load};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages',name,'index.js'),'utf8'),{Page:d=>def=d,require:r=>r.endsWith('/shared')?s:r.endsWith('/admin')?a:{},wx:{}});const p={...def,data:structuredClone(def.data),setData(v){Object.assign(this.data,v);}};return{p,setToken:t=>token=t,setRows:r=>rows=r};}
for(const name of ['players','manage-players']){
 test(name+' 首次20位待确认可见，主动选择空在队后刷新不跳回',async()=>{const rows=Array.from({length:20},(_,i)=>({id:String(i),name:'匿名'+i,positions:[],status:'inactive',membershipConfirmed:false}));const h=listingPage(name,rows);await h.p.refresh();assert.equal(h.p.data.status,'unconfirmed');assert.equal(h.p.data.visible.length,20);h.p[name==='players'?'changeTab':'status']({currentTarget:{dataset:{status:'active'}}});await h.p.refresh();assert.equal(h.p.data.status,'active');assert.equal(h.p.data.visible.length,0);h.setToken('B');await h.p.refresh();assert.equal(h.p.data.status,'unconfirmed');assert.equal(h.p.data.visible.length,20);});
 test(name+' 既有确认在队的默认值保持active',async()=>{const h=listingPage(name,rows);await h.p.refresh();assert.equal(h.p.data.status,'active');assert.equal(h.p.data.visible[0].id,'c');});
}

test('管理球员顶部标签优先待确认且兼容旧字段，不改变技术状态',()=>{
 const markup=fs.readFileSync(path.join(__dirname,'../pages/manage-player/index.wxml'),'utf8');
 const expression=markup.match(/<text class="tag[^"]*">\{\{(membershipConfirmed[^}]+)\}\}<\/text>/)[1];
 for(const status of ['active','inactive'])for(const membershipConfirmed of [false,true,undefined]){
  const data={status,membershipConfirmed};
  assert.equal(vm.runInNewContext(expression,data),membershipConfirmed===false?'状态未确认':status==='active'?'在队':'已归档');
  assert.equal(data.status,status);assert.equal(data.membershipConfirmed,membershipConfirmed);
 }
});

test('管理球员三态选择后顶部标签与选择器一致',()=>{
 const {p}=page('manage-player');Object.assign(p.data,{authorized:true,loading:false,status:'inactive',membershipConfirmed:false});p._ownerToken='A';
 const markup=fs.readFileSync(path.join(__dirname,'../pages/manage-player/index.wxml'),'utf8');
 const expression=markup.match(/<text class="tag[^"]*">\{\{(membershipConfirmed[^}]+)\}\}<\/text>/)[1];
 for(const original of ['active','inactive']){p.data.status=original;for(const value of [0,1,2,0]){const before=p.data.status;p.membership({detail:{value}});assert.equal(vm.runInNewContext(expression,{...p.data}),p.data.membershipOptions[p.data.membershipIndex]);if(value===0)assert.equal(p.data.status,before);}}
});

test('球员页三个状态数字来自完整列表，不受当前搜索影响',async()=>{const {p}=listingPage('players',rows);await p.refresh();assert.equal(p.data.activeCount,1);assert.equal(p.data.inactiveCount,1);assert.equal(p.data.unconfirmedCount,2);p.search({detail:{value:'找不到'}});assert.equal(p.data.visible.length,0);assert.equal(p.data.activeCount,1);assert.equal(p.data.unconfirmedCount,2);assert.equal(p.data.team.name,'匿名球队');});

for (const name of ['players', 'manage-players']) test(name+' 切换账号清空旧搜索，同账号刷新保留筛选', async()=>{
 const h=listingPage(name,[{id:'new',name:'新球队队员',number:7,positions:['后卫'],status:'active'}]);
 await h.p.refresh();
 h.p.search({detail:{value:'旧球队姓名'}});
 if(name==='players')h.p.position({detail:{value:1}});
 await h.p.refresh();
 assert.equal(h.p.data.search,'旧球队姓名');
 assert.equal(h.p.data.visible.length,0);
 if(name==='players'){assert.equal(h.p.data.selectedPosition,'后卫');assert.equal(h.p.data.positionIndex,1);}
 h.setRows([{id:'other',name:'另一球队队员',number:8,positions:['前锋'],status:'active'}]);
 h.setToken('B');await h.p.refresh();
 assert.equal(h.p.data.visible[0].id,'other');
 assert.equal(h.p.data.search,'');
 assert.equal(h.p.data.visible.length,1);
 if(name==='players'){assert.equal(h.p.data.selectedPosition,'');assert.equal(h.p.data.positionIndex,0);}
 else assert.equal(h.p.data.searchHasText,false);
});

test('正式球员数字不包含临时球员，临时名单保持可见且转正后只增正式人数', async()=>{
 const guest=[{id:'guest-active',name:'临客甲',status:'active',membershipKind:'guest',membershipConfirmed:true},
 {id:'guest-inactive',name:'临客乙',status:'inactive',membershipKind:'guest',membershipConfirmed:true},
 {id:'guest-unknown',name:'临客丙',status:'inactive',membershipKind:'guest',membershipConfirmed:false}];
 const h=listingPage('players',[...rows,...guest]);await h.p.refresh();
 assert.equal(h.p.data.activeCount,1);assert.equal(h.p.data.inactiveCount,1);assert.equal(h.p.data.unconfirmedCount,2);
 assert.equal(h.p.data.visible.map(x=>x.id).sort().join(','),'c,guest-active');
 h.p.changeTab({currentTarget:{dataset:{status:'unconfirmed'}}});assert.equal(h.p.data.visible.length,3);
 h.p.search({detail:{value:'无结果'}});assert.equal(h.p.data.visible.length,0);assert.equal(h.p.data.activeCount,1);
 h.setRows([...rows,...guest.map(p=>p.id==='guest-active'?{...p,membershipKind:'member'}:p)]);await h.p.refresh();
 assert.equal(h.p.data.activeCount,2);assert.equal(h.p.data.inactiveCount,1);assert.equal(h.p.data.unconfirmedCount,2);assert.equal(h.p.data.players.length,7);
});
