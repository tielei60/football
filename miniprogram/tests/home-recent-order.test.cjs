const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
async function load(matches){
 const requests=[];const api={ensureSession:async()=>({user:{role:'player',playerId:'p'},team:{id:1,name:'球队'}}),request:async url=>{requests.push(url);return url==='/matches'?structuredClone(matches):url==='/players'?[]:{team:{matches:5,wins:2}};}};
 const module={exports:{}};const wx={stopPullDownRefresh(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/shared.js'),'utf8'),{module,wx,require:p=>p.includes('media')?{imageSource:x=>x}:p.includes('player-initial')?{playerInitial:()=> '球'}:api});
 let definition;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/home/index.js'),'utf8'),{Page:p=>definition=p,require:p=>p==='../shared'?module.exports:p.includes('match-result-view')?require('../utils/match-result-view'):{abort(){}}});
 const page={...definition,data:structuredClone(definition.data),setData(patch){Object.assign(this.data,patch);}};await page.refresh();return{page,requests};
}
const match=(id,date,kickoff,status='completed',homeScore=1,awayScore=0)=>({id,date,kickoff,status,homeScore,awayScore,side:'home',opponent:'对手'+id,rsvps:[]});
test('同日补录较早赛事不能挤掉较晚赛果，先按日期时间排序再取三场',async()=>{
 const matches=[match(9,'2026-11-17','08:00'),match(8,'2026-11-17','10:00'),match(7,'2026-11-17','12:00'),match(6,'2026-11-17','20:00')];
 const {page}=await load(matches);assert.deepEqual(Array.from(page.data.recent,m=>m.id),[6,7,8]);assert.equal(page.data.error,'');
 assert.deepEqual(matches.map(m=>m.id),[9,8,7,6]);
});
test('跨日期优先日期，草稿取消和未完赛不进入最近赛果',async()=>{
 const {page}=await load([match(1,'2026-11-16','23:00'),match(2,'2026-11-17','01:00'),match(3,'2026-11-18','12:00','draft'),match(4,'2026-11-18','13:00','cancelled'),match(5,'2026-11-18','14:00','published')]);
 assert.deepEqual(Array.from(page.data.recent,m=>m.id),[2,1]);
});
test('零与未知比分保留真实展示，空记录不伪造赛果',async()=>{
 const {page}=await load([match(1,'2026-11-17','20:00','completed',null,null),match(2,'2026-11-17','10:00','completed',0,0)]);
 assert.equal(page.data.recent[0].scoreLabel,'— : —');assert.equal(page.data.recent[1].scoreLabel,'0 : 0');
 const empty=await load([]);assert.equal(empty.page.data.recent.length,0);assert.equal(empty.page.data.next,null);
});
test('同日未知时间靠后，相同时间保持原稳定次序',async()=>{
 const {page}=await load([match(9,'2026-11-17',''),match(8,'2026-11-17','20:00'),match(7,'2026-11-17','20:00')]);
 assert.deepEqual(Array.from(page.data.recent,m=>m.id),[8,7,9]);
});
