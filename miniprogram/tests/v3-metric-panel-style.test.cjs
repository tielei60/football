const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

for (const [page, scope] of [['statistics', '.statistics-page .record-card'], ['me', '.page .section']]) {
  test(`${page} 统计面板按 V3 保留整体卡片和竖分隔，而非嵌套小卡片`, () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'pages', page, 'index.wxss'), 'utf8');
    const compact = css.replace(/\s+/g, ' ');
    assert.ok(compact.includes(`${scope} .metrics{gap:0}`));
    assert.ok(compact.includes(`${scope} .metrics>.metric{background:transparent;border:0;border-radius:0;box-shadow:none}`));
    assert.ok(compact.includes(`${scope} .metrics>.metric+.metric{border-left:1rpx solid var(--line)}`));
    const wxml = fs.readFileSync(path.join(__dirname, '..', 'pages', page, 'index.wxml'), 'utf8');
    const fields = page === 'statistics' ? ['wins', 'draws', 'losses'] : ['yes', 'no', 'maybe', 'unanswered'];
    for (const field of fields) assert.ok(wxml.includes(`{{${page === 'statistics' ? 'stats.team' : 'registration'}.${field}}}`));
  });
}

test('统计榜单窄屏表头与数值列共享最小宽度，不拆中文词',()=>{
 const css=fs.readFileSync(path.join(__dirname,'..','pages/statistics/index.wxss'),'utf8');
 assert.match(css,/\.statistics-page \.ranking-header>text:not\(\.ranking-header-name\),\.statistics-page \.ranking-values>text\{min-width:30px;white-space:nowrap\}/);
});
