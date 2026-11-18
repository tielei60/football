// CSS级联的浏览器布局回归，不代替微信原生按钮与真机实测。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const markup=fs.readFileSync(path.join(root,'pages/player-photos/index.wxml'),'utf8');
function group(name){const m=markup.match(new RegExp('<view wx:if="{{admin}}" class="'+name+'">([\\s\\S]*?)</view>'));assert.ok(m,name);return m[1];}
test('photo actions preserve all five original handlers in V3 three/two groups',()=>{
 assert.deepEqual([...group('photo-actions-main').matchAll(/bindtap="([^"]+)"/g)].map(m=>m[1]),['saveCaption','cover','remove']);
 assert.deepEqual([...group('photo-actions-secondary').matchAll(/bindtap="([^"]+)"/g)].map(m=>m[1]),['move','move']);
 for(const name of ['photo-actions-main','photo-actions-secondary'])for(const button of group(name).matchAll(/<button[^>]+>/g)){assert.match(button[0],/disabled="/);assert.match(button[0],/data-id="{{item.id}}"/);}
 assert.doesNotMatch(markup,/class="actions"/);
});
test('merged global and page CSS renders separate equal-width 44px action rows at 320/375/430',async t=>{
 let chromium;try{({chromium}=require('../../app/node_modules/playwright'));}catch(e){if(e.code==='MODULE_NOT_FOUND'){if(process.env.CI)throw e;t.skip('未安装Web布局测试依赖；不能作为布局通过证据');return;}throw e;}
 let browser;try{browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});}catch(e){if(/Executable doesn't exist/.test(e.message)){if(process.env.CI)throw e;t.skip('未安装Chromium；仅跳过浏览器布局，不声称微信已测');return;}throw e;}
 try{for(const width of [320,375,430]){
 const page=await browser.newPage({viewport:{width,height:900}});
 const source=fs.readFileSync(path.join(root,'app.wxss'),'utf8')+'\n'+fs.readFileSync(path.join(root,'pages/player-photos/index.wxss'),'utf8');
 const css=source.replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
 const html=name=>'<div class="'+name+'">'+group(name).replace(/disabled="[^"]*"/g,'')+'</div>';
 await page.setContent('<style>body{margin:0}'+css+'</style><div class="page"><div class="card">'+html('photo-actions-main')+html('photo-actions-secondary')+'</div></div>');
 const rows=await page.evaluate(()=>['photo-actions-main','photo-actions-secondary'].map(name=>[...document.querySelectorAll('.'+name+' button')].map(b=>{const r=b.getBoundingClientRect(),c=getComputedStyle(b);return {x:r.x,y:r.y,width:r.width,height:r.height,font:parseFloat(c.fontSize),padding:parseFloat(c.paddingLeft)+parseFloat(c.paddingRight),length:b.textContent.length};})));
 assert.equal(rows[0].length,3);assert.equal(rows[1].length,2);assert.ok(rows[1][0].y>=rows[0][0].y+rows[0][0].height,width+' distinct rows');
 for(const row of rows)for(const b of row){assert.ok(b.height>=44,width+' touch floor');assert.ok(b.x>=0&&b.x+b.width<=width,width+' no overflow');assert.ok(Math.abs(b.width-row[0].width)<1,width+' equal columns');assert.equal(b.y,row[0].y);assert.ok(b.width-b.padding>=b.length*b.font,width+' label fits without forced wrapping');}
 await page.close();
 }}finally{await browser.close();}
});
