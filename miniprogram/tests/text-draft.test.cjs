const test = require("node:test"),
  assert = require("node:assert/strict");
const { mergeText, replacementMessage } = require("../utils/text-draft");
test("三方文字合并：相同结果消冲突、重复刷新不丢未确认冲突", () => {
  assert.deepEqual(mergeText("旧", "草稿", "草稿", true), {
    value: "草稿",
    conflict: false,
  });
  assert.deepEqual(mergeText("新", "草稿", "新", true), {
    value: "草稿",
    conflict: true,
  });
  assert.deepEqual(mergeText("旧", "旧", "新"), {
    value: "新",
    conflict: false,
  });
  assert.deepEqual(mergeText("旧", "草稿", "旧"), {
    value: "草稿",
    conflict: false,
  });
  assert.match(replacementMessage("新".repeat(500), "草稿"), /节选/);
});
