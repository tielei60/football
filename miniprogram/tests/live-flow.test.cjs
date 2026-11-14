// Real HTTP + isolated SQLite using the production mini-program transport.
// wx platform primitives are adapted to Node; this is not a WeChat rendering test.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

test('native client: admin publish → player RSVP → roster/results → season/year stats → logout/restart', async t => {
  const { createFootballServer } = await import('../../server/index.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'football-miniprogram-live-'));
  let server;
  const start = async () => {
    server = createFootballServer({ databasePath: join(directory, 'isolated.sqlite'), bootstrapAdmin: { username: 'mp-admin', password: 'native-test-owner-123' } });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  t.after(async () => { if (server.listening) await stop(); await rm(directory, {recursive:true,force:true}); });
  const config = require('../config'); config.apiBaseUrl = await start(); config.allowLocalHttp = true;
  const storage = new Map();
  global.wx = {
    getStorageSync: key => storage.get(key), setStorageSync: (key,value) => storage.set(key,value), removeStorageSync: key => storage.delete(key),
    request(options) {
      const req = http.request(options.url,{method:options.method,headers:options.header},res=>{
        let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>options.success({statusCode:res.statusCode,data:body?JSON.parse(body):null}));
      });req.on('error',options.fail);req.end(options.data===undefined?undefined:JSON.stringify(options.data));
    },
  };
  const api = require('../utils/api');
  await api.login('mp-admin','native-test-owner-123');
  assert.equal((await api.ensureSession()).user.role,'admin');
  const player = await api.request('/players','POST',{name:'模拟球员甲',number:7,positions:['前锋']});
  await api.request('/players/'+player.id+'/account','POST',{username:'mp-player',password:'native-player-123'});
  const season = await api.request('/seasons','POST',{name:'跨年演练',startDate:'2026-09-01',endDate:'2027-08-31'});
  let match = await api.request('/matches','POST',{opponent:'虚构海风队',date:'2027-01-09',kickoff:'18:30',format:7,side:'home',seasonId:season.id,status:'published'});
  const draft = await api.request('/matches','POST',{opponent:'草稿不应可见',date:'2027-01-10'});
  await api.logout();
  await api.login('mp-player','native-player-123');
  assert.equal((await api.request('/matches')).some(m=>m.id===draft.id),false);
  await assert.rejects(api.request('/matches/'+draft.id),e=>e.status===404);
  for(const response of ['yes','maybe','no','yes']) {
    const result=await api.request('/matches/'+match.id+'/rsvp','PUT',{response});
    assert.equal(result.rsvps.length,1);assert.equal(result.rsvps[0].response,response);
  }
  await assert.rejects(api.request('/matches','POST',{opponent:'越权',date:'2027-01-12'}),e=>e.status===403);
  let stats=await api.request('/statistics?seasonId='+season.id);
  assert.equal(stats.players.find(p=>p.playerId===player.id).appearances,0);
  await api.logout();await api.login('mp-admin','native-test-owner-123');
  match=await api.request('/matches/'+match.id);
  match=await api.request('/matches/'+match.id+'/roster','PUT',{revision:match.revision,roster:[{playerId:player.id,selection:'starter',position:'前锋',appeared:true,goals:2,assists:null}]});
  const oldRevision=match.revision;
  match=await api.request('/matches/'+match.id,'PUT',{revision:match.revision,status:'completed',homeScore:2,awayScore:1});
  await assert.rejects(api.request('/matches/'+match.id,'PUT',{revision:oldRevision,homeScore:9}),e=>e.status===409);
  stats=await api.request('/statistics?seasonId='+season.id);
  assert.equal(stats.team.wins,1);assert.equal(stats.team.goalsFor,2);
  const p=stats.players.find(p=>p.playerId===player.id);
  assert.equal(p.goals,2);assert.equal(p.assists,null);assert.equal(p.appearances,1);assert.equal(p.registration.yes,1);
  assert.equal((await api.request('/statistics?year=2026')).team.matches,0);
  assert.equal((await api.request('/statistics?year=2027')).team.matches,1);
  await api.request('/players/'+player.id,'PUT',{revision:player.revision,name:'当前改名',number:27});
  const history=await api.request('/matches/'+match.id);assert.equal(history.roster[0].playerSnapshot.name,'模拟球员甲');
  await api.logout();assert.equal(api.getSession(),null);
  await assert.rejects(api.request('/matches'),e=>e.status===401);
  await stop();config.apiBaseUrl=await start();await api.login('mp-player','native-player-123');
  const persisted=await api.request('/matches/'+match.id);assert.equal(persisted.homeScore,2);assert.equal(persisted.rsvps[0].response,'yes');
  await assert.rejects(api.request('/matches/'+match.id+'/rsvp','PUT',{response:'no'}),e=>e.status===409||e.status===400);
  await api.logout();
});
