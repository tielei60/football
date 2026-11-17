const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const read=(p,e='wxml')=>fs.readFileSync(path.join(__dirname,'../pages',p,'index.'+e),'utf8');
// 展示优化前的事件、条件、禁用、绑定与输入约束签名。
const expected={"match-media": "f6df9e364fb419a9c6f9d1819296e6c3edaa39a6e98e8dc03272054c9d7f0682", "player-photos": "dbbe9ee5fa994b32332c6a1092216ba23d2976520c0d49a049362d79812c39b9", "wechat-claim": "0913a0e961c27dbcda817bdf0634c68c91ddd0c75581eea147f08f539f11d6fa", "wechat-invites": "5c09357abb79715a014a053fe5c58bc1fa4014f0257001f6df38f750812c5d9b", "player-ai": "34fc1facfa89d38d55131df02dfd66305ae0078ef34775912fa907cf28e17e32", "tactic-create": "230631d9728677be1b4a1172a10c6123262f54393e2efe0f96291475eacd96a8", "force-password": "303d4b74c70b617922e9577dfc1fdcd3c86775c186ffa3388b3f11f8577e8a74", "system-accounts": "66c562f84dc9d3c01f17cd0f7ea6c5713e458d758bcd2c5438f929832eeeb038"};
for(const [page,digest] of Object.entries(expected)) test(`${page} 保留业务绑定和守卫`,()=>{
const attrs=[...read(page).matchAll(/\s((?:bind[\w:]*|catch[\w:]*|wx:if|wx:elif|wx:else|wx:for|wx:key|disabled|data-[\w-]+|loading|hidden|value|password|maxlength)(?:="[^"]*")?)(?=[\s\/>])/g)].map(m=>m[1]);
assert.equal(crypto.createHash('sha256').update(attrs.join('\n')).digest('hex'),digest);
});
test('比赛相册与邀请认领保留设计队徽和独立计数',()=>{for(const p of ['match-media','wechat-claim'])assert.ok(read(p).includes('class="club-banner-mark"'));assert.ok(read('match-media').includes('class="media-count"'));});
test('首次改密三个输入均有提示',()=>{for(const text of ['输入初始密码','设置新的登录密码','重复输入新密码'])assert.ok(read('force-password').includes(`placeholder="${text}"`));});
test('次操作描边不覆盖禁用和危险态',()=>{for(const p of ['player-ai','wechat-invites','wechat-claim','system-accounts','force-password','player-photos'])assert.ok(read(p,'wxss').includes(':not([disabled])'));assert.ok(read('player-ai','wxss').includes(':not(.danger)'));assert.ok(read('wechat-invites','wxss').includes(':not(.invite-danger)'));});
test('核验编号可换行且须知输入有高度下限',()=>{assert.match(read('wechat-claim','wxss'),/font-size:60rpx[^}]*overflow-wrap:anywhere/);assert.ok(read('match-media','wxss').includes('min-height:110px'));});
