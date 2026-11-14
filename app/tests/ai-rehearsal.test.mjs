import test from 'node:test';
import assert from 'node:assert/strict';
import { request, Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, statSync, rmSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startAiRehearsal, parseAiRehearsalArguments } from '../../scripts/start-ai-rehearsal.mjs';
function call(port,path,method='GET',body,token){return new Promise((resolve,reject)=>{
 const req=request(`http://127.0.0.1:${port}/api${path}`,{method,headers:{'Content-Type':'application/json','X-Football-Client':'native-v1',...(token?{Authorization:`Bearer ${token}`}:{})}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(raw)});}catch(e){reject(e);}});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
});}
test('AI演练拒绝任意参数与外部配置',async()=>{
 assert.equal(parseAiRehearsalArguments([]),undefined);
 for(const args of [['enabled'],['--db','production.sqlite'],['--provider','external']])assert.throws(()=>parseAiRehearsalArguments(args));
 await assert.rejects(startAiRehearsal({databasePath:'production.sqlite'}));
});
test('私有独立库、四虚构球员、环境隔离与几何候选全链路',async(t)=>{
 const envNames=['FOOTBALL_DB_PATH','FOOTBALL_ADMIN_USERNAME','FOOTBALL_ADMIN_PASSWORD','FOOTBALL_WECHAT_ENABLED','FOOTBALL_WECHAT_APP_ID','FOOTBALL_WECHAT_APP_SECRET','FOOTBALL_PUBLIC_ORIGIN','FOOTBALL_TRUSTED_PROXY_ADDRESSES','FOOTBALL_COOKIE_SECURE','PORT','HOST'];
 const before=Object.fromEntries(envNames.map(k=>[k,process.env[k]]));
 const sentinelDir=mkdtempSync(join(tmpdir(),'ai-rehearsal-sentinel-')),sentinel=join(sentinelDir,'untouched');writeFileSync(sentinel,'unchanged');
 for(const key of envNames)process.env[key]='invalid-production-sentinel';process.env.FOOTBALL_DB_PATH=sentinel;
 const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('测试禁止任何fetch外呼');};
 let r;
 t.after(async()=>{globalThis.fetch=originalFetch;for(const key of envNames)before[key]===undefined?delete process.env[key]:process.env[key]=before[key];if(r){await r.close();rmSync(r.directory,{recursive:true,force:true});}rmSync(sentinelDir,{recursive:true,force:true});});
 r=await startAiRehearsal();
 const m=JSON.parse(readFileSync(r.manifestPath,'utf8'));assert.equal(m.fictional,true);assert.equal(m.mode,'local-simulation');assert.equal(m.databasePath,join(r.directory,'anonymous.sqlite'));assert.equal(readFileSync(sentinel,'utf8'),'unchanged');
 for(const[p,mode]of[[r.directory,0o700],[r.manifestPath,0o600],[m.databasePath,0o600]])assert.equal(statSync(p).mode&0o777,mode);
 assert.equal(Object.keys(m.players).length,4);assert.ok(m.admin.password.length>=32);assert.notEqual(m.admin.password,m.playerAccount.password);
 const db=new DatabaseSync(m.databasePath,{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) n FROM club_players').get().n,4);assert.equal(db.prepare('SELECT count(*) n FROM club_users').get().n,2);for(const table of ['club_matches','club_sessions','club_wechat_identities','tactics'])assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);}finally{db.close();}
 assert.deepEqual((await call(r.port,'/auth/capabilities')).body,{wechat:false,aiPhotos:true});
 assert.equal((await call(r.port,'/auth/wechat/login','POST',{code:'synthetic-code'})).status,503);
 const login=await call(r.port,'/auth/native-login','POST',m.admin);assert.equal(login.status,200);const token=login.body.token;
 const playerLogin=await call(r.port,'/auth/native-login','POST',m.playerAccount);assert.equal(playerLogin.status,200);
 const prefix='/players/'+m.players.portrait.id+'/ai';
 assert.equal((await call(r.port,prefix+'/capabilities','GET',undefined,playerLogin.body.token)).status,403);
 const ai=(path,method='GET',body)=>call(r.port,prefix+path,method,body,token);
 const caps=await ai('/capabilities');assert.equal(caps.status,200);assert.equal(caps.body.enabled,true);
 const sourceConsent=await ai('/consents','POST',{requestId:randomUUID(),purpose:'private-ai-source',styleId:'source',maxAmountMinor:0,policyVersion:'simulation-v1',confirmed:true});assert.equal(sourceConsent.status,201);
 const source=await ai('/sources','POST',{requestId:randomUUID(),consentId:sourceConsent.body.id,sampleId:'purple-square'});assert.equal(source.status,201);
 const consent=await ai('/consents','POST',{requestId:randomUUID(),purpose:'portrait',styleId:'purple-card',maxAmountMinor:0,policyVersion:'simulation-v1',confirmed:true,sourceId:source.body.id,sourceRevision:source.body.revision});assert.equal(consent.status,201);
 const job=await ai('/jobs','POST',{requestId:randomUUID(),consentId:consent.body.id,sourceId:source.body.id,sourceRevision:source.body.revision,purpose:'portrait',styleId:'purple-card'});assert.equal(job.status,202);
 let result;for(let i=0;i<50;i++){result=await ai('/jobs/'+job.body.id);if(result.body.status==='succeeded')break;await new Promise(resolve=>setTimeout(resolve,20));}assert.equal(result.body.status,'succeeded');
 const candidate=result.body.candidates[0],preview=await ai('/candidates/'+candidate.id);assert.equal(preview.status,200);assert.equal(preview.body.aiGenerated,false);assert.equal(preview.body.originKind,'local-simulation');assert.match(preview.body.dataUrl,/^data:image\/jpeg;base64,/);
 const albumPath='/players/'+m.players.portrait.id+'/photos';assert.equal((await call(r.port,albumPath,'GET',undefined,token)).body.photos.length,0);
 const adopted=await ai('/adoptions','POST',{requestId:randomUUID(),candidateId:candidate.id,candidateRevision:candidate.revision,target:'cover',targetRevision:1,confirmed:true});assert.equal(adopted.status,200);
 const album=(await call(r.port,albumPath,'GET',undefined,token)).body;assert.equal(album.photos.length,1);assert.equal(album.photos[0].simulation,true);
 await r.close();await r.close();await assert.rejects(call(r.port,'/health'));assert.equal(readFileSync(sentinel,'utf8'),'unchanged');
});
test('监听失败只清理本次新目录，保留原错误',async()=>{
 const list=()=>readdirSync(tmpdir()).filter(n=>n.startsWith('football-ai-rehearsal-')).sort(),before=list(),listen=Server.prototype.listen;
 const failure=Error('synthetic-listen-failure');
 Server.prototype.listen=function(){queueMicrotask(()=>this.emit('error',failure));return this;};
 try{await assert.rejects(startAiRehearsal(),e=>e===failure);assert.deepEqual(list(),before);}finally{Server.prototype.listen=listen;}
});
