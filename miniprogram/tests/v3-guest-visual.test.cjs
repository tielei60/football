// Official template output + real CSS in Chromium; not a WeChat device test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { wxmlToJs } = require('miniprogram-compiler');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const encode = (x) => String(x).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function html(node) {
  if (typeof node === 'string') return encode(node);
  if (!node || !node.tag) return '';
  const tag = ({ 'wx-text': 'span', 'wx-button': 'button', 'wx-input': 'input', 'wx-image': 'img' })[node.tag] || 'div';
  const attrs = Object.entries(node.attr || {}).filter(([k]) => ['class','size','placeholder','value','src'].includes(k)).map(([k,v]) => ' ' + k + '="' + encode(v) + '"').join('');
  if (tag === 'input' || tag === 'img') return '<' + tag + attrs + '>';
  return '<' + tag + attrs + '>' + (node.children || []).map(html).join('') + '</' + tag + '>';
}
const css = (source,width) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/([\d.]+)rpx/g, (_, n) => Number(n)*width/750+'px').replace(/(^|[{}])\s*page\s*\{/g,'$1 body{');
test('访客报名：官方模板与 V3 样式在 320/375/430px 不横溢，身份确认控件保持可触达', async (t) => {
  const { chromium } = require('../../app/node_modules/playwright');
  let browser;
  try { browser = await chromium.launch({ headless:true }); }
  catch (error) { if (process.env.CI || !/Executable doesn't exist/.test(error.message)) throw error; t.skip('缺少可用 Chromium'); return; }
  try {
    const gwx = new Function('window', wxmlToJs(root))({});
    const render = gwx('pages/match-guest/index.wxml');
    const match = {
      teamName:'隔离测试球队'.repeat(3),
      opponent:'GuestFriendlyOpponent'.repeat(3),
      statusLabel:'待比赛', dateLabel:'11月22日 周日', kickoff:'19:30',
      location:'虚构长球场现场入口'.repeat(10), notice:'匿名比赛须知\n'+'ImportantMatchNotice'.repeat(18), canReply:true, canRegister:true,
    };
    const source = read('app.wxss') + '\n' + read('pages/match-guest/index.wxss');
    for (const width of [320,375,430]) for (const [label, state] of [
      ['profile', {profileRequired:true}],
      ['response', {authenticated:true,response:'yes',responseLabel:'参加'}],
    ]) {
      const page = await browser.newPage({ viewport:{ width,height:820 } });
      await page.setContent('<style>body{margin:0}*{box-sizing:border-box}'+ css(source,width)+'</style>'+html(render({loading:false,match,...state})));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, label + ' ' + width);
      const targets = await page.locator('button:visible,input:visible').evaluateAll(nodes => nodes.map(el => {
        const b = el.getBoundingClientRect();
        return { left:b.left,right:b.right,height:b.height };
      }));
      assert.equal(targets.length, label==='profile'?5:3);
      for (const a of targets) assert.ok(a.height >= 43.9 && a.left >= 0 && a.right <= width + 0.1, JSON.stringify({label,width,a}));
      if (label === 'profile') {
        assert.ok(await page.getByText('确认信息并报名').isVisible());
        assert.ok(await page.getByText('重新微信登录，核对报名').isVisible());
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
