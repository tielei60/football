const test=require('node:test');const assert=require('node:assert/strict');
const p=require('../utils/tactic-playback');
const position=(pieceId,x,y)=>({pieceId,x,y});
const demo={participants:[{pieceId:'a',kind:'player',shirtNumber:0},{pieceId:'b',kind:'ball'}],stages:[{durationSeconds:30,positions:[position('a',0,0),position('b',0,10)]},{durationSeconds:2,positions:[position('a',100,0),position('b',100,10)]},{durationSeconds:4,positions:[position('a',100,100)]}],runs:[]};
test('Web target-stage duration, keyframes and final bounds',()=>{
 const m=p.createPlayback(demo);assert.equal(m.duration,6);
 assert.equal(p.seek(m,0).stageIndex,0);assert.equal(p.seek(m,0).progress,1);
 assert.equal(p.seek(m,2).stageIndex,1);assert.equal(p.seek(m,2).progress,1);
 assert.equal(p.seek(m,2.1).stageIndex,2);assert.equal(p.seek(m,1).pieces[0].x,50);
 for(const t of [6,7,1e6]){const s=p.seek(m,t);assert.equal(s.stageIndex,2);assert.equal(s.progress,1);assert.equal(s.pieces[0].y,100);assert.equal(s.ended,true);}
 assert.equal(p.seek(m,-1).time,0);assert.equal(p.seek(m,NaN).time,0);
});
test('loop consumes remainder including exact boundary, speed and negative ticks',()=>{
 const m=p.createPlayback(demo);
 assert.equal(p.advance(m,5,2,{loop:true}).time,1);
 assert.equal(p.advance(m,5,1,{loop:true}).time,0);
 assert.equal(p.advance(m,0,13,{loop:true}).time,1);
 assert.equal(p.advance(m,0,1,{speed:2}).time,2);
 assert.equal(p.advance(m,3,-1).time,3);
 assert.equal(p.advance(m,5,2).ended,true);
});
test('participants enter/leave exactly as Web destination frame pool',()=>{
 const d={participants:[{pieceId:1,kind:'ball'},{pieceId:'1',kind:'player'}],stages:[{positions:[position(1,0,0)]},{positions:[position('1',90,0),position('missing',4,4)]}],runs:[]};
 const m=p.createPlayback(d);assert.equal(m.skipped,1);
 const out=p.seek(m,1);assert.equal(out.pieces.length,1);assert.equal(out.pieces[0].pieceId,'1');assert.equal(out.pieces[0].x,90);
});
test('empty/single/degenerate stages have finite stable outputs',()=>{
 assert.equal(p.seek(p.createPlayback(),10).stageIndex,-1);
 const m=p.createPlayback({participants:[{pieceId:'a'}],stages:[{positions:[position('a',5,5)]}]});
 assert.equal(p.advance(m,0,4,{loop:true}).ended,true);
 const route=p.makeRoute({x:2,y:3},{x:2,y:3},{x:2,y:3});assert.deepEqual(p.atLength(route,.5),{x:2,y:3});
 const invalid=p.createPlayback({stages:[{},null,{durationSeconds:Infinity},{durationSeconds:0},{durationSeconds:100}]});
 assert.equal(invalid.duration,36.5);
});
test('Web exact Catmull-Rom cubic controls and first run win',()=>{
 const c=p.cubicSegments([{x:0,y:0},{x:30,y:60},{x:90,y:0}]);
 assert.deepEqual(c[0],[{x:0,y:0},{x:5,y:10},{x:15,y:60},{x:30,y:60}]);
 assert.deepEqual(c[1],[{x:30,y:60},{x:45,y:60},{x:80,y:10},{x:90,y:0}]);
 const d=structuredClone(demo);d.runs=[{pieceId:'a',fromStage:0,bend:{x:50,y:100}},{pieceId:'a',fromStage:0,bend:{x:50,y:-100}}];
 assert.ok(p.seek(p.createPlayback(d),1).pieces[0].y>90);
});
// Independent uniform Bernstein evaluation at 20000 samples/segment serves as
// numeric reference, not a browser-SVG claim. Max permitted difference .02 units.
function dense(points){
 const samples=[{...points[0],length:0}];let length=0;
 for(let i=0;i<points.length-1;i++){
 const a=points[i],z=points[i+1],prev=points[i-1]||a,next=points[i+2]||z;
 const b={x:a.x+(z.x-prev.x)/6,y:a.y+(z.y-prev.y)/6},c={x:z.x-(next.x-a.x)/6,y:z.y-(next.y-a.y)/6};
 for(let j=1;j<=20000;j++){const t=j/20000,u=1-t;const q={x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*z.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*z.y};const old=samples[samples.length-1];length+=Math.hypot(q.x-old.x,q.y-old.y);samples.push({...q,length});}
 }return {samples,length};
}
test('arc-length samples agree with dense Bernstein oracle within .02 canonical units',()=>{
 const cases=[[[0,0],[500,800],[1200,0]],[[0,0],[0,800],[1200,800]],[[50,50],[1200,0],[50,50]],[[0,0],[900,0],[30,0]],[[1250,826],[0,0],[600,400]]];
 for(const coords of cases){const points=coords.map(([x,y])=>({x,y})),actual=p.makeRoute(...points),oracle=dense(points);
 for(let i=0;i<=100;i++){const a=p.atLength(actual,i/100),b=p.atLength(oracle,i/100);assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.02,JSON.stringify({coords,i,a,b}));}
 assert.ok(Math.abs(actual.length-oracle.length)<.02);
 }
});
test('sampling is pure and never mutates source or shared returned pieces',()=>{
 const copy=structuredClone(demo),m=p.createPlayback(demo);const a=p.seek(m,1);a.pieces[0].x=999;
 assert.equal(p.seek(m,1).pieces[0].x,50);assert.deepEqual(demo,copy);
});
test('malformed coordinates skip missing participants and unsafe curves reject',()=>{
 const d=structuredClone(demo);d.stages[1].positions.push(position('a',NaN,2));
 assert.equal(p.createPlayback(d).skipped,1);
 assert.throws(()=>p.makeRoute({x:Infinity,y:0},{x:0,y:0},{x:1,y:1}));
 assert.throws(()=>p.createPlayback({stages:Array(121).fill({})}));
});
