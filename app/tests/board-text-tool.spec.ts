import type { Page } from "@playwright/test";
import { test, expect, authenticateAdmin } from "./tactical-fixtures";

async function placeText(page: Page) {
  await page.getByRole("button", { name: "文字标注 (T)", exact: true }).click();
  const field = page.locator("#field");
  const box = (await field.boundingBox())!;
  // A clear pitch position, away from the seeded home players and the tool rail.
  await page.mouse.click(box.x + box.width * 0.73, box.y + box.height * 0.25);
  await expect(field.locator(".text-drawing text")).toHaveText("双击编辑");
  await expect(page.getByRole("button", { name: "选择 (V)", exact: true })).toHaveAttribute("aria-pressed", "true");
}

test("text tool works with the initial shape and editing, undo, redo and refresh preserve text", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await placeText(page);
  const label = page.locator("#field .text-drawing text");
  await label.dblclick();
  await page.locator("#field .text-drawing input").fill("回归文字：保持阵型宽度");
  await page.locator("#field .text-drawing input").press("Enter");
  await expect(label).toHaveText("回归文字：保持阵型宽度");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(label).toHaveText("双击编辑");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(label).toHaveCount(0);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(label).toHaveText("双击编辑");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(label).toHaveText("回归文字：保持阵型宽度");
  await expect
    .poll(async () => {
      const { desk } = await (await request.get("/api/coaching-desk")).json();
      return desk?.board.markings.map((m: { kind: string; label: string }) => ({ kind: m.kind, label: m.label }));
    })
    .toContainEqual({ kind: "text", label: "回归文字：保持阵型宽度" });
  await page.reload();
  await expect(page.locator("#field .text-drawing text")).toHaveText("回归文字：保持阵型宽度");
});

[
  ["arrow", "箭头"],
  ["rectangle", "矩形"],
  ["ellipse", "椭圆"],
  ["line", "直线"],
  ["pen", "自由画笔"],
].forEach(([kind, name]) => {
  test(`text tool remains text after choosing ${kind}, without replacing the shape preference`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/board");
    await expect(page.locator("#field")).toBeVisible();
    await page.getByRole("button", { name: "绘制跑位/传球/区域", exact: true }).click();
    await page.getByRole("button", { name, exact: true }).click();
    await placeText(page);
    await page.getByRole("button", { name: "绘制跑位/传球/区域", exact: true }).click();
    await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "选择 (V)", exact: true }).click();
    await expect(page.locator("#field .text-drawing text")).toHaveText("双击编辑");
  });
});

test("edited text is stored in a tactic and loads in a fresh authenticated browser", async ({
  page,
  request,
  browser,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await placeText(page);
  await page.locator("#field .text-drawing text").dblclick();
  await page.locator("#field .text-drawing input").fill("跨浏览器文字战术");
  await page.locator("#field .text-drawing input").press("Enter");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.getByRole("textbox", { name: "战术名称", exact: true }).fill("文字工具持久化回归");
  await page.getByRole("button", { name: "保存当前战术", exact: true }).click();
  await expect(page.locator(".tactic-title", { hasText: "文字工具持久化回归" })).toBeVisible();
  const tactics = await (await request.get("/api/tactics")).json();
  const saved = tactics.find((t: { title: string }) => t.title === "文字工具持久化回归");
  expect(saved.board.markings).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "text", label: "跨浏览器文字战术" })])
  );
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    await authenticateAdmin(context.request, page.url());
    const fresh = await context.newPage();
    await fresh.goto(new URL("/board", page.url()).href);
    await expect(fresh.locator("#field")).toBeVisible();
    await fresh.getByRole("button", { name: "战术库", exact: true }).click();
    await fresh
      .locator(".tactic-item")
      .filter({ hasText: "文字工具持久化回归" })
      .getByRole("button", { name: "打开", exact: true })
      .click();
    if (await fresh.getByRole("button", { name: "关闭战术库", exact: true }).isVisible())
      await fresh.getByRole("button", { name: "关闭战术库", exact: true }).click();
    await expect(fresh.locator("#field .text-drawing text")).toHaveText("跨浏览器文字战术");
  } finally {
    await context.close();
  }
});
