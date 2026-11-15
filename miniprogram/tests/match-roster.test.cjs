const {runPage}=require('./ui-fixture.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../pages/match-roster/index.js'), 'utf8');
const players = [{ id: 'a', name: '当前姓名', number: 9, positions: ['ST'], status: 'active' }, { id: 'b', name: '新队员', number: null, positions: ['GK'], status: 'active' }, { id: 'c', name: '离队', status: 'inactive' }];
const match = { opponent: '测试对手', revision: 3, roster: [{ playerId: 'a', position: '特殊位置', selection: 'bench', appeared: true, goals: 0, assists: null, playerSnapshot: { name: '历史姓名', number: 8 }, snapshotSource: 'migration' }] };
function fixture({ role = 'admin', save, read, modal = true } = {}) {
  let def, token = 'login-a'; const writes = [], messages = [];
  const api = { getSession: () => ({ token }), ensureSession: async () => ({ user: { role }, team: {} }), request: async (url, method, body) => {
    if (method === 'PUT') { writes.push({url, body}); return save ? save(body) : { ...match, revision: 4, roster: body.roster.map(r => ({ ...r, playerSnapshot: match.roster[0].playerSnapshot })) }; }
    return read ? read(url) : url === '/players' ? players : match;
  } };
  // 加载真实 shared.load/fail，避免同步桩掩盖 epoch 与错误契约。
  const sharedModule={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/shared.js'),'utf8'),{
    module:sharedModule,require:n=>n.includes('/api')?api:{imageSource:x=>x},
    wx:{stopPullDownRefresh(){},redirectTo:o=>messages.push(o.url)},console,
  });
  const s=sharedModule.exports;
  runPage(source, { require: () => s, Page: d => {def=d;}, wx: { showModal: o => o.success({confirm:modal}), showToast: o => messages.push(o.title) }, Set, Number, Promise, encodeURIComponent });
  const page = { ...def, data: JSON.parse(JSON.stringify(def.data)), id:'7', setData(patch) { for (const [key,val] of Object.entries(patch)) { const m=/^rows\[(\d+)\]\.(\w+)$/.exec(key); if(m) this.data.rows[Number(m[1])][m[2]]=val; else this.data[key]=val; } } };
  return {page,writes,messages,api,switchLogin(){ token='login-b'; }};
}
const event = (id,field,value) => ({ currentTarget:{dataset:{id,field}}, detail:{value} });
test('historical identity, custom position, unknown and zero remain distinct', async () => {
  const f=fixture(); await f.page.refresh(); const row=f.page.data.rows[0];
  assert.equal(row.name,'历史姓名'); assert.equal(row.number,8); assert.equal(row.goals,'0'); assert.equal(row.assists,''); assert.equal(row.migration,true);
  assert.equal(row.positionValues[row.positionIndex],'特殊位置'); assert.deepEqual(Array.from(f.page.data.candidates,x=>x.id),['b']);
  await f.page.save(); const sent=f.writes[0].body; assert.equal(sent.revision,3); assert.equal(sent.roster[0].goals,0); assert.equal(sent.roster[0].assists,null); assert.equal(sent.roster[0].selection,'bench'); assert.equal(sent.roster[0].playerSnapshot,undefined); assert.equal(f.page.data.revision,4);
});
test('only admin can load; changing login cannot save old draft',async()=>{const denied=fixture({role:'player'}); await denied.page.refresh(); assert.match(denied.page.data.error,/管理员/); assert.equal(denied.page.data.rows.length,0); const f=fixture(); await f.page.refresh(); f.switchLogin(); await f.page.save(); assert.equal(f.writes.length,0);});
test('add/remove preserves uniqueness and sends complete replacement',async()=>{const f=fixture();await f.page.refresh();f.page.add();f.page.add();assert.equal(f.page.data.rows.length,2);f.page.remove(event('a'));await f.page.save();assert.equal(f.writes[0].body.roster.length,1);assert.equal(f.writes[0].body.roster[0].playerId,'b');assert.equal(f.writes[0].body.roster[0].appeared,null);});
test('appearance change explicitly clears goals and assists, never implies selection',async()=>{const f=fixture();await f.page.refresh();f.page.pick(event('a','appearanceIndex','2'));assert.equal(f.page.data.rows[0].goals,'');assert.equal(f.page.data.rows[0].selectionIndex,2);await f.page.save();assert.equal(f.writes[0].body.roster[0].appeared,false);assert.equal(f.writes[0].body.roster[0].goals,null);});
test('409 keeps draft and revision, blocks blind retries until explicit reload',async()=>{const f=fixture({save:async()=>{throw Object.assign(Error('conflict'),{status:409});}});await f.page.refresh();f.page.input(event('a','goals','2'));await f.page.save();assert.equal(f.page.data.rows[0].goals,'2');assert.equal(f.page.data.revision,3);assert.equal(f.page.data.conflict,true);await f.page.save();assert.equal(f.writes.length,1);});
test('network failure retains rows; double submit and unload late response are guarded',async()=>{let reject;const f=fixture({save:()=>new Promise((r,j)=>{reject=j;})});await f.page.refresh();const save=f.page.save();await f.page.save();assert.equal(f.writes.length,1);reject(Error('offline'));await save;assert.equal(f.page.data.rows[0].name,'历史姓名');assert.equal(f.page.data.busy,false);let finish;const g=fixture({save:()=>new Promise(r=>{finish=r;})});await g.page.refresh();const pending=g.page.save();g.page.onUnload();finish({...match,revision:4});await pending;assert.equal(g.messages.length,0);assert.equal(g.page.data.revision,3);});
test('invalid numeric data is rejected; token never enters page data',async()=>{const f=fixture();await f.page.refresh();f.page.input(event('a','goals','-1'));await f.page.save();assert.equal(f.writes.length,0);assert.match(f.page.data.actionError,/非负整数/);assert.equal(JSON.stringify(f.page.data).includes('login-a'),false);});

const seasonalRead = (roster, current={...match,seasonId:1}) => url => url === '/players' ? players : url.startsWith('/seasons/') ? {season:{id:1},roster} : current;
test('season preview uses zero/null numbers and captured name without inventing historical rows or match position',async()=>{
 const f=fixture({read:seasonalRead([{playerId:'b',name:'季身份',number:0,positions:['季位置']}])});await f.page.refresh();
 assert.equal(f.page.data.candidates[0].label,'0 · 季身份');f.page.add();const row=f.page.data.rows[1];
 assert.equal(row.name,'季身份');assert.equal(row.number,0);assert.equal(row.historical,false);assert.equal(row.positionValues[row.positionIndex],'');assert.equal(row.positionValues.includes('季位置'),false);
 assert.equal(f.page.data.rows[0].name,'历史姓名');await f.page.save();assert.equal(f.writes[0].body.roster[1].playerSnapshot,undefined);
 const g=fixture({read:seasonalRead([{playerId:'b',name:'季身份',number:null}])});await g.page.refresh();g.page.add();assert.equal(g.page.data.rows[1].number,'—');
});
test('no linked season makes no extra read; nonseason member falls back to current identity',async()=>{
 const calls=[];const f=fixture({read:u=>{calls.push(u);return u==='/players'?players:match;}});await f.page.refresh();assert.equal(calls.length,2);
 const g=fixture({read:seasonalRead([])});await g.page.refresh();assert.equal(g.page.data.candidates[0].label,'— · 新队员');
});
test('unpersisted remove/readd preserves historical identity, including candidate label',async()=>{
 const f=fixture({read:seasonalRead([{playerId:'a',name:'季新名',number:0}])});await f.page.refresh();f.page.remove(event('a'));
 assert.equal(f.page.data.candidates[0].label,'8 · 历史姓名');f.page.add();assert.equal(f.page.data.rows[0].name,'历史姓名');assert.equal(f.page.data.rows[0].historical,true);
});
test('each successful save replaces original snapshot map; saved removal permits new capture',async()=>{
 const f=fixture({read:seasonalRead([{playerId:'b',name:'季身份',number:0}]),save:body=>({...match,revision:4,roster:body.roster.map(r=>({...r,playerSnapshot:{name:'服务端保存身份',number:0}}))})});
 await f.page.refresh();f.page.add();await f.page.save();f.page.remove(event('b'));f.page.choosePlayer(event(null,null,0));f.page.add();assert.equal(f.page.data.rows.find(x=>x.playerId==='b').name,'服务端保存身份');
 f.page.remove(event('b'));await f.page.save();assert.equal(f.page._originalRows.has('b'),false);f.page.add();assert.equal(f.page.data.rows.find(x=>x.playerId==='b').name,'季身份');assert.equal(f.page.data.rows.find(x=>x.playerId==='b').historical,false);
});
test('season read failure retains old drafts and private baseline, with original error/retry behavior',async()=>{
 const f=fixture();await f.page.refresh();f.page.input(event('a','goals','2'));const original=f.page._originalRows,oldPlayers=f.page._players;
 f.api.request=async u=>{if(u.startsWith('/seasons/'))throw Error('季名单读取失败');return u==='/players'?players:{...match,seasonId:1};};await f.page.refresh();
 assert.match(f.page.data.error,/季名单读取失败/);assert.equal(f.page.data.rows[0].goals,'2');assert.equal(f.page._originalRows,original);assert.equal(f.page._players,oldPlayers);
});
for(const mode of ['hide','unload','account','newer'])test('late season response cannot publish private state: '+mode,async()=>{
 let release;const f=fixture();await f.page.refresh();const old=f.page._originalRows;f.api.request=async u=>u==='/players'?players:u.startsWith('/seasons/')?new Promise(r=>release=r):{...match,seasonId:1};
 const work=f.page.refresh();await new Promise(r=>setImmediate(r));
 if(mode==='hide')f.page.onHide();if(mode==='unload')f.page.onUnload();if(mode==='account')f.switchLogin();if(mode==='newer'){f.api.request=async u=>u==='/players'?players:match;await f.page.refresh();}
 const expected=f.page._originalRows;release({roster:[{playerId:'b',name:'旧回调',number:0}]});await work;assert.equal(f.page._originalRows,expected);assert.notEqual(f.page.data.candidates[0].label,'0 · 旧回调');if(mode!=='newer')assert.equal(f.page._originalRows,old);
});
for(const outcome of ['success','failure'])test('save '+outcome+' after account change cannot mutate rows, snapshots or messages',async()=>{
 let resolve,reject;const f=fixture({save:()=>new Promise((r,j)=>{resolve=r;reject=j;})});await f.page.refresh();const old=f.page._originalRows;const work=f.page.save();f.switchLogin();f.page.setData({busy:true,actionError:'新页面'});
 if(outcome==='success')resolve({...match,revision:99,roster:[]});else reject(Object.assign(Error('旧失败'),{status:409}));await work;
 assert.equal(f.page._originalRows,old);assert.equal(f.page.data.revision,3);assert.equal(f.page.data.actionError,'新页面');assert.equal(f.page.data.busy,true);assert.equal(f.messages.length,0);
});
test('failed save keeps original map and cancelled explicit reload makes no reads',async()=>{const f=fixture({modal:false,save:async()=>{throw Object.assign(Error('冲突'),{status:409});}});await f.page.refresh();const old=f.page._originalRows;await f.page.save();assert.equal(f.page._originalRows,old);let reads=0;f.api.request=async()=>{reads++;};f.page.reload();assert.equal(reads,0);});

for(const timing of ['hidden','returned'])for(const outcome of ['success','failure'])test('same save settles safely '+timing+' '+outcome,async()=>{
 let resolve,reject;const f=fixture({save:()=>new Promise((r,j)=>{resolve=r;reject=j;})});await f.page.refresh();f.page._firstShow=false;f.page.input(event('a','goals','2'));const work=f.page.save();f.page.onHide();
 if(timing==='returned')await f.page.onShow();
 if(outcome==='success'){f.api.request=async u=>u==='/players'?players:{...match,revision:4};resolve({...match,revision:4});}else reject(Object.assign(Error('冲突'),{status:409}));
 await work;if(timing==='hidden')await f.page.onShow();assert.equal(f.page.data.busy,false);
 if(outcome==='success')assert.equal(f.page.data.revision,4);else{assert.equal(f.page.data.conflict,true);assert.equal(f.page.data.rows[0].goals,'2');}
});

for(const stale of [false,true])test('expired save respects trusted staleSession flag '+stale,async()=>{
 let reject;const f=fixture({save:()=>new Promise((r,j)=>reject=j)});await f.page.refresh();const work=f.page.save();f.api.getSession=()=>null;reject(Object.assign(Error('登录失效'),{status:401,staleSession:stale}));await work;
 assert.equal(f.messages.includes('/pages/login/index'),!stale);if(!stale)assert.equal(f.page.data.busy,false);else assert.equal(f.page.data.error,'');
});
test('later refresh wins over a pending save response and original snapshot map',async()=>{
 let resolve;const f=fixture({save:()=>new Promise(r=>resolve=r)});await f.page.refresh();const work=f.page.save();await f.page.refresh();const original=f.page._originalRows;resolve({...match,revision:99,roster:[]});await work;assert.equal(f.page.data.revision,3);assert.equal(f.page._originalRows,original);
});

test('save settling while return validation is pending cannot leave page busy',async()=>{
 let finish,validate;const f=fixture({save:()=>new Promise(r=>finish=r)});await f.page.refresh();f.page._firstShow=false;const work=f.page.save();f.page.onHide();const ensure=f.api.ensureSession;f.api.ensureSession=()=>new Promise(r=>validate=r);const showing=f.page.onShow();
 f.api.ensureSession=ensure;f.api.request=async u=>u==='/players'?players:{...match,revision:4};finish({...match,revision:4});await work;validate({user:{role:'admin'},team:{}});await showing;assert.equal(f.page.data.busy,false);assert.equal(f.page.data.revision,4);
});
