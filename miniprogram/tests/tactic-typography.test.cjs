// 静态保护不代替专注画布矩形、键盘或真实视觉验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const baseline=require('./tactic-typography-baseline.json'),root=path.resolve(__dirname,'../pages');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const read=(n,e)=>fs.readFileSync(path.join(root,n,'index.'+e),'utf8');
const marker='\n/* 战术文字层级：';
test('six tactic pages retain all nonclass template content and JavaScript',()=>{for(const[n,b]of Object.entries(baseline)){assert.equal(hash(read(n,'wxml').replace(/<button wx:if="{{canManage}}" disabled="{{loading}}" id="new-tactic" bindtap="create" class="primary ui-button ui-block section" size="mini">新建战术<\/button>/g,'').replace(/\sclass="[^"]*"/g,'')),b.wxml,n);assert.equal(hash(read(n,'js').replace('create(){if(this.matchId||!this.data.canManage||this.data.loading||this.data.error)return;wx.navigateTo({url:"/pages/tactic-create/index"});},\n','')),b.js,n);}});
test('original CSS remains byte-identical and new rules only adjust text',()=>{for(const[n,b]of Object.entries(baseline)){const css=read(n,'wxss'),i=css.indexOf(marker);assert.ok(i>=0,n);assert.equal(hash(css.slice(0,i)),b.css,n);const extra=css.slice(i);for(const body of extra.matchAll(/\{([^{}]*)\}/g)){for(const d of body[1].split(';').filter(Boolean)){assert.match(d.trim(),/^(font-size|font-weight|color|line-height):/,n+': '+d);}}assert.doesNotMatch(extra,/\b(?:input|textarea|canvas|button|slider)\b/);}});
test('focused board compose and setup receive no typography overrides',()=>{for(const n of ['tactic-board','tactic-compose','tactic-setup']){const extra=read(n,'wxss').split(marker)[1].split('*/').slice(1).join('*/');assert.doesNotMatch(extra,/canvas-focus|preview-focus|playback-controls|editor-tools|selection-status/);for(const m of extra.matchAll(/([^{}]+)\{[^{}]*\}/g)){const selectors=m[1].trim();if(selectors.startsWith('@'))continue;for(const selector of selectors.split(','))assert.ok(selector.trim().startsWith('.type-expanded '),n+': '+selector);}}
assert.match(read('tactic-board','wxml'),/editing\|\|focusCanvas\?'canvas-focus':'type-expanded'/);
assert.match(read('tactic-compose','wxml'),/focusCanvas&&tab===0\?'canvas-focus':'type-expanded'/);
assert.match(read('tactic-setup','wxml'),/previewFocus\?'preview-focus':'type-expanded'/);
});
test('scope and import warnings remain separate from ordinary hints',()=>{assert.match(read('tactic-compose','wxml'),/hint scope-warning/);assert.match(read('tactic-setup','wxml'),/hint formation-impact/);assert.match(read('tactic-transfer','wxss'),/\.warning\{font-size:26rpx;font-weight:500;color:var\(--danger\)\}/);assert.match(read('tactic-export','wxml'),/hint export-ready/);});
