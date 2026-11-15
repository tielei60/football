const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
test('packaged badge preserves confirmed source bytes without image editing', () => {
  const source = fs.readFileSync(path.join(root, '../app/public/team-badge.png'));
  const asset = fs.readFileSync(path.join(root, 'assets/team-badge.png'));
  assert.deepEqual(asset, source);
  assert.equal(hash(asset), '67daa96dd61285db3a9616dcb63200c9dfb7a7330516a9b371999af2648b6927');
  assert.equal(asset.readUInt32BE(16), 256);
  assert.equal(asset.readUInt32BE(20), 256);
});
test('login uses aspectFit packaged image and friendly non-FC fallback; rest of markup unchanged', () => {
  const w = read('pages/login/index.wxml');
  assert.match(w, /src="\/assets\/team-badge.png" mode="aspectFit" binderror="badgeError"/);
  assert.match(w, /<text wx:else class="brand-fallback">队徽暂不可用<\/text>/);
  const original = require('./membership-markup.cjs')(w.replace(/<view class="brand-mark">[\s\S]*?<\/view>/, '<view class="brand-mark">FC</view>'))
    .replace(/<view wx:if="{{wechatEnabled}}" class="page wechat-entry">[\s\S]*?<\/view>\n(?=<business-dialog)/, '')
    .replace(/\sclass="[^"]*"/g, '');
  assert.equal(hash(original), 'd6b56a86c5d01ff5b5c31951f6c644d23c5e057fdd86cbcdd470ba2b377bb062');
});
test('badge error changes only badge state, never requests login or team data', () => {
  let definition;
  vm.runInNewContext(read('pages/login/index.js'), {Page:d=>definition=d,require:()=>new Proxy({}, {get(){throw Error('unexpected dependency');}})});
  const page = {...definition, data:structuredClone(definition.data), setData(p){Object.assign(this.data,p);}};
  page.data.username='anonymous';page.data.password='fixture-only';page.data.wechatEnabled=true;
  const before=structuredClone(page.data);page.badgeError();assert.deepEqual(page.data,{...before,badgeFailed:true});
  page._disposed=true;page.data.badgeFailed=false;page.badgeError();assert.equal(page.data.badgeFailed,false);
});
