import { test, expect } from "./fixtures";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
]) {
  test(`portrait workspace keeps pitch visible across operations at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/board");
    await expect(page.locator(".board")).toHaveClass(/compact-workspace/);
    await expect(page.getByRole("button", { name: "阵容", exact: true })).toHaveAttribute("aria-pressed", "false");
    const pitch = page.locator("#field");
    const pitchBefore = await pitch.boundingBox();
    const pitchName = page.locator("#players .player-name").first();
    const playerName = (await pitchName.textContent())!.trim();
    await pitchName.click();
    await expect(page.getByRole("button", { name: `${playerName} 队员详情`, exact: true })).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    await page.getByRole("button", { name: `${playerName} 队员详情`, exact: true }).click();
    const last = page.locator(".roster-item").last();
    await last.getByRole("button", { name: "上场", exact: true }).click();
    await expect(last.getByRole("button", { name: "下场", exact: true })).toBeVisible();
    expect(await pitch.boundingBox()).toEqual(pitchBefore);
    await page.screenshot({ path: `test-results/portrait-roster-${viewport.width}.png` });
    await page.getByRole("button", { name: "绘图", exact: true }).click();
    for (const name of ["选择 (V)", "绘制跑位/传球/区域", "橡皮擦", "导出 PNG"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeInViewport();
    }
    await page.getByRole("button", { name: "橡皮擦", exact: true }).click();
    await expect(page.getByRole("button", { name: "橡皮擦", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "跑位线", exact: true }).click();
    const fieldBox = (await page.locator("#board-area").boundingBox())!;
    await page.mouse.move(fieldBox.x + fieldBox.width * 0.65, fieldBox.y + fieldBox.height * 0.35);
    await page.mouse.down();
    await page.mouse.move(fieldBox.x + fieldBox.width * 0.8, fieldBox.y + fieldBox.height * 0.55, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator("#drawings > *")).not.toHaveCount(0);
    await page.screenshot({ path: `test-results/portrait-drawing-${viewport.width}.png` });
    await page.getByRole("button", { name: "动画", exact: true }).click();
    await page.getByRole("button", { name: "添加帧", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "当前帧" })).toHaveValue("2");
    await page.getByRole("button", { name: "播放动画", exact: true }).click();
    await expect(page.getByRole("button", { name: "暂停动画", exact: true })).toBeVisible();
    expect(await pitch.boundingBox()).toEqual(pitchBefore);
    await page.screenshot({ path: `test-results/portrait-animation-${viewport.width}.png` });
    await page.getByRole("button", { name: "阵容", exact: true }).click();
    await expect(page.getByRole("button", { name: "暂停动画", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "动画", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "当前帧" })).toHaveValue("2");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if (viewport.width === 768) {
      await page.getByRole("button", { name: "阵容", exact: true }).click();
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(page.locator(".board")).not.toHaveClass(/compact-workspace/);
      await expect(page.locator(".roster-panel")).toBeVisible();
      await page.screenshot({ path: "test-results/tablet-landscape.png" });
    }
  });
}

test("small phone keeps menus, lineup and fullscreen usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/board");
  await expect(page.getByRole("button", { name: "保存战术", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "更多设置", exact: true }).click();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await expect(page.getByRole("button", { name: "更多设置", exact: true })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "关闭战术库", exact: true }).click();
  await page.getByRole("button", { name: "阵容", exact: true }).click();
  const list = page.getByRole("list", { name: "队员列表", exact: true });
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.locator(".roster-item").last()).toBeInViewport();
  await page.getByRole("button", { name: "收起操作面板", exact: true }).click();
  await page.locator(".view-controls").getByRole("button", { name: "全屏", exact: true }).click();
  await page.locator(".view-controls").getByRole("button", { name: "退出全屏", exact: true }).click();
  await expect(page.getByRole("button", { name: "阵容", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.screenshot({ path: "test-results/small-phone.png" });
});
