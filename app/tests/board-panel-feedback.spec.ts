import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test, expect } from "./tactical-fixtures";

const history = (page: Page) =>
  page.evaluate(async () => {
    const { useHistoryStore } = await import("../src/stores/historyStore.ts");
    const h = useHistoryStore();
    return { undo: h.undoStack.length, redo: h.redoStack.length };
  });

test("coaching focus preserves redo; only the first changed input in a session records history", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "训练计划", exact: true }).click();
  const objective = page.getByRole("textbox", { name: "训练目标", exact: true });
  await objective.fill("初次编辑");
  await objective.blur();
  await page.evaluate(async () => {
    const { useHistory } = await import("../src/composables/useHistory.ts");
    useHistory().handleUndo();
  });
  const before = await history(page);
  expect(before.redo).toBeGreaterThan(0);
  await objective.focus();
  await objective.blur();
  await expect.poll(() => history(page)).toEqual(before);
  await objective.fill("真正编辑");
  await objective.pressSequentially("继续输入");
  expect(await history(page)).toEqual({ undo: before.undo + 1, redo: 0 });
  await objective.blur();
  await page.evaluate(async () => (await import("../src/composables/useHistory.ts")).useHistory().handleUndo());
  await expect(objective).toHaveValue("");
  const restored = await history(page);
  const duration = page.getByRole("spinbutton", { name: "训练时长（分钟）", exact: true });
  await duration.focus();
  await duration.fill(await duration.inputValue());
  await duration.blur();
  expect(await history(page)).toEqual(restored);
});

async function seed(request: import("@playwright/test").APIRequestContext, title: string) {
  const response = await request.post("/api/tactics", {
    data: {
      tactic: {
        title,
        tags: [],
        favorite: false,
        formationName: null,
        board: { pieces: [], markings: [], trainingPlan: {} },
        thumbnail: null,
      },
      note: "隔离测试初始版",
    },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).tacticId;
}

test("open provides pending feedback, blocks duplicate activation, and failed reads retry without losing the draft", async ({
  page,
  request,
}) => {
  const id = await seed(request, "读取反馈演练");
  await page.goto("/board");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const title = page.locator(".save-box").getByLabel("战术名称", { exact: true });
  await title.fill("保留草稿");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await page.route(`**/api/tactics/${id}`, async (route) => {
    reads++;
    await gate;
    await route.fulfill({ status: 503, json: { error: "模拟读取暂不可用" } });
  });
  const open = page.locator(".tactic-item").getByRole("button", { name: "打开", exact: true });
  try {
    await open.click();
    await expect(open).toBeDisabled();
    await expect(page.locator(".tactics-drawer").getByRole("status")).toContainText("打开战术中");
    await open.dispatchEvent("click");
    await expect.poll(() => reads).toBe(1);
  } finally {
    release();
  }
  await expect(page.locator(".tactics-drawer .panel-error")).toContainText("战术服务暂时不可用，请稍后重试");
  await expect(title).toHaveValue("保留草稿");
  await page.unroute(`**/api/tactics/${id}`);
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(title).toHaveValue("读取反馈演练");
  await expect(open).toBeEnabled();
});

test("late history replies cannot reopen a collapsed or switched history, and failures have local retry", async ({
  page,
  request,
}) => {
  const first = await seed(request, "历史 A");
  await seed(request, "历史 B");
  await page.goto("/board");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const a = page.locator(".tactic-item").filter({ has: page.getByText("历史 A", { exact: true }) });
  const b = page.locator(".tactic-item").filter({ has: page.getByText("历史 B", { exact: true }) });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived = false;
  await page.route(`**/api/tactics/${first}/versions`, async (route) => {
    arrived = true;
    await gate;
    await route.fulfill({ status: 503, json: { error: "旧历史请求失败" } });
  });
  try {
    await a.getByRole("button", { name: "版本历史", exact: true }).click();
    await expect.poll(() => arrived).toBe(true);
    await expect(a.getByRole("status")).toContainText("读取历史中");
    await b.getByRole("button", { name: "版本历史", exact: true }).click();
    await expect(b.getByRole("button", { name: "版本历史", exact: true })).toHaveAttribute("aria-expanded", "true");
  } finally {
    release();
  }
  await expect(b.locator(".version-item")).toHaveCount(1);
  await expect(a.getByRole("button", { name: "版本历史", exact: true })).toHaveAttribute("aria-expanded", "false");
  await a.getByRole("button", { name: "版本历史", exact: true }).click();
  await expect(a.getByRole("alert")).toContainText("战术服务暂时不可用，请稍后重试");
  await page.unroute(`**/api/tactics/${first}/versions`);
  await a.getByRole("button", { name: "重试历史读取", exact: true }).click();
  await expect(a.locator(".version-item")).toHaveCount(1);
  await page.getByRole("button", { name: "关闭战术库", exact: true }).click();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await expect(a.getByRole("button", { name: "版本历史", exact: true })).toHaveAttribute("aria-expanded", "false");
});

test("empty backup uses in-app feedback and filter buttons expose pressed state", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "备份全部", exact: true }).click();
  await expect(page.getByText("战术库是空的，无需备份", { exact: true })).toBeVisible();
  expect(dialogs).toEqual([]);
  const filters = page.locator(".tag-row.filter");
  await expect(filters.getByRole("button", { name: "全部", exact: true })).toHaveAttribute("aria-pressed", "true");
  const tag = filters.locator("button").nth(2);
  await tag.click();
  await expect(tag).toHaveAttribute("aria-pressed", "true");
  await expect(filters.getByRole("button", { name: "全部", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("failed import offers verification instead of automatically replaying the write", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  let writes = 0;
  await page.route("**/api/tactics", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    return route.fulfill({ status: 503, json: { error: "模拟响应失败" } });
  });
  await page
    .locator('.save-box input[type="file"]')
    .first()
    .setInputFiles({
      name: "fictional.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ title: "不可自动重复导入", tags: [], board: { pieces: [], markings: [], trainingPlan: {} } })
      ),
    });
  const error = page.locator(".tactics-drawer .panel-error").filter({ hasText: "写入可能已完成" });
  await expect(error).toBeVisible();
  await expect(error.getByRole("button", { name: "重试读取", exact: true })).toHaveCount(0);
  await error.getByRole("button", { name: "刷新战术库核对", exact: true }).click();
  await expect(page.getByRole("button", { name: "导入JSON", exact: true })).toBeEnabled();
  expect(writes).toBe(1);
});

test("canceling new-board confirmation returns focus to its enabled trigger", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const trigger = page.getByRole("button", { name: "新建空白板", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "请确认操作", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toHaveAttribute("aria-disabled", "false");
  await expect(trigger).toBeFocused();
});

test("rollback read failure after its backup never offers a pure-read replay or writes a second backup", async ({
  page,
  request,
}) => {
  const id = await seed(request, "回滚写入核对");
  await page.goto("/board");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const card = page.locator(".tactic-item").filter({ has: page.getByText("回滚写入核对", { exact: true }) });
  await card.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page.locator(".save-box").getByLabel("战术名称", { exact: true })).toHaveValue("回滚写入核对");
  await expect(card.getByRole("button", { name: "打开", exact: true })).toBeEnabled();
  await card.getByRole("button", { name: "版本历史", exact: true }).click();
  await expect(card.locator(".version-item")).toHaveCount(1);
  const before = await (await request.get(`/api/tactics/${id}/versions`)).json();
  let backupWrites = 0;
  await page.route(`**/api/tactics/${id}/versions`, async (route) => {
    if (route.request().method() === "POST") {
      backupWrites++;
      await route.continue();
    } else {
      await route.fulfill({ status: 503, json: { error: "备份后版本读取失败" } });
    }
  });
  await card.getByRole("button", { name: "回滚", exact: true }).click();
  const error = page.locator(".panel-error");
  await expect(error).toContainText("回滚前自动备份可能已保存");
  await expect(error.getByRole("button", { name: "重试读取", exact: true })).toHaveCount(0);
  expect(backupWrites).toBe(1);
  await error.getByRole("button", { name: "刷新战术库核对", exact: true }).click();
  await expect(card.getByRole("button", { name: "打开", exact: true })).toBeEnabled();
  expect(backupWrites).toBe(1);
  const after = await (await request.get(`/api/tactics/${id}/versions`)).json();
  expect(after).toHaveLength(before.length + 1);
  expect(after.filter((v: { note: string }) => v.note === "回滚前自动备份")).toHaveLength(1);
  await page.unroute(`**/api/tactics/${id}/versions`);
});

test("coaching duration reconciles invalid native values even when normalization leaves the model unchanged", async ({
  page,
}) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "训练计划", exact: true }).click();
  const duration = page.getByRole("spinbutton", { name: "训练时长（分钟）", exact: true });
  await duration.fill("");
  await duration.blur();
  await expect(duration).toHaveValue("15");
  await duration.fill("181");
  await duration.blur();
  await expect(duration).toHaveValue("180");
  await duration.fill("181");
  await duration.blur();
  await expect(duration).toHaveValue("180");
  await duration.fill("0");
  await duration.blur();
  await expect(duration).toHaveValue("1");
  await duration.fill("0");
  await duration.blur();
  await expect(duration).toHaveValue("1");
  await expect(page.locator("#coaching-duration-feedback")).toContainText("1–180 分钟");
});

test("drawer Ctrl+S saves its own metadata and cannot duplicate an already pending save", async ({ page, request }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const form = page.locator(".save-box");
  const title = form.getByLabel("战术名称", { exact: true });
  await title.fill("抽屉快捷保存元信息");
  await form.getByLabel("对手", { exact: true }).fill("虚构快捷保存对手");
  await form.getByLabel("比分", { exact: true }).fill("4 : 2");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route("**/api/tactics", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    await gate;
    return route.continue();
  });
  try {
    await title.press("Control+s");
    await expect.poll(() => writes).toBe(1);
    await expect(form.getByRole("button", { name: "保存中…", exact: true })).toBeDisabled();
    await title.press("Control+s");
    expect(writes).toBe(1);
  } finally {
    release();
  }
  await expect(form.getByRole("button", { name: "保存当前战术", exact: true })).toBeEnabled();
  const records = await (await request.get("/api/tactics")).json();
  expect(records).toHaveLength(1);
  expect(records[0].title).toBe("抽屉快捷保存元信息");
  expect(records[0].match).toEqual({ opponent: "虚构快捷保存对手", score: "4 : 2" });
  expect(writes).toBe(1);
});

test("backup uses current server data even when the visible library cache is empty", async ({ page, request }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await expect(page.locator(".tactic-item")).toHaveCount(0);
  await seed(request, "其他标签新增的虚构战术");
  await expect(page.locator(".tactic-item")).toHaveCount(0);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "备份全部", exact: true }).click();
  const file = await downloaded;
  const payload = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(payload.tactics).toHaveLength(1);
  expect(payload.tactics[0].title).toBe("其他标签新增的虚构战术");
  expect(payload.versions).toHaveLength(1);
  await expect(page.getByText("战术库是空的，无需备份", { exact: true })).toHaveCount(0);
});

test("header save owns a shared lock before a newly opened drawer can save again", async ({ page, request }) => {
  await page.goto("/board");
  let writes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/tactics", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    await gate;
    return route.continue();
  });
  try {
    await page.getByRole("button", { name: "保存战术", exact: true }).click();
    await expect.poll(() => writes).toBe(1);
    await page.getByRole("button", { name: "战术库", exact: true }).click();
    const save = page.getByRole("button", { name: "保存当前战术", exact: true });
    await expect(save).toBeDisabled();
    await save.dispatchEvent("click");
    await page.locator(".save-box").getByLabel("战术名称", { exact: true }).fill("等待保存期间的新标题");
    await page.locator(".save-box").getByLabel("对手", { exact: true }).fill("等待期间的新对手");
    await page.locator(".save-box").getByLabel("战术名称", { exact: true }).press("Control+s");
    const duplicate = await page.evaluate(async () => {
      const { useTacticsStore } = await import("../src/stores/tacticsStore.ts");
      try {
        await useTacticsStore().saveTactic("不应创建", []);
        return "unexpected";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(duplicate).toBe("战术正在保存，请稍后");
    expect(writes).toBe(1);
  } finally {
    release();
  }
  await expect(page.getByRole("button", { name: "保存当前战术", exact: true })).toBeEnabled();
  expect(await (await request.get("/api/tactics")).json()).toHaveLength(1);
  await expect(page.locator(".save-box").getByLabel("战术名称", { exact: true })).toHaveValue("等待保存期间的新标题");
  await expect(page.locator(".save-box").getByLabel("对手", { exact: true })).toHaveValue("等待期间的新对手");
  expect(writes).toBe(1);
});

test("failed tactic save releases the shared lock for a deliberate retry", async ({ page, request }) => {
  await page.goto("/board");
  await page.route("**/api/tactics", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    return route.fulfill({ status: 503, json: { error: "测试保存失败" } });
  });
  await page.getByRole("button", { name: "保存战术", exact: true }).click();
  await expect(page.locator(".el-message").filter({ hasText: "战术服务暂时不可用，请稍后重试" })).toBeVisible();
  expect(
    await page.evaluate(async () => (await import("../src/stores/tacticsStore.ts")).useTacticsStore().savingTactic)
  ).toBe(false);
  await page.unroute("**/api/tactics");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.locator(".save-box").getByLabel("战术名称", { exact: true }).fill("重试恢复成功");
  await page.getByRole("button", { name: "保存当前战术", exact: true }).click();
  await expect(page.getByText("战术已保存", { exact: true })).toBeVisible();
  const records = await (await request.get("/api/tactics")).json();
  expect(records).toHaveLength(1);
  expect(records[0].title).toBe("重试恢复成功");
});
