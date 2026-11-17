const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = page => fs.readFileSync(path.join(__dirname, '..', 'pages', page, 'index.wxml'), 'utf8');

test('战术播放滑块使用 V3 紫色，并保留时间与拖动绑定', () => {
  const slider = read('tactic-board').match(/<slider\b[^>]*bindchange="seekPlayback"[^>]*\/>/)[0];
  assert.match(slider, /activeColor="#760B88"/);
  assert.match(slider, /block-color="#760B88"/);
  for (const attr of ['min="0"', 'max="{{playDuration}}"', 'step="0.1"', 'value="{{playTime}}"']) assert.ok(slider.includes(attr));
});

test('战术收藏开关使用 V3 紫色，并保留收藏状态与事件', () => {
  const control = read('tactic-setup').match(/<switch\b[^>]*id="setup-favorite"[^>]*\/>/)[0];
  assert.match(control, /color="#760B88"/);
  for (const attr of ['checked="{{favorite}}"', 'data-key="favorite"', 'bindchange="input"']) assert.ok(control.includes(attr));
});
