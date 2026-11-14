import { readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { once } from 'node:events';
import { createBerlinValidation } from './create-berlin-validation.mjs';
import { openFootballStore } from '../server/football-store.mjs';
import { createClubStore } from '../server/club-store.mjs';
import { createFootballServer } from '../server/index.mjs';

export function parseBerlinRehearsalArguments(args) {
  if (!Array.isArray(args) || args.length) throw Error('柏林花园本机演练不接受路径、端口、账号或其他参数。');
}
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
// 每次新建来源库与一致性演练副本；不接受任何已有资料库路径。
export async function startBerlinRehearsal() {
  if (arguments.length) throw Error('柏林花园本机演练不接受参数。');
  let directory, source, store, server;
  try {
    const seed = createBerlinValidation();
    directory = seed.directory;
    const sourceDatabasePath = join(directory, 'validation.sqlite');
    const databasePath = join(directory, 'rehearsal.sqlite');
    const sourceManifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    if (seed.total !== 20 || sourceManifest.total !== 20 || sourceManifest.databasePath !== sourceDatabasePath)
      throw Error('新来源资料库与生成清单不一致，停止演练。');
    const sourceHashBefore = digest(sourceDatabasePath);
    // 目标只在本次新目录中独占创建；SQLite backup处理一致性，不拼接数据库文件。
    writeFileSync(databasePath, '', { flag: 'wx', mode: 0o600 });
    source = new DatabaseSync(sourceDatabasePath, { readOnly: true });
    await backup(source, databasePath);
    source.close(); source = null;
    const sourceHashAfter = digest(sourceDatabasePath);
    if (sourceHashBefore !== sourceHashAfter) throw Error('来源资料库摘要发生变化，停止演练。');
    chmodSync(databasePath, 0o600);
    store = openFootballStore(databasePath);
    const club = createClubStore(store.database, store);
    const db = store.database;
    const roster = club.listPlayers(1);
    if (roster.length !== 20 || roster.some(p => p.status !== 'inactive')) throw Error('演练副本初始名单不符。');
    for (const player of roster) club.savePlayer(1, player.id, {
      revision: player.revision, status: 'active',
      note: player.note + '\n仅本机演练临时启用，不代表本人当前在队或同意注册。之后创建的比赛、报名和成绩均属模拟，不是真实事实。'
    });
    db.prepare('UPDATE club_teams SET name=? WHERE id=1').run('柏林花园·本机模拟演练（非真实现况或比赛）');
    const playerAccounts = ['bg-1','bg-2'].map(playerId => {
      if (!roster.some(p => p.id === playerId)) throw Error('演练账号目标来源编号缺失。');
      const account = {playerId, username:'rehearsal-' + randomBytes(12).toString('hex'), password:randomBytes(24).toString('base64url')};
      club.createAccount(1, playerId, {username:account.username,password:account.password});
      return account;
    });
    store.close(); store = null;
    if (digest(sourceDatabasePath) !== sourceHashBefore) throw Error('演练准备影响了来源库，停止启动。');
    server = createFootballServer({
      databasePath, staticDirectory:join(directory,'no-static-files'), bootstrapAdmin:null,
      publicOrigin:'', secureCookies:false, trustedProxyAddresses:[], wechat:{enabled:false}, aiPhotos:{enabled:false}
    });
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const port = server.address().port, manifestPath = join(directory,'rehearsal-private-manifest.json');
    writeFileSync(manifestPath,JSON.stringify({
      purpose:'历史来源名单的本机业务演练，不是本人现况、账号或比赛事实',
      sourceRosterIsHistorical:true, temporaryMembership:true, accountsAreFictional:true,
      directory, sourceDatabasePath, databasePath, sourceHashBefore, sourceHashAfter,
      playerCount:20, port, admin:sourceManifest.credentials, playerAccounts,
      warning:'不上传名单或凭据，不修改原有数据库；微信、AI关闭，不自动打开地图或修改小程序配置。'
    },null,2),{flag:'wx',mode:0o600});
    let closing;
    return {directory, manifestPath, port, close(){
      if(!closing) closing=new Promise((resolveClose,reject)=>{
        server.closeAllConnections();
        server.close(async error=>{
          try{await server.drained;}catch(drainError){reject(error || drainError);return;}
          if(error)reject(error);else resolveClose();
        });
      });
      return closing;
    }};
  } catch(error) {
    try{source?.close();}catch{}
    try{store?.close();}catch{}
    if(server){try{server.closeAllConnections();}catch{}try{await new Promise(done=>server.close(()=>done()));await server.drained;}catch{}}
    if(directory){try{rmSync(directory,{recursive:true,force:true});}catch{}}
    throw error;
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  parseBerlinRehearsalArguments(process.argv.slice(2));
  const rehearsal=await startBerlinRehearsal();
  console.log(`本机名单演练地址：http://127.0.0.1:${rehearsal.port}`);
  console.log(`私有演练账号清单仅保存在：${rehearsal.manifestPath}`);
  console.log('20人姓名位置来自项目历史资料；临时启用、账号和之后的比赛均非真实事实。未修改小程序配置。Ctrl+C停止，目录保留。');
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;try{await rehearsal.close();process.exitCode=0;}catch{process.exitCode=1;console.error('停止服务未完成，请核对本机进程。');}};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
