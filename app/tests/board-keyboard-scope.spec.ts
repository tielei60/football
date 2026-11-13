import type { Page } from "@playwright/test";
import { openAnimationDetails } from "./animation-editor";
import { test, expect } from "./tactical-fixtures";

async function openAnimation(page: Page) {
  await page.goto("/board");
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  await openAnimationDetails(page);
}
const isPlaying = (page: Page) =>
  page.evaluate(
    async () => (await import("../../../../../../src/stores/animationStore.ts")).useAnimationStore().isPlaying
  );

test("Space in speed select and focused buttons belongs to the control, not global playback", async ({
  page,
  request,
}) => {
  await openAnimation(page);
  const speed = page.getByRole("combobox", { name: "播放速度", exact: true });
  await speed.focus();
  await page.keyboard.press("Space");
  await expect(speed).toHaveAttribute("aria-expanded", "true");
  expect(await isPlaying(page)).toBe(false);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  expect(await isPlaying(page)).toBe(false);
  await page.getByRole("button", { name: "保存动画", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await (await request.get("/api/tactics")).json()).length).toBe(1);
  expect(await isPlaying(page)).toBe(false);
});

test("canvas retains Space and arrow shortcuts while input editing and Ctrl+S retain their own behavior", async ({
  page,
  request,
}) => {
  await openAnimation(page);
  await page.locator(".pitch-workspace").focus();
  await page.keyboard.press("Space");
  expect(await isPlaying(page)).toBe(true);
  await page.keyboard.press("Space");
  expect(await isPlaying(page)).toBe(false);
  await page.keyboard.press("ArrowLeft");
  await openAnimationDetails(page);
  await expect(page.getByRole("spinbutton", { name: "当前帧" })).toHaveValue("1");
  await page.keyboard.press("ArrowRight");
  await openAnimationDetails(page);
  await expect(page.getByRole("spinbutton", { name: "当前帧" })).toHaveValue("2");
  await openAnimationDetails(page);
  const title = page.getByRole("textbox", { name: "步骤名称" });
  await title.fill("键盘 编辑");
  await title.press("Space");
  expect(await isPlaying(page)).toBe(false);
  await title.press("Control+s");
  await expect.poll(async () => (await (await request.get("/api/tactics")).json()).length).toBe(1);
});

test("confirmation dialogs block background shortcuts and workspace fields still support explicit save", async ({
  page,
  request,
}) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "训练计划", exact: true }).click();
  await page.getByRole("textbox", { name: "训练目标" }).fill("键盘保存目标");
  await page.getByRole("textbox", { name: "训练目标" }).press("Control+s");
  await expect.poll(async () => (await (await request.get("/api/tactics")).json()).length).toBe(1);
  await page.getByRole("button", { name: "关闭训练计划", exact: true }).click();
  await page.getByRole("button", { name: "清空画布", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "清空当前画布" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("t");
  await page.keyboard.press("Control+z");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "选择 (V)", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("handled, composing and contenteditable events do not leak to canvas single-letter shortcuts", async ({
  page,
}) => {
  await page.goto("/board");
  // Synthetic events are intentional here: native IME composition and prevented events cannot be produced by keyboard.press.
  await page.evaluate(() => {
    const handled = new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "t", isComposing: true, bubbles: true }));
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(editable);
    editable.dispatchEvent(new KeyboardEvent("keydown", { key: "t", bubbles: true }));
    editable.remove();
  });
  await expect(page.getByRole("button", { name: "选择 (V)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("t");
  await expect(page.getByRole("button", { name: "文字标注 (T)", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("v");
  await expect(page.getByRole("button", { name: "选择 (V)", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("focused toolbar buttons retain Ctrl/Cmd undo and redo without stealing their activation keys", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  await page.getByRole("button", { name: "文字标注 (T)", exact: true }).click();
  const box = (await page.locator("#field").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.73, box.y + box.height * 0.25);
  const text = page.locator("#field .text-drawing text");
  await expect(text).toHaveCount(1);
  await page.getByRole("button", { name: "选择 (V)", exact: true }).click();
  await page.keyboard.press("Control+z");
  await expect(text).toHaveCount(0);
  await page.keyboard.press("Control+y");
  await expect(text).toHaveCount(1);
  await page.keyboard.press("Meta+z");
  await expect(text).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+z");
  await expect(text).toHaveCount(1);
});

test("Escape closes an open select first and still exits fallback fullscreen from a focused button", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new Error("test fallback"));
  });
  await openAnimation(page);
  await page.locator(".view-controls").getByRole("button", { name: "全屏", exact: true }).click();
  await expect(page.locator(".board")).toHaveClass(/workspace-fullscreen/);
  const speed = page.getByRole("combobox", { name: "播放速度", exact: true });
  await speed.focus();
  await page.keyboard.press("Space");
  await expect(speed).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(speed).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".board")).toHaveClass(/workspace-fullscreen/);
  await page.locator(".view-controls").getByRole("button", { name: "退出全屏", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".board")).not.toHaveClass(/workspace-fullscreen/);
});
