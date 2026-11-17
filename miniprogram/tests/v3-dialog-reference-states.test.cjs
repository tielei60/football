const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),file='components/business-dialog/index.wxml',read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('选择面板专用外壳，普通确认和密码输入不改位置；业务事件和禁用保持',()=>{
 const now=read(file),before=cp.execFileSync('git',['show','HEAD:miniprogram/'+file],{cwd:root,encoding:'utf8'});
 const bindings=s=>[...s.matchAll(/\b(?:bind[\w:]*|catch[\w:]*|disabled|value|password|focus|data-[\w-]+)="[^"]*"/g)].map(x=>x[0]);
 assert.deepEqual(bindings(now),bindings(before));assert.match(now,/modal.kind==='picker'\?'picker-sheet-layer'/);assert.match(now,/modal.kind==='picker'\?'picker-dialog picker-sheet'/);assert.match(now,/class="sheet-handle" aria-hidden="true"/);assert.match(now,/wx:if="\{\{modal.kind!=='picker'\}\}" class="eyebrow"/);
 const js=read('components/business-dialog/index.js'),normalized=require('./v3-dialog-projection-normalize.cjs')(js);assert.equal(require('node:crypto').createHash('sha256').update(normalized).digest('hex'),require('./ui-v3-core-contract.json').immutable['components/business-dialog/index.js']);
});
test('官方模板能编译全部面板与危险确认',()=>{
 const {wxmlToJs}=require('miniprogram-compiler'),gwx=new Function('window',wxmlToJs(root))({});
 for(const mode of ['selector','date','time']){const tree=gwx(file)({modal:{kind:'picker',title:'选择',showCancel:true,pickerState:{mode,rows:[],hours:[],minutes:[],days:[],weekdays:[],valid:true}},bodyHeight:300});assert.ok(JSON.stringify(tree).includes('picker-sheet'));}
 const tree=gwx(file)({modal:{kind:'confirm',title:'归档这位球员？',danger:true,showCancel:true},bodyHeight:160});assert.ok(JSON.stringify(tree).includes('danger'));
});
test('三宽贴底安全区、选项与危险按钮实际样式',async()=>{
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{for(const width of [320,375,430]){const page=await browser.newPage({viewport:{width,height:850}});const css=read('components/business-dialog/index.wxss').replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px');
 await page.setContent(`<style>body{margin:0}${css}</style><div class="dialog-layer picker-sheet-layer selector-layer"><div class="dialog picker-dialog picker-sheet selector-dialog"><div class="sheet-handle"></div><div class="heading">选择球场</div><div class="body-scroll" style="height:180px"><div class="picker-panel"><div class="option-list"><button class="dialog-control option">很长的球场名称与地址</button><button class="dialog-control option selected">已选择</button></div></div></div><div class="buttons two"><button class="dialog-control cancel">取消</button><button class="dialog-control confirm danger">确认归档</button></div></div></div>`);
 const r=await page.locator('.picker-sheet').boundingBox();assert.ok(Math.abs(r.x)<1&&Math.abs(r.width-width)<1&&Math.abs(r.y+r.height-850)<1);
 for(const cls of ['cancel','confirm'])assert.ok((await page.locator('.'+cls).boundingBox()).height>=44);
 assert.equal(await page.locator('.danger').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 240, 244)');assert.equal(await page.locator('.cancel').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');assert.equal(await page.locator('.option:not(.selected)').evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');await page.close();}}
 finally{await browser.close()}
});
test('眉题归一化只限定装饰节点且不替换原业务基线',()=>{
 const contract=read('tests/ui-depth.test.cjs');assert.ok(contract.includes("if(p==='components/business-dialog/index.wxml')"));assert.ok(contract.includes("source.split(eyebrow).length-1,1"));
 assert.match(read(file),/wx:if="\{\{modal.kind!=='picker'\}\}" class="eyebrow"/);
 assert.equal(cp.execFileSync('git',['diff','--','miniprogram/tests/ui-v3-core-contract.json'],{cwd:path.resolve(root,'..'),encoding:'utf8'}),'');
});
test('时间两列透明灰字与浅紫选中态，保留分钟循环和点击',async()=>{
 assert.match(read(file),/wx:for="\{\{modal.pickerState.minutes\}\}"/);assert.match(read(file),/bindtap="pickerOption"/);
 const {chromium}=require('../../app/node_modules/playwright'),browser=await chromium.launch({headless:true});
 try{const page=await browser.newPage({viewport:{width:375,height:850}}),css=read('components/business-dialog/index.wxss').replace(/([\d.]+)rpx/g,(_,n)=>Number(n)/2+'px');
 await page.setContent(`<style>${css}</style><div class="dialog picker-sheet"><div class="picker-panel"><div class="time-columns"><div class="time-scroll"><button class="dialog-control option time-option">17</button><button class="dialog-control option time-option selected">19</button></div><div class="time-scroll"><button class="dialog-control option time-option selected">30</button></div></div></div></div>`);
 const styles=await page.locator('.time-option').evaluateAll(xs=>xs.map(x=>{const s=getComputedStyle(x);return [s.backgroundColor,s.color,x.getBoundingClientRect().height,s.textAlign]}));
 assert.equal(styles[0][0],'rgba(0, 0, 0, 0)');assert.equal(styles[0][1],'rgb(110, 97, 122)');for(const s of styles.slice(1)){assert.equal(s[0],'rgb(240, 230, 250)');assert.equal(s[1],'rgb(97, 4, 111)')}for(const s of styles){assert.ok(s[2]>=44);assert.equal(s[3],'center');}
 }finally{await browser.close()}
});
