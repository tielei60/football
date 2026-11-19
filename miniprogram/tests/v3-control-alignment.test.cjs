// Chromium checks converted shared WXSS and isolated picker shadow DOM. This is
// not a substitute for WeChat's native input/tabBar/device acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
// Remove comments before adapting page selectors: otherwise a comment between
// two rules leaves real page-scoped tokens undefined in the HTML fixture.
const css = (source, width) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([\d.]+)rpx/g, (_, n) => Number(n) * width / 750 + 'px').replace(/(^|\})\s*page\s*\{/g, '$1 body{');
const picker = text => `<business-picker><div class="picker"><span class="picker-value">${text}</span></div></business-picker>`;
test('WXSS适配器保留注释后及媒体内page令牌，不因缺失令牌伪造高度回归', () => {
  const converted = css(read('app.wxss'), 430);
  assert.doesNotMatch(converted, /(?:^|[}])\s*page\s*\{/);
  assert.match(converted, /body\{--field-control-height:50\.45333333333333px\}/);
  assert.equal(css('/* first */page{--a:88rpx}/* next */page{--b:1rpx}', 750), ' body{--a:88px} body{--b:1px}');
});
test('标准输入、选择和动作等高对齐，长字段自然增高，320/375/430及横屏不横向溢出', async () => {
  const { chromium } = require('../../app/node_modules/playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    for (const width of [320, 375, 430, 667]) {
      const page = await browser.newPage({ viewport: { width, height: width === 667 ? 375 : 850 } });
      await page.setContent(`<style>body{margin:0}*{box-sizing:border-box}${css(read('app.wxss'), width)}</style><div class="page">
        <input class="input standalone" value="隔离测试字段" />
        <div class="standalone-picker">${picker('草稿')}</div>
        <button class="ui-button standard-action" size="mini">保存</button>
        <div class="filter-row"><div class="grow"><span class="field-label">日期 *</span>${picker('选择日期')}</div><div class="grow"><span class="field-label">开球时间</span>${picker('时间待定')}</div></div>
        <div class="filter-row varied-labels"><div class="grow"><span class="field-label">短标签</span><input class="input" value="测试" /></div><div class="grow"><span class="field-label">这是较长的字段标签说明，允许自动换行</span>${picker('测试选项')}</div></div>
        <div class="long-picker">${picker('很长的实际场地信息及选项文字'.repeat(12))}</div>
        <textarea>多行备注仍保留独立高度</textarea>
      </div>`);
      await page.evaluate(componentCss => {
        for (const host of document.querySelectorAll('business-picker')) {
          host.attachShadow({ mode: 'open' }).innerHTML = `<style>${componentCss}</style><button class="trigger"><slot></slot></button>`;
        }
      }, css(read('components/business-picker/index.wxss'), width));
      const controlToken = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--field-control-height').trim());
      assert.ok(Math.abs(parseFloat(controlToken) - 88 * width / 750) < 0.01, 'fixture must use the actual page-scoped height token');
      const dimensions = await page.evaluate(() => {
        const box = selector => { const e = document.querySelector(selector), r = e.getBoundingClientRect(); return { height: r.height, top: r.top, bottom: r.bottom, width: r.width, scroll: e.scrollHeight, client: e.clientHeight }; };
        return { input: box('.standalone'), picker: box('.standalone-picker .picker'), action: box('.standard-action'), first: box('.filter-row .grow:first-child .picker'), second: box('.filter-row .grow:last-child .picker'), labelInput: box('.varied-labels input'), labelPicker: box('.varied-labels .picker'), long: box('.long-picker .picker'), textarea: box('textarea'), scrollWidth: document.documentElement.scrollWidth };
      });
      const expected = Math.max(44, 88 * width / 750);
      for (const field of ['input', 'picker', 'action', 'first', 'second']) assert.ok(Math.abs(dimensions[field].height - expected) < 1, `${width}/${field}: ${JSON.stringify(dimensions)}`);
      assert.ok(Math.abs(dimensions.first.top - dimensions.second.top) < 1, 'two columns start together');
      assert.ok(Math.abs(dimensions.labelInput.bottom - dimensions.labelPicker.bottom) < 1, 'wrapped field labels retain aligned control baseline');
      assert.ok(dimensions.long.height > dimensions.picker.height, 'long values are not clipped to forced single-line height');
      assert.ok(dimensions.long.scroll <= dimensions.long.client + 1);
      assert.ok(dimensions.textarea.height > dimensions.input.height, 'textarea keeps its own geometry');
      assert.equal(dimensions.scrollWidth, width);
      await page.close();
    }
  } finally { await browser.close(); }
});
test('首页收紧上方但保留两行品牌标题、完整队名和首张赛事入口', async () => {
  const { chromium } = require('../../app/node_modules/playwright');
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try { for (const width of [320, 375, 430]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const homeCss = css(read('pages/home/index.wxss'), width);
    await page.setContent(`<style>body{margin:0}*{box-sizing:border-box}${css(read('app.wxss'), width)}${homeCss}</style><div class="page"><div class="hero club-home-hero"><div class="hero-shade"></div><div class="hero-content"><div class="hero-brand"><span class="hero-badge-fallback">足</span><span>隔离测试足球俱乐部</span></div><div class="hero-tagline">足球 · 伙伴 · 花园</div><div class="hero-headline"><span class="hero-headline-line">一起踢球，</span><span class="hero-headline-line">更好的我们。</span></div><div class="hero-caption">球员端 · 一起上场</div></div></div><div class="section next-section">焦点赛事入口</div></div>`);
    const before = await page.locator('.club-home-hero').boundingBox();
    assert.ok(before.y === 0, 'hero has no blank strip above it');
    // Different fonts may shift the text height by a pixel; the contract is
    // relative compaction with intact content, not an arbitrary absolute cap.
    const content = await page.locator('.hero-content').boundingBox();
    assert.ok(content.y + content.height <= before.y + before.height, 'text stays within hero');
    const textRects = await page.locator('.hero-brand>span:last-child,.hero-tagline,.hero-headline-line,.hero-caption').evaluateAll(elements => elements.flatMap(element => { const range = document.createRange(); range.selectNodeContents(element); return Array.from(range.getClientRects(), r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })); }));
    assert.ok(textRects.length >= 5);
    for (const rect of textRects) assert.ok(rect.left >= before.x - 1 && rect.right <= before.x + before.width + 1 && rect.top >= before.y - 1 && rect.bottom <= before.y + before.height + 1, 'visible text must remain within the unclipped hero');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    // Compare against the actual previous geometry, not a hand-written fixed expected height.
    await page.addStyleTag({ content: css('.club-home-hero{min-height:368rpx;padding-bottom:36rpx}.hero-content{padding:30rpx 32rpx 42rpx}.hero-tagline{margin-top:28rpx}.hero-headline{font-size:52rpx;line-height:1.4;margin-top:20rpx}.hero-caption{margin-top:24rpx}', width) });
    const previous = await page.locator('.club-home-hero').boundingBox();
    assert.ok(previous.height - before.height >= 40 * width / 375, 'meaningfully reduced above-the-fold height');
    await page.close();
  } } finally { await browser.close(); }
});
