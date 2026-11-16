// 展示语义契约，不代替真实角色/搜索交互验证。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'../pages/manage-players');
test('球员管理区分筛选无结果与三种成员空分组，账号状态保留文字且不等于成员确认',()=>{
 const w=fs.readFileSync(base+'/index.wxml','utf8'),css=fs.readFileSync(base+'/index.wxss','utf8');
 for(const s of ['当前筛选下没有球员','暂无在队球员','暂无已归档球员','暂无待确认球员'])assert.ok(w.includes(s));
 assert.match(w,/wx:if="{{!visible.length}}" class="empty"/);
 assert.match(w,/account-status {{item.hasAccount\?'account-ready':'account-pending'}}/);
 assert.match(w,/{{item.hasAccount\?'已开通':'未开通'}}账号/);
 assert.match(css,/\.account-status\.account-ready\{color:var\(--success\);background:var\(--success-soft\)/);
 assert.match(css,/\.account-status\.account-pending\{color:var\(--muted\);background:var\(--brand-soft\)/);
 for(const handler of ['create','edit','search','status'])assert.ok(w.includes('bindtap="'+handler+'"')||w.includes('bindinput="'+handler+'"'));
});

test('有效搜索展示与真实过滤一致：三种分组区分纯空白和查询，不修改用户输入',()=>{
 const vm=require('node:vm');let def;
 vm.runInNewContext(fs.readFileSync(base+'/index.js','utf8'),{Page:d=>def=d,require:()=>({s:{imageError(){}}})});
 for(const status of ['active','inactive','unconfirmed'])for(const query of ['', '   ', '7', '队员']){
  const p={...def,data:{...def.data,status,players:[]},setData(v){Object.assign(this.data,v);}};
  p.search({detail:{value:query}});
  assert.equal(p.data.search,query);assert.equal(p.data.searchHasText,query.trim().length>0);assert.equal(p.data.visible.length,0);
  const expected=query.trim()?'当前筛选下没有球员':status==='inactive'?'暂无已归档球员':status==='unconfirmed'?'暂无待确认球员':'暂无在队球员';
  const template=fs.readFileSync(base+'/index.wxml','utf8'),expression=template.match(/class="empty-title">{{([^}]+)}}/)[1];
  assert.equal(vm.runInNewContext(expression,p.data),expected);
 }
});
