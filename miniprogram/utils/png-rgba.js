// PNG RGBA8：Filter 0 + zlib stored DEFLATE。仅内存，无复杂压缩。
const MAX_PIXELS=600*908;
function check(width,height,rgba){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>600||height>908||width*height>MAX_PIXELS)throw Error('尺寸超出预览上限');
  if(!rgba||!ArrayBuffer.isView(rgba)||rgba.BYTES_PER_ELEMENT!==1||rgba.length!==width*height*4)throw Error('RGBA 字节长度不符');
}
function crc(bytes,start,end){let c=0xffffffff;for(let i=start;i<end;i++){c^=bytes[i];for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function put32(bytes,offset,n){bytes[offset]=n>>>24;bytes[offset+1]=n>>>16;bytes[offset+2]=n>>>8;bytes[offset+3]=n;}
function encode(width,height,rgba){
  check(width,height,rgba);
  const stride=width*4,raw=new Uint8Array((stride+1)*height);
  for(let y=0;y<height;y++)raw.set(rgba.subarray(y*stride,(y+1)*stride),y*(stride+1)+1);
  const blocks=Math.ceil(raw.length/65535),z=new Uint8Array(2+raw.length+blocks*5+4);z[0]=0x78;z[1]=1;
  let offset=2,position=0,a=1,b=0;
  while(position<raw.length){const n=Math.min(65535,raw.length-position);z[offset++]=position+n===raw.length?1:0;z[offset++]=n&255;z[offset++]=n>>>8;z[offset++]=(~n)&255;z[offset++]=((~n)>>>8)&255;z.set(raw.subarray(position,position+n),offset);offset+=n;position+=n;}
  for(let i=0;i<raw.length;i++){a=(a+raw[i])%65521;b=(b+a)%65521;}put32(z,offset,((b<<16)|a)>>>0);
  const png=new Uint8Array(8+25+12+z.length+12);png.set([137,80,78,71,13,10,26,10]);let cursor=8;
  function chunk(type,data){put32(png,cursor,data.length);for(let i=0;i<4;i++)png[cursor+4+i]=type.charCodeAt(i);png.set(data,cursor+8);put32(png,cursor+8+data.length,crc(png,cursor+4,cursor+8+data.length));cursor+=12+data.length;}
  const header=new Uint8Array(13);put32(header,0,width);put32(header,4,height);header[8]=8;header[9]=6;
  chunk('IHDR',header);chunk('IDAT',z);chunk('IEND',new Uint8Array(0));return png;
}
module.exports={encode,MAX_PIXELS};
