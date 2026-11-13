import type { Page } from "@playwright/test";
import { test, expect } from "./tactical-fixtures";

async function point(page: Page, x: number, y: number) {
  return page.locator("#pitch-coordinate-space").evaluate(
    (el, p) => {
      const result = new DOMPoint(p.x, p.y).matrixTransform((el as SVGGraphicsElement).getScreenCTM()!);
      return { x: result.x, y: result.y };
    },
    { x, y }
  );
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const { useItemStore } = await import("../src/stores/itemStore.ts");
    const store = useItemStore();
    return { count: store.items.getAll().length, temporary: !!store.newDraggingItem };
  });
}
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  await expect(page.locator(".palette circle").first()).toBeVisible();
});

test("palette release outside clears preview and cannot place on a later click", async ({ page }) => {
  const before = await state(page);
  const ball = page.locator(".palette image");
  await ball.hover();
  await page.mouse.down();
  expect((await state(page)).temporary).toBe(true);
  await page.mouse.move(5, 5);
  await page.mouse.up();
  expect(await state(page)).toEqual(before);
  const inside = await point(page, 900, 200);
  await page.mouse.click(inside.x, inside.y);
  expect(await state(page)).toEqual(before);
});

test("palette ignores other pointers and cancellation never drops a player", async ({ page }) => {
  const before = await state(page);
  const target = page.locator(".palette circle").first();
  const at = await point(page, 800, 200);
  await target.dispatchEvent("pointerdown", { button: 0, buttons: 1, pointerId: 41, clientX: at.x, clientY: at.y });
  await page.evaluate((p) => {
    document.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 42, button: 0, buttons: 0, clientX: p.x, clientY: p.y })
    );
  }, at);
  expect(await state(page)).toEqual({ ...before, temporary: true });
  await page.evaluate((p) => {
    document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 41, clientX: p.x, clientY: p.y }));
  }, at);
  expect(await state(page)).toEqual(before);
  await target.dispatchEvent("pointerdown", { button: 0, buttons: 1, pointerId: 43, clientX: at.x, clientY: at.y });
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  expect(await state(page)).toEqual(before);
});

test("palette normally drops ball and free player in transformed pitch coordinates", async ({ page }) => {
  const before = await state(page);
  await page
    .locator("#pitch-coordinate-space")
    .evaluate((el) => el.setAttribute("transform", "translate(80 40) scale(0.8)"));
  const drop = async (kind: string, i: number) => {
    const paletteItem = kind === "player" ? page.locator(".palette circle").first() : page.locator(".palette image");
    await paletteItem.hover();
    await page.mouse.down();
    const to = await point(page, 800 + i * 100, 200 + i * 100);
    await page.mouse.move(to.x, to.y);
    await page.mouse.up();
  };
  await drop("player", 0);
  await drop("ball", 1);
  expect((await state(page)).count).toBe(before.count + 2);
  expect((await state(page)).temporary).toBe(false);
  const added = await page.evaluate(async () => {
    const { useItemStore } = await import("../src/stores/itemStore.ts");
    return useItemStore()
      .items.getAll()
      .slice(-2)
      .map((p) => ({ kind: p.elementType, x: p.x, y: p.y }));
  });
  expect(added[0].kind).toBe("player");
  expect(added[1].kind).toBe("ball");
  expect(added[0].x).toBeCloseTo(800, 0);
  expect(added[0].y).toBeCloseTo(200, 0);
  expect(added[1].x).toBeCloseTo(900, 0);
  expect(added[1].y).toBeCloseTo(300, 0);
});
