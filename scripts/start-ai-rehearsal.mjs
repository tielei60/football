import { mkdtempSync, chmodSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { openFootballStore } from '../server/football-store.mjs';
import { createClubStore } from '../server/club-store.mjs';
import { createFootballServer } from '../server/index.mjs';
import { createLocalPlayerAiProvider } from '../server/player-ai-local-provider.mjs';

export function parseAiRehearsalArguments(args) {
  if (!Array.isArray(args) || args.length) throw Error('本机AI模拟演练不接受参数、数据库、端口、供应商或密钥。');
}
// 固定本机几何合成器：不读取生产配置，不接受真实人像，不连接生成服务。
export async function startAiRehearsal() {
  if (arguments.length) throw Error('本机AI模拟演练不接受参数。');
  const directory = mkdtempSync(join(tmpdir(), 'football-ai-rehearsal-'));
  const databasePath = join(directory, 'anonymous.sqlite');
  let store, server;
  try {
    chmodSync(directory, 0o700);
    writeFileSync(databasePath, '', {flag:'wx',mode:0o600});
    const admin = {username:'ai-rehearsal-admin',password:randomBytes(24).toString('base64url')};
    const playerAccount = {username:'ai-rehearsal-player',password:randomBytes(24).toString('base64url')};
    store = openFootballStore(databasePath);
    const club = createClubStore(store.database, store, {bootstrapAdmin:admin});
    const session = club.login(admin,'isolated-ai-seed','native');
    const user = club.authenticate(session.token,'native');
    const players = {};
    for (const [index,key] of ['member','portrait','avatar','cover'].entries()) {
      players[key] = club.savePlayer(user.team_id,null,{
        name:`模拟成年队员${index+1}·${key}`, number:index+1, positions:['中场'],
        note:'完全虚构，仅本机AI几何样本演练，不是真实球员或照片。'
      });
    }
    club.createAccount(user.team_id,players.member.id,playerAccount);
    club.logout(session.token);
    store.close(); store=null;
    server = createFootballServer({
      databasePath,staticDirectory:join(directory,'no-static-files'),bootstrapAdmin:null,
      publicOrigin:'',secureCookies:false,trustedProxyAddresses:[],wechat:{enabled:false},
      aiPhotos:{enabled:true,provider:createLocalPlayerAiProvider(),policy:{mode:'local-simulation',currency:'XXX',amountMinor:0,version:'simulation-v1',lifetimeMs:3600000}}
    });
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const port=server.address().port,manifestPath=join(directory,'private-manifest.json');
    writeFileSync(manifestPath,JSON.stringify({fictional:true,mode:'local-simulation',directory,databasePath,port,admin,playerAccount,players,warning:'仅本机几何样本，微信关闭，无真实AI、真实照片或费用；不得当作正式服务配置。'},null,2),{flag:'wx',mode:0o600});
    let closing;
    return {directory,manifestPath,port,close(){
      if (!closing) closing=new Promise((resolveClose,reject)=>{
        server.closeAllConnections();
        server.close(error=>{
          if(error){reject(error);return;}
          Promise.resolve(server.drained).then(resolveClose,reject);
        });
      });
      return closing;
    }};
  } catch(error) {
    try{store?.close();}catch{}
    if(server){
      try{server.closeAllConnections();}catch{}
      try{await new Promise(done=>server.close(()=>done()));await server.drained;}catch{}
    }
    try{rmSync(directory,{recursive:true,force:true});}catch{}
    throw error;
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  parseAiRehearsalArguments(process.argv.slice(2));
  const rehearsal=await startAiRehearsal();
  console.log(`本机AI模拟地址：http://127.0.0.1:${rehearsal.port}`);
  console.log(`私有演练账号仅保存在：${rehearsal.manifestPath}`);
  console.log('仅几何样本，无真实AI或费用，微信关闭。未修改小程序配置；Ctrl+C停止，目录保留。');
  let stopping=false;
  const stop=async()=>{
    if(stopping)return;stopping=true;
    try{await rehearsal.close();process.exitCode=0;}catch{process.exitCode=1;console.error('停止服务未完成，请核对本机进程。');}
    // 不强行process.exit：让服务内部已开始的图片处理及资源回收自然结束。
  };
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
