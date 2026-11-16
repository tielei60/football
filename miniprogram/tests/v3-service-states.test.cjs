const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=(p,ext='wxml')=>fs.readFileSync(path.join(__dirname,'../pages',p,'index.'+ext),'utf8');
test('服务与账号页共享装饰队徽且保留历史标题与页面门禁',()=>{
 for(const p of ['tactics','wechat-invites','player-ai','force-password','system-accounts']) assert.match(read(p),/<image class="club-banner-mark" src="\/assets\/team-badge.png" mode="aspectFit" aria-hidden="true"\/>/);
 assert.match(read('tactics'),/{{historical\?'本场战术留档':'球队战术'}}/);
 assert.match(read('tactics'),/wx:if="{{canManage}}"/);
 assert.match(read('wechat-invites'),/wx:if="{{!loading&&!error&&authorized}}"/);
 assert.match(read('player-ai'),/wx:if="{{!loading&&!error&&admin}}"/);
 assert.match(read('force-password'),/wx:if="{{!loading}}"/);
 assert.match(read('system-accounts'),/wx:if="{{authorized}}"/);
});
test('导出、邀请与匿名阵型风险说明显式分层，核验按钮条件保留',()=>{
 const transfer=read('tactic-transfer'),invite=read('wechat-invites'),create=read('tactic-create');
 assert.match(transfer,/class="warning export-privacy">战术中的队员姓名及比赛备注会保留，请妥善保管/);
 assert.match(transfer,/wx:if="{{exportReady}}" class="warning export-temporary">文件仅临时/);
 assert.match(transfer,/不会自动分享到聊天/); assert.match(transfer,/wx:if="{{pending}}"/);assert.match(transfer,/wx:if="{{recoveryBlocked}}"/);
 assert.match(invite,/wx:if="{{activeInvite.status==='claimed'}}" class="invite-verification-warning">请联系球员本人核对确认编号，再批准申请/);
 for(const action of ['approve','reject','revoke']) assert.ok(invite.includes('data-action="'+action+'" bindtap="decide" disabled="{{busy||needsRefresh||loadingMore}}"'));
 assert.match(create,/class="hint formation-info">{{formationIndex\?'仅放置匿名主队棋子，不关联球队成员。':'空白战术没有球员，可在创建后设置阵型与名单。'}} 不修改已有模板或历史比赛/);
});
test('生成三阶段、次级准备与独立待核对状态不隐藏恢复、费用或披露',()=>{
 const w=read('player-ai');
 for(const n of [1,2,3]) assert.ok(w.includes('<text class="ai-stage-number">'+n+'</text>'));
 assert.match(w,/<button id="ai-prepare" class="ui-button ui-block"[^>]*bindtap="prepare"[^>]*disabled="{{busy\|\|pending\|\|sourceReady\|\|!styles.length\|\|\(uploadMode==='sample'&&!samples.length\)\|\|\(uploadMode==='file'&&!hasSelectedImage\)}}"/);
 assert.match(w,/wx:if="{{pending}}" class="card ai-pending"/);
 for(const h of ['recover','retryPending','resetAdoption','generate','adopt','removeSource']) assert.ok(w.includes('bindtap="'+h+'"'));
 for(const expr of ['{{priceLabel}}','{{disclosureText}}','{{item.label}}','{{canResetAdoption}}','{{job&&job.canCancel&&!pending}}']) assert.ok(w.includes(expr));
 assert.match(w,/本地模拟，不是真实 AI 生成/);
});
test('首次改密保留原错误及提交保护，无权限只翻译已知拒绝文案',()=>{
 const force=read('force-password'),system=read('system-accounts');
 assert.ok(force.includes('error="{{errorSource===\'load\'?error:\'\'}}"'));assert.match(force,/<page-state[^>]*bind:retry="refresh"/);
 assert.ok(force.includes('<view wx:if="{{errorSource===\'submit\' && error}}" class="error" aria-role="alert" aria-live="assertive">{{error}}</view>'));
 assert.match(force,/bindtap="submit" disabled="{{busy}}" loading="{{busy}}"/);
 for(const field of ['currentPassword','newPassword','confirmation']) assert.ok(force.includes('value="{{'+field+'}}"'));
 assert.match(system,/wx:if="{{!loading && error==='仅系统管理员可以管理账号。'}}" class="card access-denied"/);
 assert.match(system,/<page-state wx:else loading="{{loading}}" error="{{error}}" skeleton-type="list" bind:retry="refresh"/);
 assert.match(system,/<navigator class="access-denied-return" open-type="switchTab" url="\/pages\/me\/index"[^>]*>返回我的<\/navigator>/);
 const app=JSON.parse(fs.readFileSync(path.join(__dirname,'../app.json'),'utf8'));
 assert.ok(app.tabBar.list.some(x=>x.pagePath==='pages/me/index'));
 assert.match(read('system-accounts','wxss'),/\.access-denied-return\{[^}]*min-height:44px/);
 assert.match(system,/wx:if="{{authorized&&!item.systemAdmin}}"/);
 assert.match(system,/wx:elif="{{item.systemAdmin}}"/);
});
