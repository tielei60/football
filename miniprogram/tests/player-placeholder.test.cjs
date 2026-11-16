const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { playerInitial } = require('../utils/player-initial');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
test('姓名占位去空白并保留完整扩展汉字，不推断身份', () => {
  for (const [name, expected] of [[' 匿名 ', '匿'], ['𠮷测试', '𠮷'], ['\u200b匿名', '匿'], ['', '球'], ['  ', '球'], [null, '球'], [12, '球'], ['\ud800', '球']])
    assert.equal(playerInitial(name), expected);
});
test('共享球员投影保持真实头像，失败回退只清展示头像不变姓名', () => {
  const module = {exports:{}};
  vm.runInNewContext(read('pages/shared.js'), {module, require: p => p.includes('player-initial') ? {playerInitial} : p.includes('media') ? {imageSource:v=>v} : {}, console});
  const s = module.exports;
  const p = s.playerView({id:1,name:'𠮷测试',avatar:'https://example.invalid/a.png'});
  assert.equal(p.initial,'𠮷');
  assert.equal(p.avatar,'https://example.invalid/a.png');
  assert.equal(p.numberDescription,'号码未设置');
  assert.equal(s.playerView({number:0}).numberDescription,'0 号');
  assert.equal(s.playerView({number:10}).numberDescription,'10 号');
  let patch;
  s.imageError.call({setData:v=>patch=v},{currentTarget:{dataset:{target:'player'}}});
  assert.deepEqual(JSON.parse(JSON.stringify(patch)),{'player.avatar':''});
  assert.equal(p.name,'𠮷测试');
});
test('管理姓名输入仅更新表单姓名与派生占位，忙碌时不变', () => {
  let page;
  let payload;
  const admin = {act:(_,run)=>run(),createRequest:(_,url,body)=>{payload=body;},input(e){if(!this.data.busy)this.setData({'form.name':e.detail.value});}};
  vm.runInNewContext(read('pages/manage-player/index.js'), {Page:d=>page=d, require:p=>p.includes('player-initial')?{playerInitial}:p.includes('admin')?admin:{}, console});
  const data = {form:{name:''},initial:'球',busy:false};
  const target = {data,setData(p){for(const [k,v] of Object.entries(p)){if(k==='form.name')data.form.name=v;else data[k]=v;}}};
  page.input.call(target,{currentTarget:{dataset:{field:'name'}},detail:{value:'𠮷测试'}});
  assert.equal(data.initial,'𠮷');
  assert.deepEqual(data.form,{name:'𠮷测试'});
  data.busy=true;
  page.input.call(target,{currentTarget:{dataset:{field:'name'}},detail:{value:'另外'}});
  assert.equal(data.initial,'𠮷');
  assert.equal(data.form.name,'𠮷测试');
  data.busy=false;
  Object.assign(data.form,{number:'',positions:['待定'],note:''});
  Object.assign(data,{status:'active',membershipConfirmed:false});
  page.save.call(target);
  assert.equal(payload.name,'𠮷测试');
  assert.equal(payload.number,null);
  assert.equal(payload.membershipConfirmed,false);
  assert.equal(Object.hasOwn(payload,'initial'),false);
  assert.equal(Object.hasOwn(payload,'avatar'),false);
});
test('五处球员头像统一占位，真图与队徽保持原显示协议', () => {
  for(const page of ['players','manage-players','player-detail','me','manage-player']) {
    const template=read(`pages/${page}/index.wxml`);
    assert.match(template,/player-placeholder/);
    assert.match(template,/mode="aspectFill"/);
    assert.match(template,/binderror="imageError"/);
  }
  for(const page of ['home','manage-team'])assert.doesNotMatch(read(`pages/${page}/index.wxml`),/player-placeholder/);
  const style=read('app.wxss').match(/\.avatar\.player-placeholder\s*\{([^}]+)\}/)[1];
  assert.doesNotMatch(style,/(?:^|;)\s*(?:width|height|padding|margin)\s*:/);
});
