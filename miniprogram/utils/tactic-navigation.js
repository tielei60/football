// 导航/恢复以真实 viewport 为准，不以缓存滚动值代表原生视图状态。
function viewport(page,wx,done,withBounds=false){
 try{const q=wx.createSelectorQuery().in(page);q.selectViewport().scrollOffset();if(withBounds)q.select('.page').boundingClientRect();q.exec(rows=>{let result=null;try{const top=rows?.[0]?.scrollTop;if(!Number.isFinite(top)||top<0)throw Error('invalid viewport');let max=null;if(withBounds){const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync(),height=rows?.[1]?.height;if(!Number.isFinite(height)||!Number.isFinite(info?.windowHeight))throw Error('invalid bounds');max=Math.max(0,height-info.windowHeight);}result={top,max};}catch(_){result=null;}done(result);});}catch(_){done(null);}
}
function navigate(page,url,wx,session,kind){
 if(page._scrollNavigation)return;
 const owner=page._owner,epoch=page._epoch,ticket={owner,epoch,top:null};page._scrollNavigation=ticket;
 const permitted=()=>!!page._model&&!page.data.loading&&!page.data.error&&!page.data.editing&&!page.data.busy&&(kind==='export'?page.data.canExport:page.data.canEdit&&!page.query?.matchId);
 const clearOwn=()=>{if(page._scrollNavigation===ticket)page._scrollNavigation=null;};
 const current=()=>permitted()&&page._scrollNavigation===ticket&&page._owner===owner&&session()?.token===owner&&page._epoch===epoch&&!page._hidden&&!page._disposed;
 const fail=()=>{if(!current()){clearOwn();return;}page._scrollNavigation=null;if(Number.isFinite(ticket.top))page._returnScroll=ticket;page.setData({actionError:'未能打开页面，请重试。'},()=>restore(page,wx,session));};
 const next=()=>{const run=()=>{if(!current()){clearOwn();return;}if(ticket.navigated)return;ticket.navigated=true;page._returnScroll=ticket;try{wx.navigateTo({url,fail});}catch(_){fail();}};if(wx.nextTick)wx.nextTick(run);else run();};
 viewport(page,wx,position=>{if(!current()){clearOwn();return;}if(!position){fail();return;}ticket.top=position.top;
 if(!ticket.top){next();return;}if(typeof wx.pageScrollTo!=='function'){fail();return;}
 try{wx.pageScrollTo({scrollTop:0,duration:0,success:()=>{if(!current()){clearOwn();return;}viewport(page,wx,actual=>{if(!current()){clearOwn();return;}if(!actual||actual.top>1){fail();return;}page._pageScrollTop=actual.top;next();});},fail});}catch(_){fail();}});
}
function enter(page){page._scrollNavigation=null;page._scrollRestore=null;}
function restore(page,wx,session){
 const saved=page._returnScroll;if(!saved||page._scrollRestore)return;
 const owner=page._owner,epoch=page._epoch;
 if(saved.owner!==owner||session()?.token!==owner){if(page._returnScroll===saved)page._returnScroll=null;return;}
 if(saved.restoreEpoch===epoch)return;
 const ticket={owner,epoch,saved,attempts:0};page._scrollRestore=ticket;saved.restoreEpoch=epoch;
 const current=()=>page._scrollRestore===ticket&&page._returnScroll===saved&&page._owner===owner&&session()?.token===owner&&page._epoch===epoch&&!page._hidden&&!page._disposed&&!page._scrollNavigation&&!page.data.loading&&!page.data.error;
 const stop=state=>{if(page._scrollRestore===ticket){page._scrollRestore=null;page._scrollRestoreStatus=state;}};
 const next=f=>wx.nextTick?wx.nextTick(f):f();
 const attempt=()=>{if(!current()){stop('stale');return;}ticket.attempts++;viewport(page,wx,position=>{if(!current()){stop('stale');return;}if(!position){stop('read-failed');return;}const target=Math.min(saved.top,position.max);ticket.target=target;
 const verify=()=>viewport(page,wx,actual=>{if(!current()){stop('stale');return;}if(actual&&Math.abs(actual.top-target)<=1){page._pageScrollTop=actual.top;page._returnScroll=null;stop(target<saved.top?'clamped-confirmed':'confirmed');}else if(ticket.attempts<2)next(attempt);else stop('unconfirmed');});
 if(Math.abs(position.top-target)<=1){verify();return;}if(typeof wx.pageScrollTo!=='function'){stop('unavailable');return;}try{wx.pageScrollTo({scrollTop:target,duration:0,success:()=>next(verify),fail:()=>stop('scroll-failed')});}catch(_){stop('scroll-failed');}
 },true);};next(attempt);
}
module.exports={navigate,enter,restore,invalidate:enter};
