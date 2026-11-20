// 访客凭据仅驻留内存，且与签发服务及单场邀请隔离；不读写成员会话。
const config = require('../config');
let current = null;
const registrations = new Map();
function origin() {
  const base=String(config.apiBaseUrl||'').replace(/\/$/,'');
  if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(base) && !(config.allowLocalHttp===true && /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/.test(base))) throw new Error('请配置有效的 HTTPS 服务地址');
  return base;
}
function validInvite(value){return /^[a-f0-9]{64}$/.test(value||'');}
function session(credential) {
  if(current && (current.origin!==origin() || current.expiresAt<=Date.now()))current=null;
  return current?.credential===credential ? current : null;
}
function clear(){current=null;}
function transport(path,method,data,identity,base=origin()) {
  return new Promise((resolve,reject)=>wx.request({url:base+'/api'+path,method,data,timeout:15000,header:{'Content-Type':'application/json','X-Football-Client':'native-v1',...(identity?{Authorization:'Bearer '+identity.token}:{})},success(r){if(r.statusCode>=200&&r.statusCode<300)resolve(r.data);else {if(r.statusCode===401&&current===identity)current=null;reject(Object.assign(new Error(r.data?.message||'操作未完成，请重试'),{status:r.statusCode}));}},fail(){reject(new Error('网络连接失败，请重试并核对当前报名状态'));}}));
}
function request(credential,suffix='',method='GET',data) {
  if(!validInvite(credential))return Promise.reject(new Error('比赛邀请无效，请重新打开分享卡片'));
  const identity=session(credential);
  if(suffix && !identity)return Promise.reject(Object.assign(new Error('登录已过期，请重新微信登录'),{status:401}));
  return transport((identity?'/guest-matches/':'/public/matches/')+credential+suffix,method,data,identity);
}

function registrationKey(credential,base=origin()){return JSON.stringify([base,credential]);}
function pendingRegistration(credential){return registrations.get(registrationKey(credential))||null;}
function ownsOperation(base,active,owner){
  try{return active()&&base===origin()&&current===owner;}catch{return false;}
}

async function login(credential,active=()=>true){
  if(!validInvite(credential))throw new Error('比赛邀请无效');
  const base=origin(),key=registrationKey(credential,base),owner=current;
  let pending;
  while(ownsOperation(base,active,owner)&&(pending=registrations.get(key)))await pending;
  if(!ownsOperation(base,active,owner))throw new Error('操作已取消');
  const code=await new Promise((resolve,reject)=>wx.login({timeout:15000,success:r=>r.code?resolve(r.code):reject(new Error('未取得微信登录凭据')),fail:()=>reject(new Error('微信登录未完成'))}));
  while(ownsOperation(base,active,owner)&&(pending=registrations.get(key)))await pending;
  if(!ownsOperation(base,active,owner))throw new Error('操作已取消');
  const result=await transport('/auth/wechat/match-entry','POST',{code,shareToken:credential},null,base);
  if(!ownsOperation(base,active,owner)){await revoke(result,base);throw new Error('操作已取消');}
  if(result.needsProfile===true){if(typeof result.registrationToken!=='string'||!result.registrationToken||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now())throw new Error('登记响应无效');return result;}
  if(!/^native_[a-f0-9]{64}$/.test(result.token||'')||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now())throw new Error('登录响应无效，请重试');
  current={credential,origin:base,token:result.token,expiresAt:result.expiresAt};
  return result;
}
async function register(credential,input,active=()=>true){
  if(!validInvite(credential)||!active())throw new Error('操作已取消');
  const base=origin(),key=registrationKey(credential,base),owner=current;
  if(registrations.has(key))throw new Error('上一笔报名正在核对，请稍候');
  // 同一入口的登记请求可能由服务端回放同一个会话，必须等旧请求及作废处理一起结束。
  let finish;
  const done=new Promise(resolve=>{finish=resolve;});
  registrations.set(key,done);
  try{
    const result=await transport('/auth/wechat/match-register','POST',input,null,base);
    if(!ownsOperation(base,active,owner)){await revoke(result,base);throw new Error('操作已取消');}
    if(!/^native_[a-f0-9]{64}$/.test(result.token||'')||!Number.isFinite(result.expiresAt)||result.expiresAt<=Date.now())throw new Error('登记响应无效，请重试');
    current={credential,origin:base,token:result.token,expiresAt:result.expiresAt};
    return result;
  }finally{registrations.delete(key);finish();}
}
async function revoke(result,base){
  const token=result?.token;
  if(/^native_[a-f0-9]{64}$/.test(token||'')&&!(current?.origin===base&&current.token===token))
    await transport('/auth/logout','POST',{},result,base).catch(()=>{});
}
function avatarData(path){
  if(typeof path!=='string'||!/^((wxfile:\/\/)|(https?:\/\/tmp\/)|\/)/.test(path))return Promise.reject(new Error('请通过微信选择头像'));
  return new Promise((resolve,reject)=>{
    const fs=wx.getFileSystemManager();
    fs.getFileInfo({filePath:path,success(info){
      if(!info.size||info.size>2*1024*1024)return reject(new Error('请选择不超过 2 MB 的头像'));
      fs.readFile({filePath:path,encoding:'base64',success(r){
        const data=r.data; const mime=typeof data==='string'&&(data.startsWith('/9j/')?'jpeg':data.startsWith('iVBORw0KGgo')?'png':'');
        if(!mime||data.length>2796204)return reject(new Error('请选择 PNG 或 JPEG 头像'));
        resolve('data:image/'+mime+';base64,'+data);
      },fail:()=>reject(new Error('读取头像失败，请重新选择'))});
    },fail:()=>reject(new Error('无法读取头像，请重新选择'))});
  });
}
function identityKey(credential,memberToken){return JSON.stringify([origin(),memberToken||session(credential)?.token||'',credential]);}
module.exports={validInvite,session,clear,request,login,register,avatarData,identityKey,pendingRegistration};
