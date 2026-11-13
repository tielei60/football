import { mkdir } from "node:fs/promises";
import { test, expect } from "./tactical-fixtures";

/** Real routes and fictional fixtures, not the detached design prototype. */
for (const width of [1440, 390]) {
  test(`light club theme stays usable across real routes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await mkdir("test-results/visual-review", { recursive: true });
    for (const [path, name] of [
      ["/club", "matches"],
      ["/club/players", "players"],
      ["/club/statistics", "statistics"],
      ["/club/account", "account"],
      ["/about", "about"],
      ["/changelog", "changelog"],
    ]) {
      await page.goto(path);
      await expect(page.locator("h1").first(), `${name} route must render its heading`).toBeVisible();
      expect(pageErrors, `${name} route must not throw during rendering`).toEqual([]);
      const styles = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        return {
          brand: root.getPropertyValue("--color-brand").trim(),
          background: root.getPropertyValue("--color-bg").trim(),
          text: root.getPropertyValue("--color-text").trim(),
          focus: root.getPropertyValue("--color-focus").trim(),
          width: document.documentElement.scrollWidth,
        };
      });
      for (const token of [styles.brand, styles.background, styles.text, styles.focus]) expect(token).not.toBe("");
      expect(styles.width, `${name} must not create horizontal page overflow`).toBeLessThanOrEqual(width);
      for (const control of await page.getByRole("combobox").all()) {
        await expect(control).toHaveJSProperty("tagName", "BUTTON");
        await expect(control).toHaveAttribute("aria-haspopup", "listbox");
        await expect(control).toHaveAccessibleName(/\S/);
      }
      await page.screenshot({ path: `test-results/visual-review/theme-${name}-${width}.png`, fullPage: true });
    }
    if (width < 600) await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await page.getByRole("link", { name: "返回首页", exact: true }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.locator("h1")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
}

test("custom select is dismissed on navigation and reopening keeps current selection", async ({ page }) => {
  await page.goto("/club/statistics");
  const period = page.getByRole("combobox", { name: "统计周期", exact: true });
  await expect(period).toBeVisible();
  await period.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await period.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(period).toBeFocused();
  await period.click();
  await expect(page.getByRole("option", { selected: true })).toHaveCount(1);
  await page.getByRole("link", { name: "球员", exact: true }).click();
  await expect(page).toHaveURL(/\/club\/players$/);
  await expect(page.getByRole("listbox")).toHaveCount(0);
});
