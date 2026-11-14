const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  { createRequire } = require("node:module");
const model = require("../utils/picker-model");
function host() {
  let def;
  const filename = path.join(
    __dirname,
    "../components/business-dialog/index.js",
  );
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Component: (d) => (def = d),
    require: createRequire(filename),
    Math,
    Number,
    Date,
    String,
  });
  const calls = [],
    page = {
      ...def.methods,
      data: structuredClone(def.data),
      setData(patch) {
        for (const [key, value] of Object.entries(patch)) {
          const parts = key.split(".");
          let target = this.data;
          for (const part of parts.slice(0, -1)) target = target[part];
          target[parts.at(-1)] = structuredClone(value);
        }
      },
      _bridge: {
        confirm: (...args) => calls.push(["confirm", ...args]),
        cancel: (...args) => calls.push(["cancel", ...args]),
      },
    };
  return { page, calls };
}
function modal(range, value = 0, id = 1) {
  return {
    id,
    kind: "picker",
    showCancel: true,
    title: "选择阵型",
    pickerState: model.create({ range, value }),
  };
}
test("selector draft remains local through host rerender and cancel never commits it", () => {
  const h = host(),
    view = modal(["甲", "乙", "丙"], 0);
  h.page.present({ modal: view, transient: null });
  h.page.pickerOption({ currentTarget: { dataset: { value: 2 } } });
  assert.equal(h.calls.length, 0);
  assert.equal(view.pickerState.draft, 0);
  h.page.present({ modal: view, transient: { title: "其他提示" } });
  assert.equal(h.page.data.modal.pickerState.draft, 2);
  h.page.cancel();
  assert.equal(h.calls[0][0], "cancel");
  assert.equal(
    h.calls.some((x) => x[0] === "confirm"),
    false,
  );
});
test("selector confirms exact numeric zero and new task does not inherit old draft", () => {
  const h = host();
  h.page.present({ modal: modal(["甲", "乙"], 1), transient: null });
  h.page.pickerOption({ currentTarget: { dataset: { value: 0 } } });
  h.page.confirm();
  assert.deepEqual(h.calls, [["confirm", 1, 0]]);
  h.page.present({ modal: modal(["新甲", "新乙"], 1, 2), transient: null });
  assert.equal(h.page.data.modal.pickerState.draft, 1);
});
test("empty selector and invalid option cannot submit while cancel remains available", () => {
  const h = host();
  h.page.present({ modal: modal([], 0), transient: null });
  h.page.pickerOption({ currentTarget: { dataset: { value: 99 } } });
  h.page.confirm();
  assert.equal(h.calls.length, 0);
  h.page.cancel();
  assert.equal(h.calls[0][0], "cancel");
});
test("long option labels preserve their full source and selected index without truncating data", () => {
  const range = Array.from(
    { length: 200 },
    (_, i) => `第${i}位球员 ` + "长名称".repeat(30),
  );
  const h = host();
  h.page.present({ modal: modal(range, 180), transient: null });
  assert.equal(h.page.data.modal.pickerState.rows.length, 200);
  assert.equal(h.page.data.modal.pickerState.rows[180].label, range[180]);
  h.page.confirm();
  assert.equal(h.calls[0][2], 180);
});
test("long list initial selected anchor does not jump when temporary selection changes or toast rerenders", () => {
  const h = host(),
    range = Array.from({ length: 200 }, (_, i) => "球员" + i),
    view = modal(range, 180);
  h.page.present({ modal: view, transient: null });
  assert.equal(h.page.data.selectorAnchor, "picker-option-180");
  h.page.pickerOption({ currentTarget: { dataset: { value: 181 } } });
  assert.equal(h.page.data.selectorAnchor, "picker-option-180");
  h.page.present({ modal: view, transient: { title: "提示" } });
  assert.equal(h.page.data.selectorAnchor, "picker-option-180");
  assert.equal(h.page.data.modal.pickerState.draft, 181);
  h.page.present({ modal: modal(range, 3, 2), transient: null });
  assert.equal(h.page.data.selectorAnchor, "picker-option-3");
});
