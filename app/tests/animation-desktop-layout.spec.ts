import { openAnimationDetails } from "./animation-editor";
import { selectUiOption } from "./ui-select";
import { mkdir } from "node:fs/promises";
import { test, expect } from "./tactical-fixtures";

test("1180 by 757 desktop animation retains a usable pitch and exposes eight-a-side preset restriction", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 757 });
  await page.goto("/board");
  await expect(page.locator(".roster-item").first()).toBeVisible();
  await selectUiOption(page.getByRole("combobox", { name: "比赛人数", exact: true }), "7");
  await expect(page.getByRole("button", { name: "动态演示", exact: true })).toBeDisabled();
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs += 1;
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  const canvas = page.locator("svg#field");
  const box = await canvas.boundingBox();
  expect(box!.width).toBeGreaterThan(450);
  expect(box!.height).toBeGreaterThanOrEqual(320);
  const workspace = page.getByRole("region", { name: "战术画布", exact: true });
  expect(await workspace.evaluate((el) => getComputedStyle(el).overflowY)).toBe("hidden");
  await expect(page.locator(".timeline-transport")).toBeInViewport({ ratio: 1 });
  const presets = page.getByRole("combobox", { name: "演示场景", exact: true });
  await expect(presets).toBeDisabled();
  await expect(presets).toContainText("预置演示仅限 8 人制");
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  await openAnimationDetails(page);
  await expect(page.getByRole("spinbutton", { name: "当前帧" })).toHaveValue("2");
  await openAnimationDetails(page);
  await page.getByRole("textbox", { name: "步骤名称" }).fill("七人制自定义前插");
  expect(dialogs).toBe(0);
  await expect(page.getByRole("dialog", { name: "请确认操作" })).toHaveCount(0);
  await workspace.evaluate((el) => {
    el.scrollTo({ top: 0 });
  });
  await mkdir("test-results/visual-review", { recursive: true });
  await page.screenshot({ path: "test-results/visual-review/animation-desktop-1180x757.png" });
  await page.getByRole("button", { name: "返回战术板", exact: true }).click();
  await selectUiOption(page.getByRole("combobox", { name: "比赛人数", exact: true }), "8");
  await expect(page.getByRole("button", { name: "动态演示", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "演示场景", exact: true })).toBeEnabled();
});
