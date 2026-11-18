// 阶段36：归档成员赛季快照规则；仅匿名临时库，不代表原生界面验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { createDemo } from '../scripts/create-demo.mjs';
import { openFootballStore } from './football-store.mjs';
import { createClubStore } from './club-store.mjs';
function fixture(t) {
 const demo=createDemo(),store=openFootballStore(demo.databasePath);
 t.after(()=>{store.close();rmSync(demo.directory,{recursive:true,force:true});});
 const club=createClubStore(store.database,store),admin=club.authenticate(club.login(demo.credentials[0],'stage36').token);
 const season=club.saveSeason(admin.team_id,null,{name:'归档身份边界赛季',startDate:'2099-01-01',endDate:'2099-12-31'});
 const original=club.getPlayer(admin.team_id,demo.players[0].id);
 const get=()=>club.getSeasonRoster(admin.team_id,season.id);
 const save=roster=>club.saveSeasonRoster(admin.team_id,season.id,{revision:get().season.revision,roster});
 const archive=()=>club.savePlayer(admin.team_id,original.id,{...club.getPlayer(admin.team_id,original.id),name:'匿名归档新姓名',number:88,positions:['门将'],status:'inactive'});
 const unchanged=()=>Object.fromEntries(['club_players','club_matches','club_roster'].map(table=>[table,store.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
 return {club,admin,season,original,get,save,archive,unchanged};
}
test('已归档成员可以首次加入赛季，保存捕获当前资料且不改球员与历史比赛',t=>{
 const {original,save,get,archive,unchanged}=fixture(t);
 const current=archive();assert.equal(current.status,'inactive');
 const baseline=unchanged();
 const result=save([{playerId:original.id}]);
 assert.deepEqual(get(),result);assert.equal(result.roster.length,1);
 assert.deepEqual(result.roster[0],{playerId:current.id,name:current.name,number:current.number,positions:current.positions});
 assert.deepEqual(unchanged(),baseline);
});
test('归档后保留成员仍沿用旧身份，移出保存再加入才捕获最新资料，历史比赛不变',t=>{
 const {club,admin,season,original,get,save,archive,unchanged}=fixture(t);
 const initial=save([{playerId:original.id,number:0}]);
 const oldIdentity=initial.roster[0];assert.equal(oldIdentity.number,0);
 const match=club.saveMatch(admin,null,{opponent:'匿名历史队',date:'2099-06-01',status:'completed',seasonId:season.id});
 club.saveRoster(admin,match.id,{revision:match.revision,roster:[{playerId:original.id,appeared:true,goals:0,assists:0}]});
 const captured=club.getMatch(admin,match.id).roster[0].playerSnapshot;
 assert.equal(captured.name,original.name);assert.equal(captured.number,0);
 const current=archive();assert.notEqual(current.name,oldIdentity.name);
 const baseline=unchanged();
 const retained=save([{playerId:original.id,name:current.name,positions:current.positions}]);
 assert.deepEqual(retained.roster,[oldIdentity]);assert.deepEqual(get(),retained);
 assert.deepEqual(unchanged(),baseline);
 const removed=save([]);assert.deepEqual(removed.roster,[]);assert.deepEqual(get(),removed);
 assert.deepEqual(unchanged(),baseline);
 const readded=save([{playerId:original.id}]);
 assert.deepEqual(readded.roster,[{playerId:current.id,name:current.name,number:88,positions:['门将']}]);
 assert.deepEqual(get(),readded);assert.deepEqual(unchanged(),baseline);
 assert.deepEqual(club.getMatch(admin,match.id).roster[0].playerSnapshot,captured);
});
