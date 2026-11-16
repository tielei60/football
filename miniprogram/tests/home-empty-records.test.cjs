const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const wxml = fs.readFileSync(path.join(root, 'pages/home/index.wxml'), 'utf8');
const source = fs.readFileSync(path.join(root, 'pages/home/index.js'), 'utf8');

test('无下一场使用 V3 说明和原赛程入口，不伪造比赛或暴露创建权限', () => {
  const empty = wxml.match(/<view wx:else class="card home-no-next">([\s\S]*?)<\/button><\/view>/);
  assert.ok(empty);
  assert.match(empty[1], /下一场，还在安排。/);
  assert.match(empty[1], /比赛发布后，会显示在这里。/);
  assert.match(empty[1], /bindtap="schedule">查看比赛记录/);
  assert.doesNotMatch(empty[1], /bindtap="(?:create|openMatch)"|data-id=|next\./);
  assert.match(wxml, /<block wx:if="{{!loading && !error}}"/);
  const calls = [];
  let page;
  vm.runInNewContext(source, { require: () => ({}), Page: value => { page = value; }, wx: { switchTab: value => calls.push(value.url) } });
  page.schedule();
  assert.deepEqual(calls, ['/pages/schedule/index']);
});

test('无下一场记录入口三宽尺寸、点击与溢出检查（非原生验收）', async () => {
  const { chromium } = require('../../app/node_modules/playwright');
  const browser = await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  try {
    for (const width of [320, 375, 430]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      const fragment = wxml.match(/<view wx:else class="card home-no-next">[\s\S]*?<\/button><\/view>/)[0]
        .replace(/<view\b/g,'<div').replace(/<\/view\s*>/g,'</div>').replace(/<text\b/g,'<span').replace(/<\/text\s*>/g,'</span>');
      const css = ['app.wxss','pages/home/index.wxss'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n')
        .replace(/([\d.]+)rpx/g,(_,n)=>Number(n)*width/750+'px').replace(/(^|\})\s*page\s*\{/g,'$1 body{');
      await page.setContent('<style>body{margin:0}'+css+'</style><div class="page">'+fragment+'</div>');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth), width);
      const button = page.locator('.home-records-link');
      const rect = await button.boundingBox();
      assert.ok(rect.height >= 44 && rect.width >= 44);
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
      await button.click();
      await page.close();
    }
  } finally { await browser.close(); }
});
