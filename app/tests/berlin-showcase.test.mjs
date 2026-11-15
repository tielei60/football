import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { request, Server } from 'node:http';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startBerlinShowcase, parseBerlinShowcaseArguments } from '../../scripts/start-berlin-showcase.mjs';
const digest=path=>createHash('sha256').update(fs.readFileSync(path)).digest('hex');
function anonymousSources(){
 const names=Array.from({length:20},(_,i)=>'匿名展示'+(i+1));
 return [`const PLAYER_POSITIONS=["中场"];const seeds=${JSON.stringify(names.map(n=>[n,['中场']]))};`,`const berlinGardenNames=${JSON.stringify(names)};const berlinGardenPositions=${JSON.stringify(names.map((_,i)=>['bg-'+(i+1),['中场']]))};`];
}
function anonymize(){
 const original=fs.readFileSync,sources=anonymousSources();
 fs.readFileSync=function(path,...args){const p=String(path);if(p.endsWith('/app/src/data/berlinGarden.ts'))return sources[0];if(p.endsWith('/server/football-store.mjs'))return sources[1];return original.call(this,path,...args);};
 syncBuiltinESMExports();return()=>{fs.readFileSync=original;syncBuiltinESMExports();};
}
function call(port,path,method='GET',body,token){return new Promise((resolve,reject)=>{
 const req=request(`http://127.0.0.1:${port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Football-Client':'native-v1',...(token?{Authorization:`Bearer ${token}`}:{})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(raw)});}catch(e){reject(e);}});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
});}
test('柏林展示不接受已有数据库、端口或账号参数',async()=>{
 assert.equal(parseBerlinShowcaseArguments([]),undefined);
 for(const args of [['--db','existing.sqlite'],['enabled'],['--port','13001']])assert.throws(()=>parseBerlinShowcaseArguments(args));
 await assert.rejects(startBerlinShowcase({databasePath:'existing.sqlite'}));
});
test('匿名来源保真、副本成员待确认、本地操作账号、环境隔离与本机权限',async(t)=>{
 const restore=anonymize(),envNames=['FOOTBALL_DB_PATH','FOOTBALL_ADMIN_USERNAME','FOOTBALL_ADMIN_PASSWORD','FOOTBALL_WECHAT_ENABLED','FOOTBALL_WECHAT_APP_ID','FOOTBALL_WECHAT_APP_SECRET','FOOTBALL_PUBLIC_ORIGIN','FOOTBALL_TRUSTED_PROXY_ADDRESSES','FOOTBALL_COOKIE_SECURE','PORT','HOST'];
 const old=Object.fromEntries(envNames.map(k=>[k,process.env[k]])),sentinelDir=fs.mkdtempSync(join(tmpdir(),'berlin-showcase-sentinel-')),sentinel=join(sentinelDir,'untouched');fs.writeFileSync(sentinel,'unchanged');
 for(const key of envNames)process.env[key]='invalid-production-sentinel';process.env.FOOTBALL_DB_PATH=sentinel;
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('禁止测试外呼');};let r;
 t.after(async()=>{globalThis.fetch=originalFetch;restore();for(const k of envNames)old[k]===undefined?delete process.env[k]:process.env[k]=old[k];if(r){await r.close();fs.rmSync(r.directory,{recursive:true,force:true});}fs.rmSync(sentinelDir,{recursive:true,force:true});});
 r=await startBerlinShowcase();const m=JSON.parse(fs.readFileSync(r.manifestPath,'utf8'));
 assert.equal(fs.readFileSync(sentinel,'utf8'),'unchanged');assert.equal(m.playerCount,20);assert.equal(m.membershipConfirmed,false);assert.equal(m.localOperatorOnly,true);assert.equal(m.playerAccounts,undefined);
 assert.equal(m.sourceDatabasePath,join(r.directory,'validation.sqlite'));assert.equal(m.databasePath,join(r.directory,'showcase.sqlite'));assert.notEqual(m.sourceDatabasePath,m.databasePath);
 for(const[p,mode]of[[r.directory,0o700],[r.manifestPath,0o600],[m.databasePath,0o600],[m.sourceDatabasePath,0o600]])assert.equal(fs.statSync(p).mode&0o777,mode);
 assert.equal(m.sourceHashBefore,m.sourceHashAfter);assert.equal(digest(m.sourceDatabasePath),m.sourceHashBefore);
 const source=new DatabaseSync(m.sourceDatabasePath,{readOnly:true}),copy=new DatabaseSync(m.databasePath,{readOnly:true});
 try{
  const a=source.prepare('SELECT * FROM club_players ORDER BY id').all(),b=copy.prepare('SELECT * FROM club_players ORDER BY id').all();assert.equal(a.length,20);assert.equal(b.length,20);
  for(let i=0;i<20;i++){assert.match(a[i].name,/^匿名展示/);assert.equal(a[i].status,'inactive');assert.equal(b[i].status,'inactive');assert.equal(b[i].membership_confirmed,0);for(const field of ['id','name','number','positions','preferred_foot','avatar'])assert.equal(a[i][field],b[i][field]);assert.equal(b[i].number,null);assert.equal(b[i].avatar,null);assert.match(a[i].note,/隔离验证/);assert.equal(b[i].note,'');}
  assert.deepEqual(source.prepare('SELECT * FROM validation_roster_sources ORDER BY player_id').all(),copy.prepare('SELECT * FROM validation_roster_sources ORDER BY player_id').all());
  assert.equal(source.prepare('SELECT count(*) n FROM club_users').get().n,1);assert.equal(copy.prepare('SELECT count(*) n FROM club_users').get().n,1);assert.equal(copy.prepare("SELECT count(*) n FROM club_users WHERE role!='admin' OR player_id IS NOT NULL").get().n,0);
  for(const table of ['club_venues','club_match_photos','club_player_photos','team_players','coaching_desks'])assert.equal(copy.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  for(const table of ['club_matches','club_roster','club_rsvps','club_seasons','club_season_roster','tactics','tactic_versions','club_sessions','club_wechat_identities']){assert.equal(source.prepare('SELECT count(*) n FROM '+table).get().n,0);assert.equal(copy.prepare('SELECT count(*) n FROM '+table).get().n,0);}
 }finally{source.close();copy.close();}
 assert.deepEqual((await call(r.port,'/auth/capabilities')).body,{wechat:false,aiPhotos:false});
 const admin=await call(r.port,'/auth/native-login','POST',m.admin);assert.equal(admin.status,200);assert.equal((await call(r.port,'/players','GET',undefined,admin.body.token)).body.length,20);
 const roster=(await call(r.port,'/players','GET',undefined,admin.body.token)).body;
 assert.ok(roster.every(p=>p.membershipConfirmed===false && p.status==='inactive' && p.note===''));
 assert.equal(admin.body.team.name,'柏林花园 FC');assert.equal(admin.body.team.crest,'data:image/png;base64,'+fs.readFileSync(new URL('../../app/public/team-badge.png',import.meta.url)).toString('base64'));
 assert.equal((await call(r.port,'/players')).status,401);
 await r.close();await r.close();await assert.rejects(call(r.port,'/health'));assert.equal(digest(m.sourceDatabasePath),m.sourceHashBefore);assert.equal(fs.readFileSync(sentinel,'utf8'),'unchanged');
});
test('每次运行生成新源和新副本，绝不复用既有资料库',async()=>{
 const restore=anonymize();let a,b;try{a=await startBerlinShowcase();b=await startBerlinShowcase();assert.notEqual(a.directory,b.directory);assert.notEqual(a.port,b.port);const ma=JSON.parse(fs.readFileSync(a.manifestPath)),mb=JSON.parse(fs.readFileSync(b.manifestPath));assert.notEqual(ma.admin.password,mb.admin.password);}finally{restore();for(const r of[a,b])if(r){await r.close();fs.rmSync(r.directory,{recursive:true,force:true});}}
});
function trackOwnDirectories(){
 const original=fs.mkdtempSync,created=[];
 fs.mkdtempSync=function(prefix,...args){const result=original.call(this,prefix,...args);if(String(prefix).includes('football-berlin-validation-'))created.push(result);return result;};
 syncBuiltinESMExports();
 return {assertClean(){assert.equal(created.length,1);for(const path of created)assert.equal(fs.existsSync(path),false,'本次创建的目录必须清理');},restore(){fs.mkdtempSync=original;syncBuiltinESMExports();}};
}
test('监听失败关闭资源，仅清理自己新生成的来源目录',async()=>{
 const restore=anonymize(),tracked=trackOwnDirectories(),listen=Server.prototype.listen,failure=Error('synthetic-listen-failure');
 Server.prototype.listen=function(){queueMicrotask(()=>this.emit('error',failure));return this;};
 try{await assert.rejects(startBerlinShowcase(),e=>e===failure);tracked.assertClean();}finally{Server.prototype.listen=listen;tracked.restore();restore();}
});


test('一致性backup目标无法打开时只清理本次目录',async()=>{
 const restore=anonymize(),tracked=trackOwnDirectories(),originalWrite=fs.writeFileSync;
 let leaked;
 // 模拟目标文件在独占创建阶段发生文件系统类型异常，真正让SQLite backup拒绝目录。
 fs.writeFileSync=function(path,...args){if(String(path).endsWith('/showcase.sqlite')){fs.mkdirSync(path,{mode:0o700});return;}return originalWrite.call(this,path,...args);};syncBuiltinESMExports();
 try{await assert.rejects(async()=>{leaked=await startBerlinShowcase();},e=>e.code==='ERR_SQLITE_ERROR');tracked.assertClean();}
 finally{fs.writeFileSync=originalWrite;syncBuiltinESMExports();tracked.restore();if(leaked){await leaked.close();fs.rmSync(leaked.directory,{recursive:true,force:true});}restore();}
});

test('close回调错误仍等待drained，不让调用者提前清理数据库',async()=>{
 const restore=anonymize(),originalListen=Server.prototype.listen;
 let server,r,release,actualDrained;
 Server.prototype.listen=function(...args){server=this;return originalListen.apply(this,args);};
 try{
  r=await startBerlinShowcase();Server.prototype.listen=originalListen;
  actualDrained=server.drained;
  const gate=new Promise(resolve=>{release=resolve;});server.drained=actualDrained.then(()=>gate);
  const originalClose=server.close,failure=Error('synthetic-close-callback-failure');
  server.close=function(callback){return originalClose.call(this,()=>callback(failure));};
  let settled=false;
  const result=r.close().then(()=>{settled=true;return null;},error=>{settled=true;return error;});
  await actualDrained;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);
  release();assert.equal(await result,failure);await assert.rejects(r.close(),e=>e===failure);
 }finally{
  Server.prototype.listen=originalListen;release?.();
  if(r){try{await r.close();}catch{}if(actualDrained)await actualDrained;fs.rmSync(r.directory,{recursive:true,force:true});}
  restore();
 }
});
