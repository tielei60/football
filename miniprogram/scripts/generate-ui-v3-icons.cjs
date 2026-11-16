// 原生 PNG 图标来自可维护的矢量几何；不引入图标库或真实照片。
const sharp = require('../../app/node_modules/sharp');
const path = require('node:path');
const shapes = {
  'tactics-shortcut': '<rect x="5" y="6" width="38" height="36" rx="4"/><path d="M24 6v36M5 16h8v16H5m38-16h-8v16h8"/><circle cx="24" cy="24" r="6"/>',
  'photos-shortcut': '<rect x="5" y="7" width="38" height="34" rx="5"/><circle cx="16" cy="18" r="4"/><path d="m6 35 11-10 8 8 8-11 9 13"/>',
};
(async()=>{for (const [name,shape] of Object.entries(shapes)) {
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="#760B88" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
 await sharp(Buffer.from(svg)).resize(96,96).png().toFile(path.join(__dirname,'../assets',name+'.png'));
}})().catch(error=>{console.error(error);process.exitCode=1;});
