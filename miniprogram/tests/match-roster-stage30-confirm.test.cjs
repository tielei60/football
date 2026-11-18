// 阶段30：真实Page/shared/ui，传输与弹框宿主为内存替身；不是原生或统计闭环验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..');
async function fixture(){
 let def,bridge,dialog;const writes=[];
 const snapshot={id:'a',name:'历史甲',number:7,positions:['CB']};
 const match={revision:3,opponent:'匿名对手',seasonId:null,roster:[{playerId:'a',selection:'bench',appeared:true,position:'CB',goals:1,assists:2,playerSnapshot:snapshot,snapshotSource:'captured'}]};
 const players=[{id:'a',name:'当前甲',number:9,positions:['ST'],status:'active'},{id:'b',name:'匿名乙',number:2,positions:['GK'],status:'active'}];
 const api={getSession:()=>({token:'fixture-owner'}),ensureSession:async()=>({user:{role:'admin'},team:{id:1}}),request:async(url,method,body)=>{if(method==='PUT'){writes.push({url,body});return {...match,revision:4,roster:body.roster.map(r=>({...r,playerSnapshot:snapshot}))};}return url==='/players'?players:match;}};
 const shared={module:{exports:{}},require:n=>n.endsWith('/api')?api:{imageSource:x=>x},wx:{stopPullDownRefresh(){}}};vm.runInNewContext(fs.readFileSync(path.join(root,'pages/shared.js'),'utf8'),shared);
 const uc={module:{exports:{}},require:()=>api,setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync(path.join(root,'utils/ui.js'),'utf8'),uc);const ui=uc.module.exports;
 vm.runInNewContext(fs.readFileSync(path.join(root,'pages/match-roster/index.js'),'utf8'),{Page:d=>def=d,require:n=>n.endsWith('/utils/ui')?ui:shared.module.exports});
 const host={connect:b=>bridge=b,present:s=>dialog=s,clearInput(){}};
 const page={...def,id:'7',data:structuredClone(def.data),selectComponent:()=>host,setData(p,cb){for(const[k,v]of Object.entries(p)){const m=/^rows\[(\d+)\]\.(\w+)$/.exec(k);if(m)this.data.rows[Number(m[1])][m[2]]=v;else this.data[k]=v;}cb?.();}};
 await page.refresh();return{page,writes,ui,dialog:()=>dialog?.modal,settle:yes=>yes?bridge.confirm(dialog.modal.id,''):bridge.cancel(dialog.modal.id)};
}
const event=(field,value)=>({currentTarget:{dataset:{id:'a',field}},detail:{value}});
for(const appearance of [0,2])test('清个人数据改为'+(appearance===0?'待确认':'未出场')+'取消保留全部草稿，确认不改变替补与位置',async()=>{
 const f=await fixture(),before=JSON.stringify(f.page.data.rows),original=JSON.stringify([...f.page._originalRows]);
 f.page.pick(event('appearanceIndex',String(appearance)));assert.equal(f.dialog().title,'清除个人数据');f.settle(false);
 assert.equal(JSON.stringify(f.page.data.rows),before);assert.equal(JSON.stringify([...f.page._originalRows]),original);assert.equal(f.writes.length,0);
 f.page.pick(event('appearanceIndex',String(appearance)));f.settle(true);const row=f.page.data.rows[0];
 assert.equal(row.appearanceIndex,appearance);assert.equal(row.selectionIndex,2);assert.equal(row.positionValues[row.positionIndex],'CB');assert.equal(row.goals,'');assert.equal(row.assists,'');assert.equal(row.name,'历史甲');assert.equal(f.writes.length,0);
 await f.page.save();const saved=f.writes[0].body.roster[0];assert.equal(saved.selection,'bench');assert.equal(saved.position,'CB');assert.equal(saved.appeared,appearance===0?null:false);assert.equal(saved.goals,null);assert.equal(saved.assists,null);assert.equal(f.writes.length,1);f.ui.abort(f.page);
});
test('移除取消保留人数候选与历史基线，确认只改草稿且未保存重加仍用旧快照',async()=>{
 const f=await fixture(),rows=JSON.stringify(f.page.data.rows),candidates=JSON.stringify(f.page.data.candidates),original=JSON.stringify([...f.page._originalRows]);
 f.page.remove(event());assert.equal(f.dialog().title,'移除比赛名单');f.settle(false);
 assert.equal(JSON.stringify(f.page.data.rows),rows);assert.equal(JSON.stringify(f.page.data.candidates),candidates);assert.equal(f.page.data.savedRosterCount,1);assert.equal(JSON.stringify([...f.page._originalRows]),original);assert.equal(f.writes.length,0);
 f.page.remove(event());f.settle(true);assert.equal(f.page.data.rows.length,0);assert.equal(f.page.data.savedRosterCount,1);assert.equal(f.writes.length,0);assert.equal(JSON.stringify([...f.page._originalRows]),original);
 const i=f.page.data.candidates.findIndex(x=>x.id==='a');assert.match(f.page.data.candidates[i].label,/历史甲.*7号/);f.page.choosePlayer({detail:{value:String(i)}});f.page.add();assert.equal(f.page.data.rows[0].name,'历史甲');assert.equal(f.page.data.rows[0].number,7);assert.equal(f.writes.length,0);f.ui.abort(f.page);
});
