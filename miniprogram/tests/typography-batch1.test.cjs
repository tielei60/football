const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const baseline = require('./typography-batch1-baseline.json');
const root = path.join(__dirname, '..');
const typeProps = new Set(['font-size','font-weight','line-height','color','letter-spacing']);
function rules(css) {
  const out = {};
  for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g,'').split('@media')[0].matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const s = selector.trim().replace(/\s+/g,' ');
    out[s] ||= {};
    for (const [, k,v] of body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) out[s][k] = v.trim();
  }
  return out;
}
for (const [page, old] of Object.entries(baseline)) {
  test(`typography batch1 ${page}: static markup and control geometry preserved`, () => {
    const markup = fs.readFileSync(path.join(root,'pages',page,'index.wxml'),'utf8').replace(/<button[^>]*bindtap="openPhotos"[^>]*>(?:管理|查看)出场照片<\/button>/g,'').replace(/\sclass="[^"]*"/g,'');
    assert.equal(crypto.createHash('sha256').update(markup).digest('hex'),old.markupSha256);
    const css = fs.readFileSync(path.join(root,'pages',page,'index.wxss'),'utf8');
    const current = rules(css);
    for (const [selector, props] of Object.entries(old.geometry)) for (const [prop,value] of Object.entries(props)) assert.equal(current[selector]?.[prop],value,`${selector} ${prop}`);
    for (const [selector, props] of Object.entries(current)) for (const [prop,value] of Object.entries(props)) if (!typeProps.has(prop)) assert.equal(old.geometry[selector]?.[prop],value,`new geometry ${selector} ${prop}`);
    const media = css.slice(css.indexOf('@media'));
    assert.doesNotMatch(media,/input|textarea|button|picker|canvas|\.tab\b/);
    assert.doesNotMatch(media,/(?:^|[;{])\s*(?:height|padding|width)\s*:/); // viewport conditions are max-width, not declarations
    assert.match(media,/font-size: 12px/);
    for (const [,width] of media.matchAll(/max-width:\s*([\d.]+)px/g)) assert.ok(Number(width) >= 320 && Number(width) <=375);
  });
}
test('typography batch1 hierarchy uses local rules, not global replacements', () => {
  const read = p => rules(fs.readFileSync(path.join(root,'pages',p,'index.wxss'),'utf8'));
  assert.equal(read('home')['.hero .subtitle']['font-size'],'24rpx');
  assert.equal(read('home')['.match-time']['font-weight'],'500');
  assert.equal(read('schedule')['.card .match-name']['font-size'],'30rpx');
  assert.equal(read('players')['.card .bold']['font-weight'],'600');
  assert.equal(read('statistics')['.rank']['color'],'var(--muted)');
  assert.equal(read('me')['.metric .label']['font-size'],'25rpx');
  assert.equal(read('login')['.login>.title']['font-size'],'38rpx');
  assert.equal(read('player-detail')['.hint']['font-size'],'25rpx');
});
