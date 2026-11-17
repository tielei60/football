// 只读摘取用户V3原型ICONS中的纯几何；不执行原型代码、不包含人员照片。
const sharp=require('../../app/node_modules/sharp'),path=require('node:path');
const shapes={
  "edit": '<path d="m4 16 12-12 4 4L8 20H4Zm9-9 4 4"/>',
  "undo": '<path d="M4 10h9a7 7 0 0 1 0 14M4 10l5-5M4 10l5 5" transform="translate(0 -3)"/>',
  "play": '<path d="m8 4 13 8-13 8Z"/>',
  "pause": '<path d="M8 4v16m8-16v16"/>',
  "people": "<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a5 5 0 0 0-3-4\"/>",
  "trophy": "<path d=\"M7 3h10v7a5 5 0 0 1-10 0ZM7 5H3v4a4 4 0 0 0 4 4m10-8h4v4a4 4 0 0 1-4 4m-5 2v5m-4 1h8\"/>",
  "shield": "<path d=\"m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z\"/><path d=\"m8 12 3 3 5-6\"/>",
  "calendar": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"3\"/><path d=\"M7 3v4m10-4v4M3 11h18M7 15h3m4 0h3m-10 3h3\"/>",
  "pin": "<path d=\"M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z\"/><circle cx=\"12\" cy=\"10\" r=\"2.5\"/>",
  "lock": "<rect x=\"5\" y=\"10\" width=\"14\" height=\"11\" rx=\"2\"/><path d=\"M8 10V7a4 4 0 0 1 8 0v3m-4 5v2\"/>"
};
(async()=>{for(const [name,shape]of Object.entries(shapes)){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#760b88" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
 await sharp(Buffer.from(svg)).resize(64,64).png().toFile(path.join(__dirname,'../assets/ui-v3-'+name+'.png'));
}})().catch(e=>{console.error(e);process.exitCode=1;});
