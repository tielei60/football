// 设置页静态预览：仅离屏位图和内存 URL，不读写文件或网络。
const renderer = require('./tactic-canvas');
const png = require('./png-rgba');
let recoveryBlocked = false;
const failedResources = new Set();
const unsupported = '当前微信暂不支持图片预览，请更新微信。阵容设置仍可使用。';
const releaseFailure = '预览资源未能释放，已停止生成。请结束本次小程序后重新进入；表单仍可使用。';
function outputSize(width, height, dpr) {
  if (![width,height,dpr].every(n=>Number.isFinite(n)&&n>0)) throw Error('预览尺寸无效');
  const scale=Math.min(dpr,2,600/width,908/height);
  const w=Math.floor(width*scale),h=Math.floor(height*scale);
  if(w<1||h<1||w>600||h>908||w*h>png.MAX_PIXELS||w*h*4*8>24*1024*1024)throw Error('预览尺寸超出内存预算');
  return {width:w,height:h};
}
function supported(platform) {
  let info;
  try { info=platform.getAppBaseInfo?platform.getAppBaseInfo():platform.getSystemInfoSync(); } catch (_) { return false; }
  const v=String(info.SDKVersion||'').split('.').map(Number);
  return v.length>=3&&v.every(Number.isInteger)&&(v[0]>2||(v[0]===2&&(v[1]>16||(v[1]===16&&v[2]>=1))))&&
    ['createOffscreenCanvas','createBufferURL','revokeBufferURL'].every(k=>typeof platform[k]==='function');
}
function create(update, platform=wx) {
  let disposed=false,busy=false,pending=null,current=null,sequence=0,operation=0;
  const urls=new Map();
  function publish(data,callback){if(!disposed)update(data,callback);else callback?.();}
  function revoke(url){
    if(!urls.has(url)||urls.get(url))return;
    try { platform.revokeBufferURL(url);urls.delete(url); }
    catch (_) { urls.set(url,true);failedResources.add(url);recoveryBlocked=true;pending=null; }
  }
  function reportBlocked(){busy=false;pending=null;publish({previewBusy:false,previewBlocked:true,renderError:releaseFailure});}
  function clearThen(next){
    busy=true;const op=++operation,old=[...urls.keys()];current=null;
    publish({previewImages:[],previewBusy:true},()=>{
      for(const url of old)revoke(url);
      if(op!==operation||disposed)return;
      busy=false;
      if(disposed)return;
      if(recoveryBlocked){reportBlocked();return;}
      next();
    });
  }
  function drain(){
    if(disposed||busy||!pending)return;
    if(recoveryBlocked){reportBlocked();return;}
    if(current&&current.key===pending.key&&current.scope===pending.scope&&!pending.force){current.valid=pending.valid;pending=null;return;}
    clearThen(()=>{
      const request=pending;pending=null;
      if(!request||!request.valid()){publish({previewBusy:false});return;}
      render(request);
    });
  }
  function render(request){
    if(disposed||!request.valid())return;
    busy=true;let url;
    try {
      if(!supported(platform))throw Error(unsupported);
      const size=outputSize(request.width,request.height,request.dpr);
      const node=platform.createOffscreenCanvas({type:'2d',...size});
      const ctx=renderer.prepareSurface(node,size.width,size.height,1);
      if(typeof ctx.getImageData!=='function')throw Error(unsupported);
      renderer.draw(ctx,request.board,size.width,size.height);
      const pixels=ctx.getImageData(0,0,size.width,size.height);
      if(pixels.width!==size.width||pixels.height!==size.height||pixels.data?.length!==size.width*size.height*4)throw Error('预览像素读取失败，请重试。');
      const bytes=png.encode(size.width,size.height,pixels.data);
      if(disposed||!request.valid()){busy=false;drain();return;}
      url=platform.createBufferURL(bytes);
      if(typeof url!=='string'||!url)throw Error('预览图片创建失败，请重试。');
      urls.set(url,false);
      if(disposed||!request.valid()){revoke(url);busy=false;drain();return;}
      current={...request,id:++sequence,url};
      publish({previewImages:[{id:current.id,src:url}],previewBusy:true,previewBlocked:false,renderError:''});
    }catch(error){
      if(url)revoke(url);
      busy=false;current=null;
      if(recoveryBlocked){reportBlocked();return;}
      if(!disposed&&request.valid())publish({previewBusy:false,renderError:error.message===unsupported?unsupported:'预览生成失败，可重试。阵容设置仍可使用。'});
      drain();
    }
  }
  return {
    request(spec){
      if(disposed)return;
      if(recoveryBlocked){reportBlocked();return;}
      // 留一份不可变匿名/业务快照；不把模型或大像素数据交给 setData。
      const encoded=JSON.stringify(spec.board);
      const size=outputSize(spec.width,spec.height,spec.dpr);
      pending={...spec,board:JSON.parse(encoded),key:size.width+':'+size.height+':'+encoded};
      if(current&&current.key===pending.key&&current.scope===spec.scope&&!spec.force){current.valid=spec.valid;pending=null;publish({previewBusy:busy});return;}
      if(current&&current.scope!==spec.scope)busy=false;
      drain();
    },
    loaded(id,ok){
      if(disposed||!current||current.id!==Number(id))return;
      const shown=current;busy=false;
      if(shown.valid())publish({previewBusy:false,renderError:ok?'':'预览图片未能加载，可重试。阵容设置仍可使用。'});
      if(!ok)current.key='';
      drain();
    },
    stop(){
      if(disposed)return;
      pending=null;sequence++;
      clearThen(()=>{publish({previewBusy:false});drain();});
    },
    dispose(){operation++;disposed=true;pending=null;current=null;sequence++;for(const url of urls.keys())revoke(url);},
    isBlocked(){return recoveryBlocked;}
  };
}
module.exports={create,outputSize};
