const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('我的身份卡装饰队徽不拦截触摸且不取代头像或号码',()=>{
 const w=read('pages/me/index.wxml'),css=read('pages/me/index.wxss');
 assert.match(w,/<image class="membership-watermark" src="\/assets\/team-badge.png" mode="aspectFit" aria-hidden="true"\/>/);
 assert.match(w,/src="{{player.avatar}}"/);assert.match(w,/binderror="imageError"/);assert.match(w,/{{player.number}}/);
 assert.match(css,/\.membership-watermark\{[^}]*opacity:\.08;[^}]*pointer-events:none;[^}]*z-index:0/);
 assert.match(css,/\.membership-hero>\.avatar,\.membership-hero>\.grow,\.membership-hero>\.member-shirt\{[^}]*z-index:1/);
});
test('修改密码持续标签与原密码绑定、忙碌保护及长度范围提示共存',()=>{
 const w=read('pages/me/index.wxml');
 for(const [field,label] of [['currentPassword','当前密码'],['newPassword','新密码']]){
  const pair=w.match(new RegExp('<text class="field-label">'+label+'</text><input[\\s\\S]*?/>'));
  assert.ok(pair,label+'持续标签存在');const tag=pair[0];
  assert.ok(tag.includes('value="{{'+field+'}}"'));assert.ok(tag.includes('data-field="'+field+'"'));
  assert.ok(tag.includes('disabled="{{loading || (busy)}}"'));assert.ok(tag.includes('bindinput="input"'));
  assert.match(tag,/\bpassword\s/);assert.ok(tag.includes('maxlength="'+(field==='newPassword'?200:256)+'"'));
 }
 assert.match(w,/placeholder="新密码，10–200个字符"/);assert.match(w,/bindtap="changePassword"/);
});

test('球队与账号菜单保留原入口、条件、错误和退出确认而不扩认证',()=>{
 const w=read('pages/me/index.wxml'),js=read('pages/me/index.js');
 const section=w.indexOf('class="section account-section"'),tactics=w.indexOf('bindtap="tactics"',section),password=w.indexOf('bindtap="togglePassword"',section),logout=w.indexOf('bindtap="logout"',section);
 assert.ok(section>=0&&tactics>section&&password>tactics&&logout>password);
 assert.match(w.slice(section),/球队与账号/);assert.match(w.slice(section),/wx:if="{{session.user.passwordEnabled!==false}}"/);
 assert.match(w.slice(section),/wx:if="{{passwordOpen}}"/);assert.match(w.slice(section),/wx:if="{{actionError}}" class="error">{{actionError}}/);
 assert.match(w,/wx:if="{{session.user.role==='admin'}}"/);assert.match(w,/wx:if="{{session.user.systemAdmin}}"/);
 assert.match(w.slice(section),/disabled="{{loading}}" bindtap="tactics"/);assert.match(w.slice(section),/disabled="{{loading \|\| \(busy\)}}" bindtap="logout"/);
 assert.match(js,/logout\(\)\s*\{[\s\S]*?ui\.showModal\(this,[\s\S]*?if \(!result.confirm\) return/);
 assert.doesNotMatch(w.slice(section),/bindtap="wechatBind"/);
});
