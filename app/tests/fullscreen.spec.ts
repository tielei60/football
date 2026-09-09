import { test, expect } from "./fixtures";

test("footer fullscreen expands the pitch and both controls stay synchronized", async ({ page }) => {
  await page.goto("/board");
  const footer = page.locator(".view-controls");
  const before = await page.locator("#field").boundingBox();
  await footer.getByRole("button", { name: "全屏", exact: true }).click();
  await expect(page.locator(".board")).toHaveClass(/workspace-fullscreen/);
  await expect(page.locator(".workspace-header")).toBeHidden();
  await expect(page.getByRole("button", { name: "退出全屏", exact: true })).toHaveCount(2);
  await expect.poll(async () => (await page.locator("#field").boundingBox())!.width).toBeGreaterThan(before!.width);
  await page.screenshot({ path: "test-results/fullscreen-desktop.png" });
  await footer.getByRole("button", { name: "退出全屏", exact: true }).click();
  await expect(page.locator(".workspace-header")).toBeVisible();
  await expect(page.locator(".board")).not.toHaveClass(/workspace-fullscreen/);
});

test("mobile fullscreen works when native fullscreen is denied and Escape restores the page", async ({ page }) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new Error("Not allowed"));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/board");
  const footer = page.locator(".view-controls");
  await footer.getByRole("button", { name: "全屏", exact: true }).click();
  await expect(page.locator(".workspace-header")).toBeHidden();
  await expect(footer.getByRole("button", { name: "退出全屏", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/fullscreen-mobile.png" });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(footer.getByRole("button", { name: "退出全屏", exact: true })).toBeInViewport();
  await expect(page.locator("#field")).toBeInViewport();
  await page.screenshot({ path: "test-results/fullscreen-landscape.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator(".workspace-header")).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("zoom limits give feedback and fit-pitch remains separate from fullscreen", async ({ page }) => {
  await page.goto("/board");
  await expect(page.getByRole("button", { name: "缩小", exact: true })).toBeDisabled();
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.getByRole("button", { name: "放大", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "适应全场", exact: true }).click();
  await expect(page.locator("#field")).toHaveAttribute("viewBox", "0 0 1250 826");
  await expect(page.locator(".workspace-header")).toBeVisible();
});
