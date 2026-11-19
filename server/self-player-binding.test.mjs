import test from 'node:test';
import assert from 'node:assert/strict';
import {openFootballStore} from './football-store.mjs';
import {createClubStore} from './club-store.mjs';
function fixture(t){
 const legacy=openFootballStore(':memory:');t.after(()=>legacy.close());
 const club=createClubStore(legacy.database,legacy,{bootstrapAdmin:{username:'owner',password:'test-password-123'}}),db=legacy.database;
 db.exec('UPDATE club_users SET must_change_password=0,is_system_admin=1');
 const actor=()=>db.prepare("SELECT * FROM club_users WHERE username='owner'").get();
 return {club,db,actor};
}
test('本人关联：修订及会话失效、保持权限、绑定后可以报名且不会重复',t=>{
 const {club,db,actor}=fixture(t), a=actor(), p=club.savePlayer(a.team_id,null,{name:'匿名本人'});
 db.prepare('INSERT INTO club_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run('test-session',a.id,Date.now()+100000);
 const result=club.bindOwnPlayer(a,{playerId:p.id,revision:a.account_revision});
 assert.equal(result.playerId,p.id);assert.equal(result.systemAdmin,true);assert.equal(result.revision,a.account_revision+1);
 assert.equal(db.prepare('SELECT count(*) n FROM club_sessions').get().n,0);
 assert.throws(()=>club.bindOwnPlayer(a,{playerId:p.id,revision:a.account_revision}),/权限/);
 assert.equal(club.bindOwnPlayer(actor(),{playerId:p.id,revision:actor().account_revision}).revision,result.revision);
 const match=club.saveMatch(actor(),null,{opponent:'匿名对手',date:'2026-12-01',status:'published'});
 club.saveRsvp(actor(),match.id,{response:'yes'});club.saveRsvp(actor(),match.id,{response:'yes'});
 assert.equal(db.prepare('SELECT count(*) n FROM club_rsvps').get().n,1);
});
test('拒绝普通管理员、过期修订、他人占用、归档、未确认和跨队，不修改身份',t=>{
 const {club,db,actor}=fixture(t),a=actor(),p=club.savePlayer(a.team_id,null,{name:'匿名候选'}),bind=()=>club.bindOwnPlayer(actor(),{playerId:p.id,revision:actor().account_revision});
 assert.throws(()=>club.bindOwnPlayer(a,{playerId:p.id,revision:999}),/变更/);
 db.exec("INSERT INTO club_users(team_id,username,password_hash,role) VALUES(1,'ordinary','unused','admin')");assert.throws(()=>club.bindOwnPlayer(db.prepare("SELECT * FROM club_users WHERE username='ordinary'").get(),{playerId:p.id,revision:1}),/权限/);
 db.prepare("UPDATE club_players SET status='inactive' WHERE id=?").run(p.id);assert.throws(bind,/在册/);
 db.prepare("UPDATE club_players SET status='active',membership_confirmed=0 WHERE id=?").run(p.id);assert.throws(bind,/确认/);
 db.prepare('UPDATE club_players SET membership_confirmed=1 WHERE id=?').run(p.id);
 db.prepare("INSERT INTO club_users(team_id,username,password_hash,role,player_id) VALUES(1,'other','unused','player',?)").run(p.id);assert.throws(bind,/其他/);
 db.exec("DELETE FROM club_users WHERE username='other';INSERT INTO club_teams(id,name) VALUES(2,'匿名其他队')");db.prepare('UPDATE club_players SET team_id=2 WHERE id=?').run(p.id);assert.throws(bind,/本队/);
 assert.equal(actor().player_id,null);
});
