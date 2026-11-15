import { readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { once } from 'node:events';
import { createBerlinValidation } from './create-berlin-validation.mjs';
import { openFootballStore } from '../server/football-store.mjs';
import { createClubStore } from '../server/club-store.mjs';
import { createFootballServer } from '../server/index.mjs';

export function parseBerlinShowcaseArguments(args) {
  if (!Array.isArray(args) || args.length) throw Error('柏林花园本机展示不接受路径、端口、账号或其他参数。');
}
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
// 每次新建来源库与一致性展示副本；不接受任何已有资料库路径。
export async function startBerlinShowcase() {
  if (arguments.length) throw Error('柏林花园本机展示不接受参数。');
  let directory, source, store, server;
  try {
    const seed = createBerlinValidation();
    directory = seed.directory;
    const sourceDatabasePath = join(directory, 'validation.sqlite');
    const databasePath = join(directory, 'showcase.sqlite');
    const sourceManifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
    if (seed.total !== 20 || sourceManifest.total !== 20 || sourceManifest.databasePath !== sourceDatabasePath)
      throw Error('新来源资料库与生成清单不一致，停止展示。');
    const sourceHashBefore = digest(sourceDatabasePath);
    // 目标只在本次新目录中独占创建；SQLite backup处理一致性，不拼接数据库文件。
    writeFileSync(databasePath, '', { flag: 'wx', mode: 0o600 });
    source = new DatabaseSync(sourceDatabasePath, { readOnly: true });
    await backup(source, databasePath);
    source.close(); source = null;
    const sourceHashAfter = digest(sourceDatabasePath);
    if (sourceHashBefore !== sourceHashAfter) throw Error('来源资料库摘要发生变化，停止展示。');
    chmodSync(databasePath, 0o600);
    store = openFootballStore(databasePath);
    const club = createClubStore(store.database, store);
    const roster = club.listPlayers(1);
    if (roster.length !== 20 || roster.some(p => p.status !== 'inactive')) throw Error('展示副本初始名单不符。');
    // 只清除本次来源生成器的固定技术说明，不擦除任何真实用户备注。
    const generatedNote = '项目历史来源，现况未逐人核实；暂不启用仅为隔离验证状态，不代表实际离队。号码、头像、惯用脚、年龄与健康未知。';
    if (roster.some(player => player.note !== generatedNote))
      throw Error('来源备注不符合固定生成说明，停止展示以保护原备注。');
    for (const player of roster) club.savePlayer(1, player.id, {
      revision: player.revision, membershipConfirmed: false, note: ''
    });
    if (club.listPlayers(1).some(p => p.membershipConfirmed !== false || p.status !== 'inactive'))
      throw Error('成员待确认标记未生效，停止展示。');
    const crest = readFileSync(new URL('../app/public/team-badge.png', import.meta.url));
    const team = club.getTeam(1);
    club.saveTeam(1, {revision:team.revision, name:'柏林花园 FC', crest:'data:image/png;base64,' + crest.toString('base64')});
    store.close(); store = null;
    if (digest(sourceDatabasePath) !== sourceHashBefore) throw Error('展示准备影响了来源库，停止启动。');
    server = createFootballServer({
      databasePath, staticDirectory:join(directory,'no-static-files'), bootstrapAdmin:null,
      publicOrigin:'', secureCookies:false, trustedProxyAddresses:[], wechat:{enabled:false}, aiPhotos:{enabled:false}
    });
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    const port = server.address().port, manifestPath = join(directory,'showcase-private-manifest.json');
    writeFileSync(manifestPath,JSON.stringify({
      purpose:'历史来源名单的干净本机展示，成员现况未确认，管理员仅为本地操作凭据',
      sourceRosterIsHistorical:true, membershipConfirmed:false, localOperatorOnly:true,
      directory, sourceDatabasePath, databasePath, sourceHashBefore, sourceHashAfter,
      playerCount:20, port, admin:sourceManifest.credentials,
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
  parseBerlinShowcaseArguments(process.argv.slice(2));
  const showcase=await startBerlinShowcase();
  console.log(`本机名单展示地址：http://127.0.0.1:${showcase.port}`);
  console.log(`私有展示账号清单仅保存在：${showcase.manifestPath}`);
  console.log('20人姓名位置来自项目历史资料，成员现况未确认；未创建球员账号、比赛或统计。未修改小程序配置。Ctrl+C停止，目录保留。');
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;try{await showcase.close();process.exitCode=0;}catch{process.exitCode=1;console.error('停止服务未完成，请核对本机进程。');}};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
