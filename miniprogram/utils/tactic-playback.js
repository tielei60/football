// Pure playback for tacticLanguage.Board.demonstration; no DOM/timers/session state.
// Matches Web animationStore timeline and path.ts Catmull-Rom control points.
// SVG uses browser-specific numeric integration. Here adaptive polyline arc length
// uses 0.001 canonical-coordinate flatness and polygon/chord gap per leaf.
// No claim of bit-identical SVG output; tests compare dense independent samples.
// Stage 0 is initial state (duration ignored); duration belongs to target stage.
const TOLERANCE = 0.001;
const finite = n => typeof n === 'number' && Number.isFinite(n);
const point = p => p && finite(p.x) && finite(p.y) && Math.abs(p.x)<=1e6 && Math.abs(p.y)<=1e6;
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const mix = (a,b,t=.5) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function cubicSegments(points) {
 return points.slice(0,-1).map((p1,i)=>{
  const p0=points[i-1]||p1,p2=points[i+1],p3=points[i+2]||p2;
  return [{x:p1.x,y:p1.y},
   {x:p1.x+(p2.x-p0.x)/6,y:p1.y+(p2.y-p0.y)/6},
   {x:p2.x-(p3.x-p1.x)/6,y:p2.y-(p3.y-p1.y)/6},
   {x:p2.x,y:p2.y}];
 });
}
function lineDistance(p,a,b) {
 const d=distance(a,b);return d?Math.abs((b.x-a.x)*(a.y-p.y)-(a.x-p.x)*(b.y-a.y))/d:distance(p,a);
}
function makeRoute(from,bend,to) {
 if(![from,bend,to].every(point))throw new Error('Invalid playback coordinates');
 const samples=[{x:from.x,y:from.y,length:0}];
 let total=0;
 function append(p){const previous=samples[samples.length-1];total+=distance(previous,p);samples.push({x:p.x,y:p.y,length:total});if(samples.length>32768)throw new Error('Playback curve exceeds sampling budget');}
 function split(c,depth){
  const [a,b,c2,d]=c,poly=distance(a,b)+distance(b,c2)+distance(c2,d);
  if(poly-distance(a,d)<=TOLERANCE && Math.max(lineDistance(b,a,d),lineDistance(c2,a,d))<=TOLERANCE){append(d);return;}
  if(depth>=24)throw new Error('Playback curve cannot meet tolerance');
  const ab=mix(a,b),bc=mix(b,c2),cd=mix(c2,d),abc=mix(ab,bc),bcd=mix(bc,cd),middle=mix(abc,bcd);
  split([a,ab,abc,middle],depth+1);split([middle,bcd,cd,d],depth+1);
 }
 cubicSegments([from,bend,to]).forEach(c=>split(c,0));
 return {samples,length:total};
}
function atLength(route,progress) {
 const t=finite(progress)?Math.max(0,Math.min(1,progress)):0;
 const points=route.samples;
 if(!route.length||t===0)return {x:points[0].x,y:points[0].y};
 if(t===1)return {x:points[points.length-1].x,y:points[points.length-1].y};
 const wanted=t*route.length;let lo=0,hi=points.length-1;
 while(hi-lo>1){const mid=(lo+hi)>>1;if(points[mid].length<wanted)lo=mid;else hi=mid;}
 const a=points[lo],b=points[hi],span=b.length-a.length;
 return mix(a,b,span?(wanted-a.length)/span:0);
}
function createPlayback(demo={}) {
 const stages=Array.isArray(demo.stages)?demo.stages:[];
 const participants=Array.isArray(demo.participants)?demo.participants:[];
 const runs=Array.isArray(demo.runs)?demo.runs:[];
 if(stages.length>120||participants.length>5000||runs.length>100000)throw new Error('Playback data exceeds supported limits');
 const pool=new Map(participants.filter(p=>p&&['string','number'].includes(typeof p.pieceId)).map(p=>[p.pieceId,{...p}]));
 const actions=new Map();
 // Web .find chooses the first matching action, not last.
 for(const r of runs){if(!r)continue;let map=actions.get(r.fromStage);if(!map){map=new Map();actions.set(r.fromStage,map);}if(!map.has(r.pieceId))map.set(r.pieceId,r);}
 let duration=0,skipped=0,sampleCount=0;
 const frames=stages.map((stage,index)=>{
  stage=stage||{};const positions=Array.isArray(stage.positions)?stage.positions:[];
  if(positions.length>5000)throw new Error('Playback stage exceeds supported limits');
  const pieces=positions.flatMap(p=>{
   if(!point(p)||!pool.has(p.pieceId)){skipped++;return [];}
   return [{...pool.get(p.pieceId),x:p.x,y:p.y}];
  });
  const seconds=index?Math.max(.5,Math.min(30,finite(stage.durationSeconds)?stage.durationSeconds:3)):0;
  const start=duration;duration+=seconds;
  return {start,end:duration,duration:seconds,pieces,routes:new Map()};
 });
 for(let i=1;i<frames.length;i++){
  const previous=new Map(frames[i-1].pieces.map(p=>[p.pieceId,p]));
  for(const to of frames[i].pieces){
   const from=previous.get(to.pieceId);
   if(!from||(from.x===to.x&&from.y===to.y))continue;
   const bend=actions.get(i-1)?.get(to.pieceId)?.bend;
   const route=makeRoute(from,point(bend)?bend:mix(from,to),to);
   sampleCount+=route.samples.length;
   if(sampleCount>1000000)throw new Error('Playback total sampling budget exceeded');
   frames[i].routes.set(to.pieceId,route);
  }
 }
 return {frames,duration,skipped};
}
function seek(model,seconds) {
 const time=Math.max(0,Math.min(model.duration,finite(seconds)?seconds:0));
 if(!model.frames.length)return {time:0,duration:0,stageIndex:-1,progress:1,ended:true,pieces:[]};
 let index=time===0?0:model.frames.findIndex((f,i)=>i>0&&time<=f.end);
 if(index<0)index=model.frames.length-1;
 const frame=model.frames[index],progress=index===0||!frame.duration?1:Math.max(0,Math.min(1,(time-frame.start)/frame.duration));
 const pieces=frame.pieces.map(p=>{
  const route=frame.routes.get(p.pieceId);
  return {...p,...(route&&progress<1?atLength(route,progress):{})};
 });
 return {time,duration:model.duration,stageIndex:index,progress,ended:time>=model.duration,pieces};
}
function advance(model,seconds,deltaSeconds,{loop=false,speed=1}={}) {
 const base=seek(model,seconds).time,delta=finite(deltaSeconds)?Math.max(0,deltaSeconds):0;
 const rate=finite(speed)?Math.max(0,speed):1;
 const next=base+delta*rate;
 if(!Number.isFinite(next))return {...seek(model,model.duration),wrapped:false};
 const wrapped=loop&&model.duration>0&&next>=model.duration;
 const result=seek(model,wrapped?next%model.duration:next);
 return {...result,ended:loop&&model.duration>0?false:result.ended,wrapped};
}
module.exports={TOLERANCE,cubicSegments,makeRoute,atLength,createPlayback,seek,advance};
