const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=(p,e)=>fs.readFileSync(path.join(__dirname,'../pages',p,'index.'+e),'utf8');
test('微信能力开启时才压缩留白，主登录与原入口禁用绑定保留',()=>{
 const w=read('login','wxml'),css=read('login','wxss');
 assert.match(w,/class="page login {{wechatEnabled\?'login-with-wechat':''}}"/);
 assert.match(w,/wx:if="{{wechatEnabled}}" class="page wechat-entry"/);
 for(const [cls,handler]of [['wechat-login-button','wechatLogin'],['wechat-invite-button','acceptInvite']])assert.match(w,new RegExp('class="ui-button ui-block '+cls+'" bindtap="'+handler+'" disabled="{{busy}}"'));
 assert.match(w,/class="primary ui-button ui-block"\s+loading="{{busy}}"\s+disabled="{{busy}}"\s+bindtap="submit"/);
 assert.match(css,/\.page.login.login-with-wechat\{padding-bottom:0\}/);
 assert.match(css,/button.wechat-login-button\[size="mini"\]\{background:var\(--surface\)/);
 assert.match(css,/button.wechat-invite-button\[size="mini"\]\{background:transparent/);
 assert.match(css,/\[disabled\]\{background:var\(--canvas\)/);
});
test('只读阵容补充数据解释而不泄露管理操作，号码弱化',()=>{
 const w=read('season-roster','wxml'),css=read('season-roster','wxss');
 assert.match(w,/<view wx:if="{{!admin}}" class="readonly-notes">/);
 assert.match(w,/赛季号码与当前球员资料可以不同/);
 assert.match(w,/<view wx:if="{{admin}}" class="footer">/);
 for(const handler of ['save','reload','remove','number','choose','add'])assert.ok(w.includes('="'+handler+'"'));
 assert.match(css,/\.roster-readonly \.read-number\{color:var\(--muted\)\}/);
});
