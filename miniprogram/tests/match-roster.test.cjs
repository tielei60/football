const {runPage}=require('./ui-fixture.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../pages/match-roster/index.js'), 'utf8');
const players = [{ id: 'a', name: '当前姓名', number: 9, positions: ['ST'], status: 'active' }, { id: 'b', name: '新队员', number: null, positions: ['GK'], status: 'active' }, { id: 'c', name: '离队', status: 'inactive' }];
const match = { opponent: '测试对手', revision: 3, roster: [{ playerId: 'a', position: '特殊位置', selection: 'bench', appeared: true, goals: 0, assists: null, playerSnapshot: { name: '历史姓名', number: 8 }, snapshotSource: 'migration' }] };
function fixture({ role = 'admin', save } = {}) {
  let def, token = 'login-a'; const writes = [], messages = [];
  const api = { getSession: () => ({ token }), ensureSession: async () => ({ user: { role }, team: {} }), request: async (url, method, body) => {
    if (method === 'PUT') { writes.push({url, body}); return save ? save(body) : { ...match, revision: 4, roster: body.roster.map(r => ({ ...r, playerSnapshot: match.roster[0].playerSnapshot })) }; }
    return url === '/players' ? players : match;
  } };
  const s = { api, safeSetData: (p,d) => p.setData(d), unload() { this._disposed = true; }, fail: (p,e) => p.setData({error:e.message}), load: async (p,work) => { p._disposed = false; p.setData({loading:true,error:''}); try { p.setData(await work(await api.ensureSession())); } catch(e) { p.setData({error:e.message}); } finally { p.setData({loading:false}); } } };
  runPage(source, { require: () => s, Page: d => {def=d;}, wx: { showModal: o => o.success({confirm:true}), showToast: o => messages.push(o.title) }, Set, Number, Promise, encodeURIComponent });
  const page = { ...def, data: JSON.parse(JSON.stringify(def.data)), id:'7', setData(patch) { for (const [key,val] of Object.entries(patch)) { const m=/^rows\[(\d+)\]\.(\w+)$/.exec(key); if(m) this.data.rows[Number(m[1])][m[2]]=val; else this.data[key]=val; } } };
  return {page,writes,messages,switchLogin(){ token='login-b'; }};
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
