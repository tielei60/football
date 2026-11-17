// 图标为装饰；浏览器盒模型检查不替代微信原生触控验收。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('战术图标保留原选择值/播放状态，无独立事件，资源本地可用',()=>{
 const b=read('pages/tactic-board/index.wxml'),c=read('pages/tactic-compose/index.wxml');
 for(const s of [b,c])for(const m of s.matchAll(/<image class="tactic-control-icon[^>]*>/g)){assert.match(m[0],/aria-hidden="true"/);assert.doesNotMatch(m[0],/bind|catch|wx:if/);}
 assert.ok(b.includes('/assets/ui-v3-{{playing?\'pause\':\'play\'}}.png'));assert.ok(b.includes('<text class="picker-value">{{tools[toolIndex]}}</text>'));
 assert.equal((b.match(/ui-v3-undo.png/g)||[]).length,1);assert.equal((c.match(/ui-v3-undo.png/g)||[]).length,1);
 for(const n of ['edit','undo','play','pause']){const png=fs.readFileSync(path.join(root,'assets/ui-v3-'+n+'.png'));assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),64);assert.equal(png.readUInt32BE(20),64);}
 assert.doesNotMatch(read('pages/tactic-export/index.wxml'),/tactic-control-icon/);
});
test('320/375/430工具和播放图标不挤压44px按钮，窄屏保留文字与当前工具',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430]){const page=await browser.newPage({viewport:{width,height:900}}),css=(read('app.wxss')+'\n'+read('pages/tactic-board/index.wxss')).replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px');
 await page.setContent('<style>body{margin:0}text,business-picker{display:block}'+css+'</style><div class="page canvas-focus"><div class="editor-tools"><business-picker><div class="picker"><img class="tactic-control-icon tool-icon"><text class="picker-value">移动球员/球</text></div></business-picker><button class="small" id="editor-undo"><img class="tactic-control-icon undo-icon">撤销</button><button class="small">重做</button><button class="small">属性</button></div><div class="row playback-controls"><button class="small" id="playback-toggle"><img class="tactic-control-icon playback-icon">播放演示</button><div class="grow"></div><text>0 / 12 秒</text></div></div>');
 const rs=await page.locator('.editor-tools button,.editor-tools .picker,#playback-toggle').evaluateAll(xs=>xs.map(x=>({w:x.getBoundingClientRect().width,h:x.getBoundingClientRect().height,right:x.getBoundingClientRect().right,overflow:x.scrollWidth>x.clientWidth+1})));
 for(const r of rs){assert.ok(r.w>=44&&r.h>=44,JSON.stringify({width,r}));assert.ok(r.right<=width+1&&!r.overflow,JSON.stringify({width,r}));}
 if(width===320)assert.equal(await page.locator('.tool-icon').evaluate(x=>getComputedStyle(x).display),'none');await page.close();}}
 finally{await browser.close();}
});
