const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/shared.js'),'utf8'),{module,require:p=>p.includes('media')?{imageSource:x=>x}:p.includes('player-initial')?{playerInitial:()=> '甲'}:{getSession:()=>({token:'owner'})}});
 const page={_epoch:1,_filterOwner:'owner',data:{loading:false,error:''},setData(patch){for(const [k,v]of Object.entries(patch)){const m=/^(players|visible)\[(\d+)\]\.avatar$/.exec(k);if(m)this.data[m[1]][Number(m[2])].avatar=v;else this.data[k]=v;}}};
 const players=[{id:'a',name:'甲',avatar:'/a.png',number:0,positions:['后卫']},{id:'b',name:'乙',avatar:'/b.png'}];
 module.exports.safeSetData(page,{players,visible:players});
 return{page,error:(id='a',src='/a.png',index=0)=>module.exports.imageError.call(page,{currentTarget:{dataset:{target:'list',id,src,index,epoch:1}}})};
}
test('头像失败同步清理展示及底表，筛选恢复不复活坏图片且保留球员资料',()=>{
 const h=fixture();assert.notEqual(h.page.data.players[0],h.page.data.visible[0]);h.error();
 assert.equal(h.page.data.players[0].avatar,'');assert.equal(h.page.data.visible[0].avatar,'');
 h.page.setData({visible:h.page.data.players.filter(p=>p.name==='甲')});assert.equal(h.page.data.visible[0].avatar,'');
 assert.equal(h.page.data.players[0].number,0);assert.equal(h.page.data.players[0].name,'甲');assert.equal(h.page.data.players[0].positions[0],'后卫');
});
test('筛选后旧index错误不清理另一个球员的头像',()=>{
 const h=fixture();h.page.setData({visible:[h.page.data.players[1]]});h.error('a','/a.png',0);
 assert.equal(h.page.data.visible[0].avatar,'/b.png');assert.equal(h.page.data.players[0].avatar,'');
});
test('旧图片错误不清理同球员新头像；重排后只清理匹配图片',()=>{
 const h=fixture();h.page.data.players[0].avatar='/new.png';h.page.data.visible[0].avatar='/new.png';h.error();assert.equal(h.page.data.visible[0].avatar,'/new.png');
 h.page.setData({visible:[...h.page.data.visible].reverse()});h.error('a','/new.png',0);assert.equal(h.page.data.visible[0].avatar,'/b.png');assert.equal(h.page.data.visible[1].avatar,'');
});
test('隐藏卸载加载失败及无身份事件不修改列表',()=>{
 for(const modify of [p=>p._epoch=2,p=>p._filterOwner='other',p=>p._hidden=true,p=>p._disposed=true,p=>p.data.loading=true,p=>p.data.error='错误']){const h=fixture();modify(h.page);h.error();assert.equal(h.page.data.players[0].avatar,'/a.png');}
 for(const [id,src]of [[null,'/a.png'],['a',''],['other','/a.png']]){const h=fixture();h.error(id,src);assert.equal(h.page.data.players[0].avatar,'/a.png');}
});
test('两种球员列表事件都提供稳定身份和当时图片来源，不仅有index',()=>{
 for(const name of ['players','manage-players']){const w=fs.readFileSync(path.join(__dirname,'../pages',name,'index.wxml'),'utf8');const image=w.match(/<image\b[^>]*data-target="list"[^>]*\/>/)[0];assert.match(image,/data-id="{{item.id}}"/);assert.match(image,/data-src="{{item.avatar}}"/);assert.match(image,/data-epoch="{{imageEpoch}}"/);assert.match(image,/binderror="imageError"/);}
});
for(const name of ['players','manage-players'])test(name+' 实际加载筛选保持占位，刷新允许重新尝试头像',async()=>{
 const rows=[{id:'a',name:'甲',avatar:'/a.png',status:'active',positions:['后卫'],number:0}];
 const api={getSession:()=>({token:'owner'}),ensureSession:async()=>({user:{role:'admin'},team:{id:1,name:'球队'}}),request:async()=>structuredClone(rows)};
 const module={exports:{}};const wx={stopPullDownRefresh(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/shared.js'),'utf8'),{module,wx,require:p=>p.includes('media')?{imageSource:x=>x}:p.includes('player-initial')?{playerInitial:()=> '甲'}:api});
 const shared=module.exports;let definition;
 const adminModule={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/manage-team/admin.js'),'utf8'),{module:adminModule,wx,require:p=>p==='../shared'?shared:{abort(){}}});
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages',name,'index.js'),'utf8'),{Page:p=>definition=p,require:p=>p.includes('/admin')?adminModule.exports:p==='../shared'?shared:{abort(){}}});
 const page={...definition,data:structuredClone(definition.data),setData(patch){for(const[k,v]of Object.entries(patch)){const m=/^(players|visible)\[(\d+)\]\.avatar$/.exec(k);if(m)this.data[m[1]][Number(m[2])].avatar=v;else this.data[k]=v;}}};
 await page.refresh();assert.equal(page.data.imageEpoch,page._epoch);
 const oldEpoch=page._epoch;
 page.imageError({currentTarget:{dataset:{target:'list',id:'a',src:'/a.png',epoch:oldEpoch,index:0}}});
 page.search({detail:{value:'无结果'}});assert.equal(page.data.visible.length,0);
 page.search({detail:{value:''}});assert.equal(page.data.visible[0].avatar,'');
 await page.refresh();assert.equal(page.data.visible[0].avatar,'/a.png');
 page.imageError({currentTarget:{dataset:{target:'list',id:'a',src:'/a.png',epoch:oldEpoch,index:0}}});
 assert.equal(page.data.visible[0].avatar,'/a.png');
 page.imageError({currentTarget:{dataset:{target:'list',id:'a',src:'/a.png',epoch:page._epoch,index:0}}});
 assert.equal(page.data.visible[0].avatar,'');assert.equal(page.data.players[0].avatar,'');
});
