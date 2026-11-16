const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const app = read(path.join(root, 'app.json'));
// 当前项目实际使用的原生标签。新增标签必须明确原生身份或注册为组件。
const nativeTags = new Set(['block', 'view', 'text', 'button', 'canvas', 'image', 'input', 'label', 'map', 'navigator', 'scroll-view', 'slider', 'switch', 'textarea', 'slot', 'template', 'import', 'include', 'wxs']);
function missingTags(markup, registered) {
  const source = markup.replace(/<!--[\s\S]*?-->/g, '');
  return [...new Set([...source.matchAll(/<([a-z][\w-]*)\b/g)].map(m => m[1]))]
    .filter(tag => !nativeTags.has(tag) && !registered[tag]);
}
test('全部页面及共享组件的非原生标签均有本地或全局注册且目标存在（静态契约）', () => {
  const entries = [...app.pages, ...fs.readdirSync(path.join(root, 'components')).map(name => 'components/' + name + '/index')];
  for (const entry of entries) {
    const config = read(path.join(root, entry + '.json'));
    const registered = { ...app.usingComponents, ...config.usingComponents };
    const markup = fs.readFileSync(path.join(root, entry + '.wxml'), 'utf8');
    assert.deepEqual(missingTags(markup, registered), [], entry + ' 存在未注册标签');
    for (const [tag, target] of Object.entries(registered)) {
      const resolved = target.startsWith('/') ? path.join(root, target) : path.resolve(root, path.dirname(entry), target);
      assert.ok(fs.existsSync(resolved + '.wxml'), entry + ': ' + tag + ' 模板不存在');
      assert.equal(read(resolved + '.json').component, true, entry + ': ' + tag + ' 不是组件');
    }
  }
});
test('注册检测能识别遗漏与全局注册，不将注释或原生 scroll-view 误报', () => {
  const markup = '<scroll-view><page-state/><business-dialog/></scroll-view><!-- <unused-widget/> -->';
  assert.deepEqual(missingTags(markup, { 'business-dialog': '/components/business-dialog/index' }), ['page-state']);
  assert.deepEqual(missingTags(markup, { 'business-dialog': 'global', 'page-state': 'local' }), []);
});
