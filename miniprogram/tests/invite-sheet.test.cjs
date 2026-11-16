const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('components/invite-sheet/index.js', 'utf8');
function setup(state = {}) {
  let definition, generated = 0, invalidated = 0;
  const logic = { data: {}, async refresh() { Object.assign(this.data, { authorized: true, enabled: true, loading: false, ...state }); }, ready() { return this.data.authorized && this.data.enabled && !this.data.loading; }, async create() { generated++; this.setData({ cardOpen: true }); }, invalidate() { invalidated++; this._hidden = true; this.setData({ cardOpen: false }); } };
  vm.runInNewContext(source, { require: () => logic, Component: value => { definition = value; } });
  const instance = { ...definition.methods, data: { sheetOpen: false }, properties: { player: 'p1' }, setData(value) { Object.assign(this.data, value); } };
  return { instance, get generated() { return generated; }, get invalidated() { return invalidated; } };
}
test('球员编辑页直接生成并显示邀请卡片，关闭后可再次生成', async () => {
  const f = setup(); await f.instance.open();
  assert.equal(f.instance.id, 'p1'); assert.equal(f.generated, 1); assert.equal(f.instance.data.cardOpen, true);
  await f.instance.open(); assert.equal(f.generated, 1);
  f.instance.closeCard(); assert.equal(f.instance.data.sheetOpen, false); assert.equal(f.invalidated, 1);
  await f.instance.open(); assert.equal(f.generated, 2);
});
test('已绑定或待审核等状态直接在弹层处理，不自动创建邀请', async () => {
  for (const state of [{binding:{bound:true}}, {activeInvite:{status:'claimed'}}, {archived:true}, {unconfirmed:true}, {enabled:false}]) {
    const f = setup(state); await f.instance.open(); assert.equal(f.generated, 0); assert.equal(f.instance.data.sheetOpen, true);
  }
});
test('关闭弹层后迟到的载入结果不会创建邀请', async () => {
  const f = setup(); let release; f.instance.refresh = () => new Promise(resolve => { release = resolve; });
  const opening = f.instance.open(); f.instance.closeSheet(); release(); await opening; assert.equal(f.generated, 0);
});
