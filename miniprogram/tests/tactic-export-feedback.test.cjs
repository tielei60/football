const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(format='PNG'){
 let definition,token='a';const calls=[];const wx={previewImage:o=>calls.push(['preview',o]),openDocument:o=>calls.push(['document',o]),saveFileToDisk:o=>calls.push(['save',o])};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../pages/tactic-export/index.js'),'utf8'),{Page:p=>definition=p,wx,require:p=>p==='../shared'?{api:{getSession:()=>({token})}}:{}});
 const page={...definition,data:{...definition.data,loading:false,ready:true,format},_owner:'a',_path:'/local/a.'+format.toLowerCase(),setData:p=>Object.assign(page.data,p)};
 return{page,wx,calls,setToken:t=>token=t};
}
test('PNG与PDF预览失败都有明确错误提示，取消不报失败',()=>{
 for(const format of ['PNG','PDF']){const h=setup(format);h.page.preview();const options=h.calls[0][1];assert.equal(typeof options.fail,'function');options.fail({errMsg:'preview:fail'});assert.match(h.page.data.actionError,/预览/);}
 const h=setup();h.page.preview();h.calls[0][1].fail({errMsg:'previewImage:fail cancel'});assert.equal(h.page.data.actionError,'');
});
test('旧文件或旧账号的预览和另存回调不覆盖新结果',()=>{
 for(const format of ['PNG','PDF'])for(const method of ['preview','saveLocal'])for(const change of ['path','owner','unload']){
  const h=setup(format);h.page[method]();const options=h.calls[0][1];if(change==='path')h.page._path='/local/new';if(change==='owner')h.setToken('b');if(change==='unload')h.page._disposed=true;
  h.page.setData({actionError:'新状态',message:'新文件'});options.fail?.({errMsg:'failed'});options.success?.();assert.equal(h.page.data.actionError,'新状态');assert.equal(h.page.data.message,'新文件');
 }
});
test('系统预览临时隐藏不误丢同一文件的另存结果',()=>{
 const h=setup();h.page.saveLocal();h.page._hidden=true;h.calls[0][1].success();assert.equal(h.page.data.message,'已完成系统保存。');
});
test('同步不支持或抛错显示可恢复反馈，不冒充保存成功',()=>{
 for(const method of ['preview','saveLocal']){const h=setup();h.wx[method==='preview'?'previewImage':'saveFileToDisk']=()=>{throw Error('native failure');};assert.doesNotThrow(()=>h.page[method]());assert.ok(h.page.data.actionError);assert.notEqual(h.page.data.message,'已完成系统保存。');}
});
test('当前操作成功可清理旧失败提示，保存取消静默且不宣称成功',()=>{
 const h=setup();h.page.data.actionError='旧错误';h.page.preview();assert.equal(h.page.data.actionError,'');
 h.page.saveLocal();h.calls[1][1].fail({errMsg:'save:fail cancel'});assert.equal(h.page.data.message,'');
 h.page.saveLocal();h.calls[2][1].success();assert.equal(h.page.data.message,'已完成系统保存。');
});
