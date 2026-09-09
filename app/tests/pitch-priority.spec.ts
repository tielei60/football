import { test, expect } from "./fixtures";

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 768, height: 1024 },
]) {
  test(`pitch is primary and panels are dismissible at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/board");
    await expect(page.getByRole("searchbox", { name: "搜索队员" })).toBeHidden();
    const pitch = page.locator("#field");
    const before = (await pitch.boundingBox())!;
    expect(before.height).toBeGreaterThan(viewport.height * 0.7);
    expect((await page.locator(".pitch-workspace").boundingBox())!.height).toBeGreaterThan(viewport.height * 0.8);
    const area = (await page.locator("#board-area").boundingBox())!;
    expect(area.width).toBeGreaterThan(viewport.width * 0.68);
    expect((await page.locator(".workspace-header").boundingBox())!.height).toBeLessThanOrEqual(64);
    await page.screenshot({ path: `test-results/pitch-primary-${viewport.width}.png` });
    const roster = page.getByRole("button", { name: "阵容", exact: true });
    await roster.click();
    await expect(roster).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("searchbox", { name: "搜索队员" }).fill("刘");
    await page.getByRole("button", { name: "收起操作面板", exact: true }).click();
    await expect(page.getByRole("searchbox", { name: "搜索队员" })).toBeHidden();
    expect(await pitch.boundingBox()).toEqual(before);
    await roster.click();
    await expect(page.getByRole("searchbox", { name: "搜索队员" })).toHaveValue("刘");
    await page.screenshot({ path: `test-results/pitch-roster-sheet-${viewport.width}.png` });
    await roster.click();
    await expect(roster).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "绘图", exact: true }).click();
    await page.getByRole("button", { name: "跑位线", exact: true }).click();
    await page.getByRole("button", { name: "收起操作面板", exact: true }).click();
    await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width * 0.4, area.y + area.height * 0.4, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator("#drawings > *")).not.toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}
