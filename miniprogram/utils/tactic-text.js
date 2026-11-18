// 文字绘制与命中共用布局；坐标保持原战术模型，不写入任何测量结果。
function layout(marking) {
  const size=14+(marking.width||2)*4;
  return {size,font:`${size}px sans-serif`,lines:String(marking.label||'').split('\n').slice(0,20).map((text,index)=>({text,baseline:index*32}))};
}
function bounds(line,size,ctx) {
  if(!line.text.trim())return null;
  const fallback={left:0,right:Array.from(line.text).reduce((n,c)=>n+(/[\u0000-\u00ff]/.test(c)?size*.6:size),0),top:line.baseline-size*.8,bottom:line.baseline+size*.2};
  if(typeof ctx?.measureText!=='function')return fallback;
  const previous={font:ctx.font,textAlign:ctx.textAlign,textBaseline:ctx.textBaseline};
  try {
    ctx.font=`${size}px sans-serif`;ctx.textAlign='left';ctx.textBaseline='alphabetic';
    const m=ctx.measureText(line.text);
    if(!m||!Number.isFinite(m.width)||m.width<=0)return fallback;
    const vertical=Number.isFinite(m.actualBoundingBoxAscent)&&Number.isFinite(m.actualBoundingBoxDescent)&&m.actualBoundingBoxAscent+m.actualBoundingBoxDescent>0;
    const actual=Number.isFinite(m.actualBoundingBoxLeft)&&Number.isFinite(m.actualBoundingBoxRight)&&m.actualBoundingBoxRight+m.actualBoundingBoxLeft>0;
    return {left:actual?-m.actualBoundingBoxLeft:0,right:actual?m.actualBoundingBoxRight:m.width,
      top:line.baseline-(vertical?m.actualBoundingBoxAscent:size*.8),
      bottom:line.baseline+(vertical?m.actualBoundingBoxDescent:size*.2)};
  } catch (_) { return fallback; }
  finally {ctx.font=previous.font;ctx.textAlign=previous.textAlign;ctx.textBaseline=previous.textBaseline;}
}
function hit(marking,point,tolerance=30,ctx) {
  if(![marking.startX,marking.startY,point.x,point.y].every(Number.isFinite))return false;
  const {size,lines}=layout(marking),padding=Number.isFinite(tolerance)?Math.max(0,tolerance):0;
  // 画布文字相对球场旋转 -90°，点击先逆变换到文字局部坐标。
  const x=marking.startY-point.y,y=point.x-marking.startX;
  return lines.some(line=>{const b=bounds(line,size,ctx);return b&&x>=b.left-padding&&x<=b.right+padding&&y>=b.top-padding&&y<=b.bottom+padding;});
}
module.exports={layout,hit};
