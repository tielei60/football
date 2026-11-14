const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const canvas = require("../utils/tactic-canvas");
test("portrait coordinate projection round trips corners and touch positions on small and focus canvases", () => {
  // Include intentionally letterboxed/short areas and both portrait/landscape windows.
  for (const [width, height] of [
    [288, 435.835351],
    [240, 363.196126],
    [180, 272.397094],
    [320, 400],
    [640, 300],
    [360, 540],
  ]) {
    for (const [x, y] of [
      [0, 0],
      [1250, 0],
      [0, 826],
      [1250, 826],
      [625, 413],
      [68, 62],
      [1183, 763],
      [309.25, 520.75],
    ]) {
      const screen = canvas.toScreen(x, y, width, height),
        roundTrip = canvas.fromScreen(screen.x, screen.y, width, height);
      assert.ok(
        screen.x >= -1e-8 &&
          screen.x <= width + 1e-8 &&
          screen.y >= -1e-8 &&
          screen.y <= height + 1e-8,
      );
      assert.ok(
        Math.abs(roundTrip.x - x) < 1e-8 && Math.abs(roundTrip.y - y) < 1e-8,
        `${width}×${height} ${x},${y}`,
      );
    }
    for (const [x, y] of [
      [-100, -100],
      [width + 100, height + 100],
    ]) {
      const p = canvas.fromScreen(x, y, width, height);
      assert.ok(p.x >= 0 && p.x <= 1250 && p.y >= 0 && p.y <= 826);
    }
  }
});
function pageDefinition(name, info, wxExtra = {}) {
  const vm = require("node:vm"),
    { createRequire } = require("node:module");
  let definition;
  const filename = path.join(__dirname, "../pages", name, "index.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    Page: (d) => (definition = d),
    require: createRequire(filename),
    wx: { getWindowInfo: () => info, ...wxExtra },
    console,
    Math,
    Number,
    Map,
    Set,
    JSON,
    Promise,
    setTimeout,
    clearTimeout,
  });
  return definition;
}
test("focused board recovers natural available height after previous shrink without accumulating shrink", () => {
  const info = {
      windowWidth: 320,
      windowHeight: 568,
      screenHeight: 568,
      safeArea: { bottom: 548 },
    },
    d = pageDefinition("tactic-board", info);
  const page = {
    ...d,
    data: {
      ...d.data,
      editing: true,
      canvasWidth: 304,
      canvasHeight: (304 * 1250) / 826,
    },
    setData(v, cb) {
      Object.assign(this.data, v);
      cb?.();
    },
    touchCancel() {},
    draw() {},
  };
  const small = page.fitEditingSize(530, 548, 304);
  assert.ok(small.canvasHeight <= 18);
  Object.assign(page.data, small);
  const recovered = page.fitEditingSize(100, 548, 304);
  assert.ok(
    recovered.canvasHeight > 300,
    "fit must use natural dimensions rather than prior shrunken height",
  );
  assert.ok(recovered.canvasHeight <= 428);
  assert.ok(recovered.canvasWidth <= 304);
});
test("focus toggles retain unapplied compose draft and cancel current gesture only", () => {
  const d = pageDefinition("tactic-compose", {
    windowWidth: 320,
    windowHeight: 568,
  });
  const model = {
      board: { pieces: [{ pieceId: "p", x: 1, y: 2 }], markings: [] },
    },
    commands = [
      { type: "update-stage", stageNumber: 0, patch: { title: "saved draft" } },
    ];
  let cancelled = 0;
  const page = {
    ...d,
    data: {
      ...d.data,
      stageTitle: "unapplied title",
      label: "unapplied label",
    },
    _model: model,
    _commands: commands,
    allowed: () => true,
    touchCancel: () => cancelled++,
    resize() {},
    draw() {},
    setData(v, cb) {
      Object.assign(this.data, v);
      cb?.();
    },
  };
  const before = JSON.stringify(model);
  page.toggleFocus();
  page.toggleFocus();
  assert.equal(page.data.stageTitle, "unapplied title");
  assert.equal(page.data.label, "unapplied label");
  assert.equal(JSON.stringify(model), before);
  assert.equal(page._commands, commands);
  assert.equal(cancelled, 2);
});
test("expanded native map yields to business modal overlay", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../pages/manage-venue/index.wxml"),
    "utf8",
  );
  const tag = source.match(/<map\b[^>]*>/)?.[0] || "";
  assert.match(tag, /hidden="{{businessUiBlocking}}"/);
});
test("queued canvas measurement cannot mutate hidden overlay state after a picker opens", () => {
  for (const name of ["tactic-board", "tactic-compose", "tactic-setup"]) {
    const ticks = [];
    let changed = 0,
      rendered = 0;
    const query = {
      in() {
        return this;
      },
      select() {
        return this;
      },
      fields() {
        return this;
      },
      exec(cb) {
        cb([
          {
            top: 80,
            node: {
              getContext() {
                rendered++;
                return { scale() {} };
              },
            },
          },
        ]);
      },
    };
    const d = pageDefinition(
      name,
      { windowWidth: 320, windowHeight: 568, pixelRatio: 1 },
      { nextTick: (fn) => ticks.push(fn), createSelectorQuery: () => query },
    );
    const page = {
      ...d,
      data: {
        ...d.data,
        loading: false,
        hasDemo: true,
        businessUiBlocking: false,
      },
      _model: { board: { pieces: [], markings: [] } },
      _tactic: {},
      _formations: [{}],
      _epoch: 1,
      _generation: 1,
      plan: () => ({ preview: { pieces: [], markings: [] } }),
      setData() {
        changed++;
      },
      paint() {
        rendered++;
      },
    };
    page.draw();
    page.data.businessUiBlocking = true;
    ticks.forEach((fn) => fn());
    assert.equal(changed, 0, name);
    assert.equal(rendered, 0, name);
  }
});
