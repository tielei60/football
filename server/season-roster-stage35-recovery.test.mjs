// 阶段35：隔离匿名数据库的赛季阵容恢复，不代表网络或原生UI操作。
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createDemo } from '../scripts/create-demo.mjs';
import { openFootballStore } from './football-store.mjs';
import { createClubStore } from './club-store.mjs';
function fixture(t) {
 const demo=createDemo(),store=openFootballStore(demo.databasePath);
 t.after(()=>{store.close();rmSync(demo.directory,{recursive:true,force:true});});
 const club=createClubStore(store.database,store),admin=club.authenticate(club.login(demo.credentials[0],'stage35').token);
 const get=()=>club.getSeasonRoster(admin.team_id,demo.season.id);
 const save=input=>club.saveSeasonRoster(admin.team_id,demo.season.id,input);
 const rows=table=>store.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
 return {club,admin,demo,get,save,rows};
}
test('赛季增删保存重新读取，旧版本重试不写，当前球员和历史比赛保持原样',t=>{
 const {get,save,rows,demo}=fixture(t);
 const untouched=Object.fromEntries(['club_players','club_matches','club_roster'].map(k=>[k,rows(k)]));
 const before=get();const target=demo.players[0].id;
 assert.ok(before.roster.some(r=>r.playerId===target), "目标必须原本在赛季阵容中，避免空操作假通过");
 const roster=before.roster.filter(r=>r.playerId!==target).map(r=>({playerId:r.playerId,number:r.number}));
 const removed=save({revision:before.season.revision,roster});
 assert.deepEqual(get(),removed);assert.ok(!get().roster.some(r=>r.playerId===target));
 const after=rows('club_season_roster'),seasons=rows('club_seasons');
 for(const staleRoster of [before.roster,[],roster]) {
  assert.throws(()=>save({revision:before.season.revision,roster:staleRoster}),e=>e.status===409);
  assert.deepEqual(rows('club_season_roster'),after);assert.deepEqual(rows('club_seasons'),seasons);
 }
 // 故意不消费成功返回值，模拟调用者尚未获知保存结果。
 save({revision:removed.season.revision,roster:[...roster,{playerId:target,number:0}]});
 const reopened=get();assert.equal(reopened.season.revision,removed.season.revision+1);
 assert.equal(reopened.roster.filter(r=>r.playerId===target).length,1);assert.equal(reopened.roster.find(r=>r.playerId===target).number,0);
 assert.throws(()=>save({revision:removed.season.revision,roster:[]}),e=>e.status===409);
 assert.deepEqual(get(),reopened);
 for(const [table,expected] of Object.entries(untouched))assert.deepEqual(rows(table),expected,table);
});
test('保留成员不能改写捕获姓名位置，非法版本和重复成员不影响快照',t=>{
 const {get,save,rows}=fixture(t);const before=get();assert.ok(before.roster.length>0);
 const edited=before.roster.map(r=>({...r,name:'不能覆盖的姓名',positions:['不能覆盖的位置'],number:null}));
 const saved=save({revision:before.season.revision,roster:edited});
 for(const row of saved.roster){const original=before.roster.find(r=>r.playerId===row.playerId);assert.equal(row.name,original.name);assert.deepEqual(row.positions,original.positions);assert.equal(row.number,null);}
 const stable=rows('club_season_roster'),seasons=rows('club_seasons');
 for(const revision of [undefined,null,0,'1'])assert.throws(()=>save({revision,roster:[]}),e=>e.status===428);
 assert.throws(()=>save({revision:saved.season.revision,roster:[edited[0],edited[0]]}),e=>e.status===400);
 assert.deepEqual(rows('club_season_roster'),stable);assert.deepEqual(rows('club_seasons'),seasons);
});
