const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxss'), 'utf8');
const luminance = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const hex = s => [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
test('首页 Hero 小字在最亮图片背景及整个透明渐变上至少达到 4.5:1', () => {
  const rule = [...css.matchAll(/\.hero-shade\s*\{([^}]+)\}/g)].find(m => m[1].includes('linear-gradient'));
  assert.ok(rule, '必须读取真实遮罩样式');
  const stops = [...rule[1].matchAll(/rgba\(([^)]+)\)/g)].map(m => m[1].split(',').map(Number));
  assert.equal(stops.length, 2, '渐变结构改变时须重新检查采样模型');
  assert.match(rule[1], /linear-gradient\(90deg,/);
  const caption = css.match(/\.hero-caption\s*\{[^}]*color:#([0-9a-f]{6})/i);
  assert.ok(caption, '必须读取真实辅助文字颜色');
  const tagline = css.match(/\.hero-tagline\s*\{([^}]+)\}/);
  assert.ok(tagline);
  const taglineColor = tagline[1].match(/color:#([0-9a-f]{6})/i);
  const taglineLayer = tagline[1].match(/background:#([0-9a-f]{8})/i);
  assert.ok(taglineColor && taglineLayer);
  const overlay = hex(taglineLayer[1]), overlayAlpha = parseInt(taglineLayer[1].slice(6), 16) / 255;
  // brand 继承 hero-content 的白色；白色标题也使用同一前景。
  assert.match(css, /\.hero-content\s*\{[^}]*color:#fff[;}]/);
  const foregrounds = [{rgb:hex(caption[1]), layer:false}, {rgb:[255,255,255], layer:false}, {rgb:hex(taglineColor[1]), layer:true}];
  // 真实装饰图包含纯白像素。纯白为任意裁切/缩放下的最亮背景上界；
  // CSS 透明渐变按预乘 alpha 插值，不能只检测两端或平均颜色。
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000, a = stops[0][3] * (1 - t) + stops[1][3] * t;
    const background = [0, 1, 2].map(c => stops[0][c] * stops[0][3] * (1 - t) + stops[1][c] * stops[1][3] * t + 255 * (1 - a));
    for (const foreground of foregrounds) {
      const surface = foreground.layer ? background.map((v,c) => overlay[c] * overlayAlpha + v * (1 - overlayAlpha)) : background;
      const ratio = (luminance(foreground.rgb) + .05) / (luminance(surface) + .05);
      assert.ok(ratio >= 4.5, `渐变位置 ${i}/1000 对比度 ${ratio.toFixed(3)} 不足`);
    }
  }
});

test('首页下一场卡内标题及赛果标题行保留原真实字段和入口', () => {
 const w = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxml'), 'utf8');
 assert.match(w, /class="fixture-heading"><text class="fixture-heading-title"><text class="fixture-heading-label">焦点赛事/);
 assert.match(w, /class="fixture-heading-meta"[\s\S]*next.competition[\s\S]*next.format/);
 assert.match(w, /class="result-ticket-heading"><text class="result-outcome {{item.resultTone}}">{{item.resultLabel}}<\/text><text class="result-date">{{item.dateLabel}}/);
 assert.equal((w.match(/bindtap="schedule"/g)||[]).length, 2);
 assert.match(w, /{{item.scoreLabel}}/); assert.match(w, /{{item.opponent}}/);
 assert.equal((w.match(/bindtap="openMatch"/g)||[]).length, 3);
});
