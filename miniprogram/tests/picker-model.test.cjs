const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const m = require("../utils/picker-model");
test("selector returns original index including zero and empty ranges cannot confirm", () => {
  let s = m.create({
    range: [{ name: "甲" }, { name: "乙" }],
    rangeKey: "name",
    value: 0,
  });
  assert.equal(m.result(s), 0);
  assert.equal(s.rows[1].label, "乙");
  s = m.select(s, 1);
  assert.equal(m.result(s), 1);
  assert.equal(m.result(m.create({ range: [] })), null);
  assert.equal(m.result(m.select(s, 99)), 1);
});
test("calendar leap years and day boundaries use local calendar, cancel draft remains external", () => {
  const config = {
    mode: "date",
    value: "2024-02-28",
    start: "2024-02-10",
    end: "2024-03-02",
  };
  let s = m.create(config);
  assert.equal(s.days.filter((x) => x.label).length, 29);
  assert.equal(s.weekdays[0], "一");
  s = m.select(s, "2024-02-29");
  assert.equal(m.result(s), "2024-02-29");
  assert.equal(config.value, "2024-02-28");
  assert.equal(m.result(m.select(s, "2024-02-30")), "2024-02-29");
  assert.equal(m.result(m.select(s, "2024-03-03")), "2024-02-29");
  const moved = m.navigate(s, 1);
  assert.equal(moved.viewMonth, 3);
  assert.equal(moved.draft, s.draft);
  assert.equal(
    m.create({ mode: "date", value: "2100-02-01" }).days.filter((x) => x.label)
      .length,
    28,
  );
});
test("year/month and header jump preserve formats and draft", () => {
  let s = m.create({
    mode: "date",
    fields: "year",
    value: "2026",
    start: "2020",
    end: "2030",
  });
  s = m.select(s, "2027");
  assert.equal(m.result(s), "2027");
  assert.equal(typeof m.result(s), "string");
  assert.equal(m.jump(s, 2029).draft, "2027");
  assert.equal(m.jump(s, 2031), s);
  s = m.create({
    mode: "date",
    fields: "month",
    value: "2026-11",
    start: "2026-03",
    end: "2027-04",
  });
  assert.equal(m.result(m.select(s, "2027-04")), "2027-04");
  assert.equal(m.result(m.select(s, "2027-05")), "2026-11");
});
test("time minute limits and hour clamping never permit out of range commits", () => {
  let s = m.create({
    mode: "time",
    value: "09:20",
    start: "09:15",
    end: "10:10",
  });
  s = m.select(s, "hour:10");
  assert.equal(m.result(s), "10:10");
  assert.equal(m.result(m.select(s, "minute:11")), "10:10");
  assert.equal(m.result(m.select(s, "hour:08")), "10:10");
  assert.equal(
    m.result(m.create({ mode: "time", start: "23:00", end: "01:00" })),
    null,
  );
  assert.equal(m.result(m.create({ mode: "date", start: "2024-02-30" })), null);
});
test("kickoff picker offers five-minute steps while preserving existing off-step times", () => {
  let s = m.create({ mode: "time", minuteStep: 5 }, new Date(2026, 0, 1, 20, 16));
  assert.equal(m.result(s), "20:15");
  assert.deepEqual(s.minutes.map((option) => option.label), ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  assert.equal(m.result(m.select(s, "minute:16")), "20:15");
  s = m.create({ mode: "time", minuteStep: 5, value: "20:16" });
  assert.equal(m.result(s), "20:16");
  assert.equal(s.minutes.find((option) => option.label === "16").selected, true);
  assert.equal(m.result(m.select(s, "minute:20")), "20:20");
});
function triggerHarness() {
  let definition,
    resolve,
    token = "A";
  const events = [];
  let props = {
    mode: "selector",
    range: ["甲", "乙"],
    rangeKey: "",
    value: 0,
    start: "",
    end: "",
    fields: "day",
    disabled: false,
    title: "",
  };
  const bridge = {
    request: () => ({
      requestId: "x",
      promise: new Promise((r) => (resolve = r)),
    }),
    cancel: () => resolve?.({ aborted: true }),
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../components/business-picker/index.js"),
      "utf8",
    ),
    {
      Component: (d) => (definition = d),
      require: (id) =>
        id.includes("bridge") ? bridge : { getSession: () => ({ token }) },
    },
  );
  const c = {
    properties: props,
    data: {},
    setData(patch) {
      Object.assign(this.data, patch);
    },
    triggerEvent: (...e) => events.push(e),
    ...definition.methods,
  };
  definition.lifetimes.attached.call(c);
  return {
    c,
    events,
    resolve: (r) => resolve(r),
    setToken: (v) => (token = v),
    detach: () => definition.lifetimes.detached.call(c),
  };
}
test("trigger emits change only on confirmed stable props and preserves value type", async () => {
  const h = triggerHarness(),
    pending = h.c.open();
  h.resolve({ confirm: true, value: 0 });
  await pending;
  assert.equal(h.events[0][0], "change");
  assert.equal(h.events[0][1].value, 0);
});
test("trigger drops stale range, changed account, disabled and detached results", async () => {
  for (const kind of ["range", "account", "disabled", "detach"]) {
    const h = triggerHarness(),
      pending = h.c.open();
    if (kind === "range") h.c.properties.range = ["其他"];
    if (kind === "account") h.setToken("B");
    if (kind === "disabled") h.c.properties.disabled = true;
    if (kind === "detach") h.detach();
    h.resolve({ confirm: true, value: 1 });
    await pending;
    assert.equal(h.events.length, 0, kind);
  }
});
test("trigger cancellation never emits change", async () => {
  const h = triggerHarness(),
    pending = h.c.open();
  h.resolve({ confirm: false, cancel: true });
  await pending;
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0][0], "cancel");
});
test("bridge uses explicit page handler, prevents duplicate claims and resolves detached requests", async () => {
  let calls = 0,
    resolve;
  const explicit = { id: "owner" };
  const timers = new Map();
  let timerId = 0;
  const sandbox = {
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    module: { exports: {} },
    require: () => ({
      showPicker: (page) => {
        assert.equal(page, explicit);
        calls++;
        return new Promise((r) => (resolve = r));
      },
    }),
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../utils/business-picker-bridge.js"),
      "utf8",
    ),
    sandbox,
  );
  const bridge = sandbox.module.exports;
  const component = {
    triggerEvent: (name, detail) => {
      assert.equal(name, "pickeropen");
      bridge.open(explicit, { detail });
      bridge.open(explicit, { detail });
    },
  };
  const task = bridge.request(component, {});
  assert.equal(calls, 1);
  bridge.cancel(task.requestId);
  assert.equal((await task.promise).aborted, true);
  resolve({ confirm: true, value: 1 });
  const missing = bridge.request({ triggerEvent() {} }, {});
  for (const expire of timers.values()) expire();
  assert.equal((await missing.promise).aborted, true);
});

test("bridge accepts asynchronously dispatched owner events and clears abandonment timer", async () => {
  let dispatch,
    timeoutCleared = 0,
    showCount = 0;
  const sandbox = {
    module: { exports: {} },
    setTimeout,
    clearTimeout: (id) => {
      timeoutCleared++;
      clearTimeout(id);
    },
    require: () => ({
      showPicker: async () => {
        showCount++;
        return { confirm: true, value: 2 };
      },
    }),
  };
  vm.runInNewContext(
    fs.readFileSync(
      path.join(__dirname, "../utils/business-picker-bridge.js"),
      "utf8",
    ),
    sandbox,
  );
  const bridge = sandbox.module.exports;
  const task = bridge.request(
    {
      triggerEvent(name, detail) {
        dispatch = () => bridge.open({ id: "explicit-owner" }, { detail });
      },
    },
    {},
  );
  assert.equal(showCount, 0);
  await new Promise((r) => setTimeout(r, 10));
  await dispatch();
  const result = await task.promise;
  assert.equal(result.confirm, true);
  assert.equal(result.value, 2);
  assert.equal(showCount, 1);
  assert.equal(timeoutCleared, 1);
});

test("trigger accessible label includes current option or date/time and honors explicit title", () => {
  const h = triggerHarness();
  assert.equal(h.c.data.defaultLabel, "选择选项，当前甲");
  Object.assign(h.c.properties, {
    range: [{ name: "中场" }],
    rangeKey: "name",
    value: 0,
  });
  h.c.updateLabel();
  assert.equal(h.c.data.defaultLabel, "选择选项，当前中场");
  for (const [mode, fields, value, expected] of [
    ["date", "year", "2026", "选择年份，当前2026"],
    ["date", "day", "2026-11-13", "选择日期，当前2026-11-13"],
    ["time", "day", "19:30", "选择时间，当前19:30"],
  ]) {
    Object.assign(h.c.properties, { mode, fields, value });
    h.c.updateLabel();
    assert.equal(h.c.data.defaultLabel, expected);
  }
  h.c.properties.title = "开球时间";
  h.c.updateLabel();
  assert.equal(h.c.data.defaultLabel, "开球时间，当前19:30");
  h.c.properties.title = "";
  h.c.properties.value = "";
  h.c.updateLabel();
  assert.equal(h.c.data.defaultLabel, "选择时间，当前未选择");
});
