const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function fixture() {
  let def, token = 'owner', sharedPath = '', texts = [];
  const ctx = { fillRect() {}, fillText(text) { texts.push(text); }, drawImage() {} };
  const image = { set src(value) { this.onload(); } };
  const canvas = { createImage: () => image, getContext: () => ctx };
  const wx = { createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, fields() { return this; }, exec(cb) { cb([{ node: canvas }]); } }), canvasToTempFilePath: options => options.success({ tempFilePath: 'wxfile://card.png' }), showShareImageMenu: options => { sharedPath = options.path; } };
  const s = { api: { getSession: () => ({ token, team: { name: '测试球队' } }), request: async () => ({ image: 'data:image/jpeg;base64,YQ==' }) } };
  vm.runInNewContext(fs.readFileSync('pages/wechat-invites/logic.js', 'utf8').replace('module.exports = {', 'Page({').replace(/};\s*$/, '});'), { Page: value => { def = value; }, require: name => name.includes('shared') ? s : {}, wx, Promise, Date, Math });
  const page = { ...def, data: { ...def.data, loading: false, authorized: true, enabled: true, canCopy: true, playerName: '虚构球员', activeInvite: { id: 'i', expiresAt: Date.now() + 10000 } }, _owner: token, _turn: 1, _credential: { id: 'i', value: 'a'.repeat(64) }, setData(patch) { Object.assign(this.data, patch); } };
  return { page, texts, path: () => sharedPath, switchUser: () => { token = 'other'; } };
}
test('card generation uses the selected player and explicit image sharing', async () => {
  const f = fixture(); await f.page.generateCard();
  assert.equal(f.page.data.cardPath, 'wxfile://card.png');
  assert.equal(f.page.data.cardOpen, true);
  assert.ok(f.texts.includes('测试球队'));
  assert.ok(f.texts.includes('邀请 虚构球员 加入'));
  assert.equal(f.path(), ''); f.page.shareCard(); assert.equal(f.path(), 'wxfile://card.png');
  f.page.closeCard(); assert.equal(f.page.data.cardOpen, false);
});
test('expired invitations and changed sessions cannot be shared', async () => {
  const f = fixture(); await f.page.generateCard(); f.page.data.activeInvite.expiresAt = Date.now() - 1; f.page.shareCard();
  assert.equal(f.path(), ''); assert.match(f.page.data.actionError, /过期/);
  f.page.data.activeInvite.expiresAt = Date.now() + 10000; f.switchUser(); await f.page.generateCard(); assert.equal(f.page.data.cardPath, '');
});
