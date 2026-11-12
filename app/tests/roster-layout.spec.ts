import { test, expect } from "./tactical-fixtures";

test("desktop roster scrolls independently and expanded mode exposes more players", async ({ page }) => {
  await page.goto("/board");
  const list = page.getByRole("list", { name: "队员列表", exact: true });
  const search = page.getByRole("searchbox", { name: "搜索队员" });
  await expect(page.locator(".roster-item")).toHaveCount(20);
  const searchBefore = await search.boundingBox();
  const visibleRows = () =>
    list.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return Array.from(element.children).filter((child) => {
        const rect = child.getBoundingClientRect();
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      }).length;
    });
  const compactCount = await visibleRows();
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const last = page.locator(".roster-item").last();
  await expect(last).toBeInViewport();
  await last.getByRole("button", { name: "上场", exact: true }).click();
  await expect(last.getByRole("button", { name: "下场", exact: true })).toBeVisible();
  expect((await search.boundingBox())!.y).toBe(searchBefore!.y);
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByRole("button", { name: "展开名单", exact: true }).click();
  await expect.poll(visibleRows).toBeGreaterThan(compactCount);
  await page.screenshot({ path: "test-results/roster-expanded.png" });
  await page.getByRole("button", { name: "收起名单", exact: true }).click();
  await page.getByRole("textbox", { name: "新队员姓名" }).fill("名单末尾测试");
  await page.getByRole("button", { name: "新增队员", exact: true }).click();
  await expect(page.getByRole("button", { name: "名单末尾测试 队员详情", exact: true })).toBeInViewport();
});

test("mobile roster scrolls below a stationary pitch and the final player remains actionable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/board");
  await page.getByRole("button", { name: "阵容", exact: true }).click();
  await expect(page.locator(".roster-item")).toHaveCount(20);
  const list = page.getByRole("list", { name: "队员列表", exact: true });
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  const pitchBefore = await page.locator("#field").boundingBox();
  const last = page.locator(".roster-item").last();
  await last.scrollIntoViewIfNeeded();
  await last.getByRole("button", { name: "上场", exact: true }).click();
  await expect(last.getByRole("button", { name: "下场", exact: true })).toBeVisible();
  expect(await page.locator("#field").boundingBox()).toEqual(pitchBefore);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/roster-mobile-bottom.png" });
});
