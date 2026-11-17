// 原生 PNG 图标来自可维护的矢量几何；不引入图标库或真实照片。
const sharp = require('../../app/node_modules/sharp');
const path = require('node:path');
const shapes = {
  "schedule-shortcut": "<g transform=\"scale(2)\" stroke-width=\"1.7\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"3\"/><path d=\"M7 3v4m10-4v4M3 11h18M7 15h3m4 0h3m-10 3h3\"/></g>",
  "players-shortcut": "<g transform=\"scale(2)\" stroke-width=\"1.7\"><circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m3 10v-3a5 5 0 0 0-3-4\"/></g>",
  "statistics-shortcut": "<g transform=\"scale(2)\" stroke-width=\"1.7\"><rect x=\"3\" y=\"13\" width=\"4\" height=\"8\" rx=\"1\"/><rect x=\"10\" y=\"8\" width=\"4\" height=\"13\" rx=\"1\"/><rect x=\"17\" y=\"3\" width=\"4\" height=\"18\" rx=\"1\"/></g>",
  'tactics-shortcut': '<rect x="5" y="6" width="38" height="36" rx="4"/><path d="M24 6v36M5 16h8v16H5m38-16h-8v16h8"/><circle cx="24" cy="24" r="6"/>',
  'photos-shortcut': '<rect x="5" y="7" width="38" height="34" rx="5"/><circle cx="16" cy="18" r="4"/><path d="m6 35 11-10 8 8 8-11 9 13"/>',
};
(async()=>{for (const [name,shape] of Object.entries(shapes)) {
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="#760B88" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${shape}</svg>`;
 await sharp(Buffer.from(svg)).resize(144,144).png().toFile(path.join(__dirname,'../assets',name+'.png'));
}})().catch(error=>{console.error(error);process.exitCode=1;});
