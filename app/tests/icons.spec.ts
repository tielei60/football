import { test, expect } from "./fixtures";

test("checked-in SVG icons retain symbols, stroke attributes and local definition references", async ({ page }) => {
  await page.goto("/club");
  const sprite = page.locator("#football-icon-sprite");
  await expect(sprite).toHaveCount(1);
  expect(await sprite.locator("symbol").count()).toBe(25);
  await expect(sprite.locator("#icon-arrow")).toHaveAttribute("viewBox", "0 0 24 24");
  await expect(sprite.locator("#icon-arrow")).toHaveAttribute("fill", "none");
  await expect(sprite.locator("#icon-arrow")).toHaveAttribute("stroke", "currentColor");
  await expect(sprite.locator("#icon-rectangle path")).toHaveCount(1);
  expect(
    await sprite.evaluate((root) => {
      const all = Array.from(root.querySelectorAll("*"));
      const ids = all.filter((element) => element.id).map((element) => element.id);
      return (
        new Set(ids).size === ids.length &&
        all.every((element) =>
          Array.from(element.attributes).every((attribute) =>
            Array.from(attribute.value.matchAll(/url\(#([^)]*)\)/g)).every(
              (match) => root.querySelector(`[id="${match[1]}"]`) !== null
            )
          )
        )
      );
    })
  ).toBeTruthy();
});
