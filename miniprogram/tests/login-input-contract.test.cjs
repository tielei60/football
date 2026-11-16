// 输入逻辑和遮罩契约；不能替代开发工具/真机实际焦点复现。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
test('账号输入只更新原账号值，能力加载不清空输入或单独禁用账号',async()=>{
 let definition;const calls=[];
 vm.runInNewContext(read('pages/login/index.js'),{Page:d=>definition=d,require:()=>({api:{capabilities:async()=>{calls.push('capabilities');return {wechat:false};}}})});
 const page={...definition,data:structuredClone(definition.data),setData(p){Object.assign(this.data,p);}};
 page.username({detail:{value:'ui-input-test'}});
 assert.equal(page.data.username,'ui-input-test');assert.equal(page.data.busy,false);assert.deepEqual(calls,[]);
 await page.loadCapabilities();assert.equal(page.data.username,'ui-input-test');assert.equal(page.data.busy,false);assert.deepEqual(calls,['capabilities']);
 page.username({detail:{value:''}});assert.equal(page.data.username,'');
});
test('账号和密码共用可编辑原生输入尺寸与忙碌条件，装饰遮罩不接管触摸',()=>{
 const w=read('pages/login/index.wxml'),inputs=[...w.matchAll(/<input\b[^>]+>/g)].map(m=>m[0]);
 assert.equal(inputs.length,2);
 for(const tag of inputs){assert.match(tag,/class="input"/);assert.match(tag,/disabled="{{busy}}"/);assert.doesNotMatch(tag,/\b(?:focus|catchtap|catchtouchstart|bindfocus|bindblur)=/);}
 assert.match(inputs[0],/bindinput="username"/);assert.match(inputs[1],/bindinput="password"/);
 assert.doesNotMatch(inputs[0],/\bpassword(?:\s|>)/);
 const css=read('pages/login/index.wxss');
 assert.match(css,/\.login-atmosphere,\.login-shade\s*\{[^}]*pointer-events:none/);
 assert.match(css,/\.login-art\s*\{\s*overflow:hidden/);
});
