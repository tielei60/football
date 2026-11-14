const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
function rules(file,selector){const css=fs.readFileSync(path.join(root,file),'utf8').replace(/\/\*[\s\S]*?\*\//g,''),out={};for(const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){if(m[1].trim()!==selector)continue;for(const entry of m[2].split(';')){const [key,value]=entry.split(':');if(value)out[key.trim()]=value.trim();}}return out;}
test('native single-line caret uses zero vertical padding in all six style scopes',()=>{
 for(const [file,selector]of [['app.wxss','input.input'],['pages/season-roster/index.wxss','.number input'],['pages/tactic-compose/index.wxss','input'],['pages/tactic-board/index.wxss','.properties input'],['pages/tactic-setup/index.wxss','.card input'],['components/business-dialog/index.wxss','.dialog-input']]){
  const r={...(file==='pages/season-roster/index.wxss'?rules('app.wxss','input.input'):{}),...rules(file,selector)},parts=r.padding.split(/\s+/).map(parseFloat),top=parts[0],bottom=parts.length>2?parts[2]:parts[0];
  assert.equal(top,0,file+' top padding must not shift native caret');assert.equal(bottom,0,file+' bottom padding must not shift native caret');
  assert.ok(Number.isFinite(parseFloat(r.height))&&parseFloat(r.height)>0,file+' explicit touchable height');
  assert.ok(!selector.includes('textarea'),'multiline controls have separate native geometry');
 }
});
test('multiline controls retain distinct textarea geometry and are not subjected to input-only rules',()=>{
 const app=fs.readFileSync(path.join(root,'app.wxss'),'utf8');assert.doesNotMatch(app,/input\.input\s*,\s*textarea\s*\{/);
 const files=['pages/manage-player/index.wxml','pages/match-edit/index.wxml','pages/match-media/index.wxml','pages/tactic-setup/index.wxml'];
 for(const file of files){const source=fs.readFileSync(path.join(root,file),'utf8');assert.match(source,/<textarea\b[^>]*value=/,file);}
 assert.match(fs.readFileSync(path.join(root,'pages/tactic-setup/index.wxml'),'utf8'),/<textarea\b[^>]*auto-height/);
});
test('page-state loading error empty precedence and all 26 page hosts remain intact',()=>{const state=fs.readFileSync(path.join(root,'components/page-state/index.wxml'),'utf8');assert.match(state,/wx:if="{{loading}}"/);assert.match(state,/wx:elif="{{error}}"/);assert.match(state,/wx:elif="{{empty}}"/);const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8'));assert.equal(app.pages.length,26);for(const page of app.pages){const source=fs.readFileSync(path.join(root,page+'.wxml'),'utf8');assert.equal((source.match(/<business-dialog\b/g)||[]).length,1,page);if(!page.includes('/login/'))assert.match(source,/<page-state\b[^>]*loading="{{loading}}"[^>]*error="{{error}}"/);}});
