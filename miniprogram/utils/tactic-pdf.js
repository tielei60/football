// One-page raster PDF, built entirely on-device from a Canvas JPEG.
// No fonts, links, scripts, external resources or metadata from the source tactic.
function jpegInfo(input){
 const b=input instanceof Uint8Array?input:new Uint8Array(input);
 if(b.length<4||b.length>8*1024*1024||b[0]!==255||b[1]!==216||b[b.length-2]!==255||b[b.length-1]!==217)throw new Error('Invalid JPEG export');
 let i=2;
 while(i+3<b.length){
  if(b[i++]!==255)break;while(b[i]===255)i++;
  const marker=b[i++];if(marker===0xda||marker===0xd9)break;
  if(marker===1||(marker>=0xd0&&marker<=0xd7))continue;
  const length=b[i]*256+b[i+1];if(length<2||i+length>b.length)break;
  if([0xc0,0xc1,0xc2].includes(marker)&&length>=8){
   const height=b[i+3]*256+b[i+4],width=b[i+5]*256+b[i+6],components=b[i+7];
   if(b[i+2]!==8||components!==3||width<1||height<1||width>8192||height>8192||width*height>16000000)throw new Error('Unsupported JPEG dimensions or color space');
   return {bytes:b,width,height};
  }i+=length;
 }
 throw new Error('JPEG frame header is missing');
}
function ascii(text){const result=new Uint8Array(text.length);for(let i=0;i<text.length;i++){if(text.charCodeAt(i)>127)throw new Error('PDF control text must be ASCII');result[i]=text.charCodeAt(i);}return result;}
function jpegToPdf(input){
 const {bytes,width,height}=jpegInfo(input),parts=[],offsets=[0];let length=0;
 const append=part=>{const b=typeof part==='string'?ascii(part):part;parts.push(b);length+=b.length;};
 const object=(id,text)=>{offsets[id]=length;append(id+' 0 obj\n'+text+'\nendobj\n');};
 append('%PDF-1.4\n');append(new Uint8Array([37,226,227,207,211,10]));
 object(1,'<< /Type /Catalog /Pages 2 0 R >>');
 object(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 object(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
 offsets[4]=length;append('4 0 obj\n<< /Type /XObject /Subtype /Image /Width '+width+' /Height '+height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+bytes.length+' >>\nstream\n');append(bytes);append('\nendstream\nendobj\n');
 const scale=Math.min(555.28/width,801.89/height),w=width*scale,h=height*scale;
 const commands='q\n'+w.toFixed(4)+' 0 0 '+h.toFixed(4)+' '+((595.28-w)/2).toFixed(4)+' '+((841.89-h)/2).toFixed(4)+' cm\n/Im0 Do\nQ\n';
 object(5,'<< /Length '+commands.length+' >>\nstream\n'+commands+'endstream');
 const xref=length;append('xref\n0 6\n0000000000 65535 f \n');
 for(let i=1;i<=5;i++)append(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 append('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
 const output=new Uint8Array(length);let at=0;for(const part of parts){output.set(part,at);at+=part.length;}return output.buffer;
}
module.exports={jpegInfo,jpegToPdf};
