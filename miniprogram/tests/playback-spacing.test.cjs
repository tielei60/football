// 静态边界预算不是微信原生圆钮或真实截图验收。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../pages');
const css = fs.readFileSync(path.join(root, 'tactic-board/index.wxss'), 'utf8');
test('播放端点采用固定像素净距且时间保持独立宽度', () => {
  const rules = [...css.matchAll(/\.playback-controls slider\.grow\{([^}]*)\}/g)];
  assert.equal(rules.length, 1);
  assert.equal(rules[0][1], 'flex:1;min-width:0;margin:0 18px');
  assert.match(css, /\.playback-controls>text\{flex:0 0 auto;font-size:20rpx;font-variant-numeric:tabular-nums;white-space:nowrap\}/);
  // 假设默认圆钮直径 28px；只用于检查静态预算，不声称已实测三种屏宽。
  for (const width of [320, 375, 430]) {
    const assumedRadius = 14;
    const gap = 10 * width / 750;
    assert.ok(18 + gap - assumedRadius >= 4, `屏宽 ${width} 的端点预算`);
  }
});
test('保持播放绑定及竖向画布；编排页当前无同类滑块', () => {
  const board = fs.readFileSync(path.join(root, 'tactic-board/index.wxml'), 'utf8');
  assert.match(board, /<slider class="grow"[^>]*value="{{playTime}}"[^>]*bindchange="seekPlayback"/);
  assert.match(board, /<text>{{playTime}} \/ {{playDuration}} 秒<\/text>/);
  const compose = fs.readFileSync(path.join(root, 'tactic-compose/index.wxml'), 'utf8');
  assert.doesNotMatch(compose, /<slider\b/);
});
