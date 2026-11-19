const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const read=(p,e='wxml')=>fs.readFileSync(path.join(__dirname,'../pages',p,'index.'+e),'utf8');
// 展示优化前的事件、条件、禁用、绑定与输入约束签名。
const expected={"match-media": "f6df9e364fb419a9c6f9d1819296e6c3edaa39a6e98e8dc03272054c9d7f0682", "player-photos": "dbbe9ee5fa994b32332c6a1092216ba23d2976520c0d49a049362d79812c39b9", "wechat-claim": "0913a0e961c27dbcda817bdf0634c68c91ddd0c75581eea147f08f539f11d6fa", "wechat-invites": "5c09357abb79715a014a053fe5c58bc1fa4014f0257001f6df38f750812c5d9b", "player-ai": "34fc1facfa89d38d55131df02dfd66305ae0078ef34775912fa907cf28e17e32", "tactic-create": "230631d9728677be1b4a1172a10c6123262f54393e2efe0f96291475eacd96a8", "force-password": "303d4b74c70b617922e9577dfc1fdcd3c86775c186ffa3388b3f11f8577e8a74", "system-accounts": "66c562f84dc9d3c01f17cd0f7ea6c5713e458d758bcd2c5438f929832eeeb038"};
// 原图 26 调整移除按钮至首行；仅还原唯一完整分组，冻结原事件属性顺序。
function photoActionOrder(source) {
 const removal='<button class="danger ui-button" data-id="{{item.id}}" bindtap="remove" disabled="{{loading || (busy||conflict||uncertain||recoveryBlocked)}}" size="mini">移除</button>';
 const boundary='</view>\n<view wx:if="{{admin}}" class="photo-actions-secondary">';
 const down='<button data-id="{{item.id}}" data-delta="1" bindtap="move" disabled="{{busy||conflict||uncertain||recoveryBlocked||index===photos.length-1}}" class="ui-button" size="mini">下移</button>';
 for(const part of [removal,removal+'\n'+boundary,down]) assert.equal(source.split(part).length-1,1,'照片分组必须精确且唯一');
 return source.replace(removal+'\n'+boundary,boundary).replace(down,down+'\n'+removal);
}
test('照片分组投影拒绝篡改和重复，保留额外事件',()=>{
 const w=read('player-photos');assert.throws(()=>photoActionOrder(w.replace('bindtap="remove"','bindtap="unsafe"')));
 assert.throws(()=>photoActionOrder(w+w));assert.ok(photoActionOrder(w+'<button bindtap="other"/>').includes('bindtap="other"'));
});
// 初始化失败的唯一提交门禁已专项验证；原 SHA 保持不变。
function passwordLoadGate(source){
 for(const {before,after} of require('./force-password-load-gate-projection.json').filter(b=>b.ext==='wxml')){
  assert.equal(source.split(after).length,2,'改密提交门禁必须完整且唯一');
  source=source.replace(after,before);
 }
 return source;
}
test('改密门禁投影拒绝篡改重复并保留额外事件',()=>{
 const w=read('force-password'),{after}=require('./force-password-load-gate-projection.json').find(b=>b.ext==='wxml');
 assert.throws(()=>passwordLoadGate(w.replace(after,after.replace('loading || ',''))));
 assert.throws(()=>passwordLoadGate(w+w));
 assert.ok(passwordLoadGate(w+'<button bindtap="other"/>').includes('bindtap="other"'));
});
for(const [page,digest] of Object.entries(expected)) test(`${page} 保留业务绑定和守卫`,()=>{
const source=page==='system-accounts'?require('./signup-self-binding-projection.cjs').normalize('pages/system-accounts/index.wxml',read(page)):page==='match-media'?require('./match-media-album-only-projection.cjs').normalize('pages/match-media/index.wxml',read(page)):page==='player-photos'?photoActionOrder(read(page)):page==='force-password'?passwordLoadGate(read(page)):read(page);
const attrs=[...source.matchAll(/\s((?:bind[\w:]*|catch[\w:]*|wx:if|wx:elif|wx:else|wx:for|wx:key|disabled|data-[\w-]+|loading|hidden|value|password|maxlength)(?:="[^"]*")?)(?=[\s\/>])/g)].map(m=>m[1]);
assert.equal(crypto.createHash('sha256').update(attrs.join('\n')).digest('hex'),digest);
});
test('比赛相册与邀请认领保留设计队徽和独立计数',()=>{for(const p of ['match-media','wechat-claim'])assert.ok(read(p).includes('class="club-banner-mark"'));assert.ok(read('match-media').includes('class="media-count"'));});
test('首次改密三个输入均有提示',()=>{for(const text of ['输入初始密码','设置新的登录密码','重复输入新密码'])assert.ok(read('force-password').includes(`placeholder="${text}"`));});
test('次操作描边不覆盖禁用和危险态',()=>{for(const p of ['player-ai','wechat-invites','wechat-claim','system-accounts','force-password','player-photos'])assert.ok(read(p,'wxss').includes(':not([disabled])'));assert.ok(read('player-ai','wxss').includes(':not(.danger)'));assert.ok(read('wechat-invites','wxss').includes(':not(.invite-danger)'));});
test('核验编号可换行且须知编辑区迁至比赛表单保留高度下限',()=>{assert.match(read('wechat-claim','wxss'),/font-size:60rpx[^}]*overflow-wrap:anywhere/);assert.match(read('match-edit','wxss'),/\.card textarea\s*\{[^}]*min-height:200rpx/);assert.doesNotMatch(read('match-media'),/<textarea\b/);});

test('比赛相册原图19横图188px对应376rpx，操作层级保持',()=>{
 const css=read('match-media','wxss');assert.match(css,/\.photo \{ height:376rpx;/);
 assert.match(css,/\.actions>button\.danger\.ui-button:not\(\[disabled\]\)[^}]*background:transparent[^}]*color:var\(--muted\)/);
});
