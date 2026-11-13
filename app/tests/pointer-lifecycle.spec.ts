import type { Page } from "@playwright/test";
import { test, expect } from "./tactical-fixtures";

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator("#pitch-coordinate-space").evaluate(
    (el, point) => {
      const result = new DOMPoint(point.x, point.y).matrixTransform((el as SVGGraphicsElement).getScreenCTM()!);
      return { x: result.x, y: result.y };
    },
    { x, y }
  );
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
});

test("eraser release outside the SVG cannot erase on a later hover", async ({ page }) => {
  await page.evaluate(async () => {
    const { useDrawStore } = await import("../../../../../../src/stores/drawStore.ts");
    const store = useDrawStore();
    store.drawingConfig.type = "line";
    store.createDrawing("shape", 800, 200, 1000, 200, []);
  });
  await page.getByRole("button", { name: "橡皮擦", exact: true }).click();
  const start = await screenPoint(page, 800, 100);
  const line = await screenPoint(page, 900, 200);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  await page.mouse.move(line.x, line.y);
  expect(
    await page.evaluate(async () => {
      const { useDrawStore } = await import("../../../../../../src/stores/drawStore.ts");
      return useDrawStore().drawings.getDrawings().length;
    })
  ).toBe(1);
  await page.mouse.down();
  await page.mouse.up();
  expect(
    await page.evaluate(async () => {
      const { useDrawStore } = await import("../../../../../../src/stores/drawStore.ts");
      return useDrawStore().drawings.getDrawings().length;
    })
  ).toBe(0);
});

test("animation path release outside the SVG freezes the last intentional control point", async ({ page }) => {
  await page.evaluate(async () => {
    const { useAnimationStore } = await import("../../../../../../src/stores/animationStore.ts");
    const { FieldElement } = await import("../../../../../../src/types/fieldElement.ts");
    const store = useAnimationStore();
    store.openAnimationFromBoard([new FieldElement({ id: "pointer-ball", elementType: "ball", x: 200, y: 300 })]);
    store.addFrame();
    store.updateElementPosition("pointer-ball", 600, 300);
  });
  const control = page.locator("#paths circle");
  await expect(control).toBeVisible();
  const box = (await control.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const moved = await screenPoint(page, 410, 250);
  await page.mouse.move(moved.x, moved.y);
  const read = () =>
    page.evaluate(async () => {
      const { useAnimationStore } = await import("../../../../../../src/stores/animationStore.ts");
      return { ...useAnimationStore().currentAnimation!.actions[0].controlPoint };
    });
  const before = await read();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  const hover = await screenPoint(page, 500, 400);
  await page.mouse.move(hover.x, hover.y);
  expect(await read()).toEqual(before);
});

test("a pen pointerup before RAF still stores and renders the exact final point", async ({ page }) => {
  await page.getByRole("button", { name: "绘制跑位/传球/区域", exact: true }).click();
  await page.getByRole("button", { name: "自由画笔", exact: true }).click();
  const start = await screenPoint(page, 800, 180);
  const end = await screenPoint(page, 940, 250);
  // Dispatch in one task to exercise a pending, not-yet-rendered animation frame.
  await page.locator("#field").evaluate(
    (el, p) => {
      const send = (type: string, x: number, y: number, buttons: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: y,
            button: 0,
            buttons,
            pointerId: 44,
            pointerType: "mouse",
          })
        );
      send("pointerdown", p.start.x, p.start.y, 1);
      send("pointermove", p.end.x, p.end.y, 1);
      send("pointerup", p.end.x, p.end.y, 0);
    },
    { start, end }
  );
  const drawing = await page.evaluate(async () => {
    const { useDrawStore } = await import("../../../../../../src/stores/drawStore.ts");
    return useDrawStore().drawings.getDrawings()[0];
  });
  expect(drawing.pathPoints!.length).toBeGreaterThanOrEqual(2);
  // SVGPoint uses float32 precision. A sub-0.001 SVG-unit tolerance is far below
  // a rendered pixel while still proving that pointerup supplies the last sample.
  expect(drawing.pathPoints!.at(-1)![0]).toBeCloseTo(940, 3);
  expect(drawing.pathPoints!.at(-1)![1]).toBeCloseTo(250, 3);
  await expect(page.locator("#drawings path").first()).toBeVisible();
});

test("grid snapping cannot push a player beyond the actual board boundary", async ({ page }) => {
  await page.evaluate(async () => {
    const { useItemStore } = await import("../../../../../../src/stores/itemStore.ts");
    const { useGlobalStore } = await import("../../../../../../src/stores/globalStore.ts");
    const { FieldElement } = await import("../../../../../../src/types/fieldElement.ts");
    useGlobalStore().snap = true;
    useItemStore().addElement(new FieldElement({ id: "boundary-player", elementType: "player", x: 800, y: 200 }));
  });
  const start = await screenPoint(page, 800, 200);
  const outside = await screenPoint(page, 1400, 900);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(outside.x, outside.y);
  await page.mouse.up();
  const result = await page.evaluate(async () => {
    const { useItemStore } = await import("../../../../../../src/stores/itemStore.ts");
    const { useBoardStore } = await import("../../../../../../src/stores/boardStore.ts");
    const player = useItemStore().items.findById("boundary-player")!;
    return { x: player.x, y: player.y, bounds: useBoardStore().boardAreaBBox };
  });
  expect(result.x + 24).toBeLessThanOrEqual(result.bounds!.right);
  expect(result.y + 24).toBeLessThanOrEqual(result.bounds!.bottom);
  expect(result.x).toBeGreaterThan(800);
});

test("transformed pitch dragging uses SVG coordinates and blur ends the gesture", async ({ page }) => {
  await page.evaluate(async () => {
    const { useItemStore } = await import("../../../../../../src/stores/itemStore.ts");
    const { useGlobalStore } = await import("../../../../../../src/stores/globalStore.ts");
    const { FieldElement } = await import("../../../../../../src/types/fieldElement.ts");
    useGlobalStore().snap = false;
    useItemStore().addElement(new FieldElement({ id: "transformed-player", elementType: "player", x: 800, y: 200 }));
    // A real SVG coordinate transform, not mocked getSvgPosition arithmetic.
    document.querySelector("#pitch-coordinate-space")!.setAttribute("transform", "translate(80 40) scale(0.8)");
  });
  const start = await screenPoint(page, 800, 200);
  const destination = await screenPoint(page, 900, 280);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y);
  await page.mouse.up();
  const read = () =>
    page.evaluate(async () => {
      const { useItemStore } = await import("../../../../../../src/stores/itemStore.ts");
      const p = useItemStore().items.findById("transformed-player")!;
      return { x: p.x, y: p.y, dragging: p.isDragging };
    });
  const moved = await read();
  expect(moved.x).toBeCloseTo(900, 0);
  expect(moved.y).toBeCloseTo(280, 0);
  await page.mouse.move(destination.x, destination.y);
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  const extra = await screenPoint(page, 1000, 350);
  await page.mouse.move(extra.x, extra.y);
  await page.mouse.up();
  expect(await read()).toEqual(moved);
  await expect(page.locator("#item-transformed-player foreignObject")).toHaveCount(0);
});
