const text=require('./tactic-text');
// Read-only renderer for the public Tactic.board contract. Never mutate the model.
const WIDTH = 1250, HEIGHT = 826;
// 纯显示主题；显式模型颜色始终保留，未知历史颜色不能当作默认色覆盖。
const THEME = Object.freeze({grass: ['#17684f','#1b7257'],line:'#d4eee5b3',home:'#8c249f',away:'#94c8dd',outline:'#f6eafa',text:'#ffffff',textShadow:'#052f24',marking:'#e3d4fa'});
const finite = value => typeof value === 'number' && Number.isFinite(value);
const color = (value, fallback) => typeof value === 'string' && /^(#[a-f0-9]{3,8}|[a-z]{3,20}|rgba?\([\d.,%\s]+\))$/i.test(value) ? value : fallback;
const list = value => Array.isArray(value) ? value : [];
function scene(board, stage = -1) {
  if (!board || !Array.isArray(board.pieces) || !Array.isArray(board.markings)) throw new Error('这份战术的画布格式暂不支持，请在网页端查看。');
  let pieces = board.pieces;
  if (stage >= 0) {
    const frame = list(board.demonstration?.stages)[stage];
    if (!frame) throw new Error('未找到该演示步骤。');
    const pool = new Map(list(board.demonstration?.participants).map(p => [p.pieceId, p]));
    pieces = list(frame.positions).map(p => pool.has(p.pieceId) ? { ...pool.get(p.pieceId), x: p.x, y: p.y } : null).filter(Boolean);
  }
  const markings = stage < 0 ? board.markings : [];
  if (pieces.length + markings.length > 5000 || markings.reduce((n,m)=>n+list(m.path).length,0)>100000) throw new Error('此战术内容过多，请使用网页端查看完整画布。');
  const supported = new Set(['line','arrow','rectangle','ellipse','pen','text']);
  const skipped = markings.filter(m => !supported.has(m.kind) || ![m.startX,m.startY,m.endX,m.endY].every(finite)).length + pieces.filter(p => String(p.label||'').length>16 || String(p.position||'').length>12).length + pieces.filter(p => !['player','ball'].includes(p.kind||'player') || !finite(p.x) || !finite(p.y)).length;
  return { pieces: pieces.filter(p => ['player','ball'].includes(p.kind||'player') && finite(p.x) && finite(p.y)), markings, skipped };
}
function draw(ctx, board, width, height, stage = -1) {
  const content = scene(board, stage);
  ctx.clearRect(0,0,width,height); ctx.save();
  const scale = Math.min(width/HEIGHT,height/WIDTH);
  ctx.translate((width-HEIGHT*scale)/2,(height-WIDTH*scale)/2); ctx.scale(scale,scale);
  ctx.translate(HEIGHT,0);ctx.rotate(Math.PI/2);
  for(let stripe=0;stripe<8;stripe++){ctx.fillStyle=THEME.grass[stripe%2];ctx.fillRect(stripe*WIDTH/8,0,WIDTH/8,HEIGHT);}
  ctx.strokeStyle=THEME.line;ctx.lineWidth=3;ctx.strokeRect(68,62,1115,701);
  ctx.beginPath();ctx.moveTo(625,62);ctx.lineTo(625,763);ctx.stroke();ctx.beginPath();ctx.arc(625,412,90,0,Math.PI*2);ctx.stroke();
  ctx.strokeRect(68,230,177,365);ctx.strokeRect(1006,230,177,365);ctx.strokeRect(68,320,65,185);ctx.strokeRect(1118,320,65,185);
  for(const m of content.markings) {
    if (![m.startX,m.startY,m.endX,m.endY].every(finite)) continue;
    ctx.save();ctx.strokeStyle=color(m.strokeColor||m.color,THEME.marking);ctx.fillStyle=color(m.backgroundColor,'transparent');ctx.lineWidth=finite(m.width)?Math.max(1,Math.min(50,m.width)):2;ctx.setLineDash(m.dashed?[12,8]:[]);
    const x=m.startX,y=m.startY,ex=m.endX,ey=m.endY,w=Math.abs(ex-x),h=Math.abs(ey-y);
    ctx.beginPath();
    if(m.kind==='line'||m.kind==='arrow'){ctx.moveTo(x,y);ctx.lineTo(ex,ey);ctx.stroke();if(m.kind==='arrow'){const a=Math.atan2(ey-y,ex-x);ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(ex-18*Math.cos(a-.45),ey-18*Math.sin(a-.45));ctx.lineTo(ex,ey);ctx.lineTo(ex-18*Math.cos(a+.45),ey-18*Math.sin(a+.45));ctx.stroke();}}
    else if(m.kind==='rectangle'){ctx.rect(Math.min(x,ex),Math.min(y,ey),w,h);ctx.fill();ctx.stroke();}
    else if(m.kind==='ellipse'&&w&&h){ctx.save();ctx.translate((x+ex)/2,(y+ey)/2);ctx.scale(w/2,h/2);ctx.arc(0,0,1,0,Math.PI*2);ctx.restore();ctx.fill();ctx.stroke();}
    else if(m.kind==='pen'){const points=list(m.path).filter(p=>Array.isArray(p)&&finite(p[0])&&finite(p[1]));points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();}
    else if(m.kind==='text'){ctx.fillStyle=ctx.strokeStyle;const layout=text.layout(m);ctx.font=layout.font;ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.translate(x,y);ctx.rotate(-Math.PI/2);layout.lines.forEach(line=>ctx.fillText(line.text,0,line.baseline));}
    ctx.restore();
  }
  for(const p of content.pieces){
    ctx.save();const ball=p.kind==='ball',away=p.team==='away',r=ball?12:(finite(p.radius)?Math.max(5,Math.min(100,p.radius)):24);
    ctx.fillStyle=ball?'#fff':color(p.color,away?THEME.away:THEME.home);
    ctx.strokeStyle=ball?THEME.textShadow:THEME.outline;ctx.lineWidth=ball?2:3;
    // 客队使用断续描边，即使自定义颜色与主队相同也不只靠颜色区分。
    ctx.setLineDash(!ball&&away?[5,4]:[]);ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([]);
    ctx.translate(p.x,p.y);ctx.rotate(-Math.PI/2);ctx.textAlign='center';ctx.textBaseline='middle';
    const text=(value,x,y)=>{ctx.strokeStyle=THEME.textShadow;ctx.lineWidth=3;ctx.strokeText(value,x,y);ctx.fillStyle=THEME.text;ctx.fillText(value,x,y);};
    ctx.font='bold 21px sans-serif';if(!ball)text(p.shirtNumber==null?'?':String(p.shirtNumber),0,0);
    ctx.font='bold 20px sans-serif';if(p.label)text(String(p.label).length>16?String(p.label).slice(0,15)+'…':String(p.label),0,-r-16);
    ctx.font='17px sans-serif';if(p.position)text(String(p.position).length>12?String(p.position).slice(0,11)+'…':String(p.position),0,r+18);
    ctx.restore();
  }
  ctx.restore();return { skipped:content.skipped,pieces:content.pieces.length };
}
// Clockwise portrait projection: screen=(HEIGHT-y,x). Stored Web coordinates stay unchanged.
function toScreen(x,y,width,height){const scale=Math.min(width/HEIGHT,height/WIDTH);return{x:(width-HEIGHT*scale)/2+(HEIGHT-y)*scale,y:(height-WIDTH*scale)/2+x*scale};}
function fromScreen(x,y,width,height){const scale=Math.min(width/HEIGHT,height/WIDTH);return{x:Math.max(0,Math.min(WIDTH,(y-(height-WIDTH*scale)/2)/scale)),y:Math.max(0,Math.min(HEIGHT,HEIGHT-(x-(width-HEIGHT*scale)/2)/scale))};}
// Do not clear the native bitmap on a scroll-only measurement. Explicitly reset
// the transform: native resize/commit timing must not determine touch scaling.
function prepareSurface(node,width,height,dpr=1){
  if(!node||![width,height,dpr].every(v=>Number.isFinite(v)&&v>0))throw Error('画布尺寸无效');
  const pixelWidth=Math.max(1,Math.round(width*dpr)),pixelHeight=Math.max(1,Math.round(height*dpr));
  if(node.width!==pixelWidth)node.width=pixelWidth;
  if(node.height!==pixelHeight)node.height=pixelHeight;
  const ctx=node.getContext('2d');
  if(typeof ctx.setTransform==='function')ctx.setTransform(dpr,0,0,dpr,0,0);
  else if(typeof ctx.resetTransform==='function'){ctx.resetTransform();ctx.scale(dpr,dpr);}
  else throw Error('当前微信不支持稳定的画布变换，请更新微信后重试。');
  return ctx;
}
module.exports={WIDTH,HEIGHT,scene,draw,toScreen,fromScreen,prepareSurface};
