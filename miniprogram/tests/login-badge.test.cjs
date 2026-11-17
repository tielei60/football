const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
test('packaged badge uses V3 supplied transparent original without image editing', () => {
  const asset = fs.readFileSync(path.join(root, 'assets/team-badge.png'));
  assert.equal(hash(asset), '65630c8291acbbab2a6be34a085cb0fb4ae317810442ca4add2faaff64d054bf');
  // 设计包 design/assets/team-badge-clean.png 原件；RGBA 保留透明背景。
  assert.equal(asset[25], 6);
  assert.equal(asset.readUInt32BE(16), 256);
  assert.equal(asset.readUInt32BE(20), 256);
});
test('v3 登录使用独立队徽与品牌场景，保留全部登录门禁和事件', () => {
  const w = read('pages/login/index.wxml');
  assert.match(w, /src="\/assets\/team-badge.png" mode="aspectFit" binderror="badgeError"/);
  assert.match(w, /<text wx:else class="brand-fallback">柏林花园 FC<\/text>/);
  assert.match(w, /class="login-atmosphere" src="\/assets\/club-atmosphere.jpg"/);
  assert.match(w, /class="login-art"/);
  // 仅展示结构可变化；登录输入、条件、提交事件和微信入口保持原始契约。
  const attrs = w.match(/(?:wx:(?:if|elif|else|for|key)|(?:bind|catch)[\w:]*|data-[\w-]+|disabled|loading|password|maxlength|value)\s*(?:=\s*"[^"]*")?/g).sort();
  assert.equal(hash(JSON.stringify(attrs)), 'a1e7e40abc1f3577916082b06571cd8d0b1bd714877f9feab2648467b6636891');
});
test('badge error changes only badge state, never requests login or team data', () => {
  let definition;
  vm.runInNewContext(read('pages/login/index.js'), {Page:d=>definition=d,require:()=>new Proxy({}, {get(){throw Error('unexpected dependency');}})});
  const page = {...definition, data:structuredClone(definition.data), setData(p){Object.assign(this.data,p);}};
  page.data.username='anonymous';page.data.password='fixture-only';page.data.wechatEnabled=true;
  const before=structuredClone(page.data);page.badgeError();assert.deepEqual(page.data,{...before,badgeFailed:true});
  page._disposed=true;page.data.badgeFailed=false;page.badgeError();assert.equal(page.data.badgeFailed,false);
});
