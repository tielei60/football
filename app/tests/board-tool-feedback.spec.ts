/* eslint-disable no-restricted-syntax, no-await-in-loop -- Keyboard journeys intentionally operate one shared page sequentially. */
import type { Page } from "@playwright/test";
import { test, expect } from "./tactical-fixtures";

async function state(page: Page) {
  return page.evaluate(async () => {
    const { useItemStore } = await import("../src/stores/itemStore.ts");
    return useItemStore()
      .items.getAll()
      .map((item) => ({
        id: item.id,
        kind: item.elementType,
        x: item.x,
        y: item.y,
        number: item.number,
        rosterId: item.rosterId,
      }));
  });
}

test("palette keyboard activation adds separate temporary pieces, preserves focus and supports undo", async ({
  page,
  request,
}) => {
  await page.goto("/board");
  const red = page.getByRole("button", { name: "添加红色棋子", exact: true });
  await expect(red).toBeVisible();
  const original = await state(page);
  const roster = await (await request.get("/api/players")).json();
  await red.focus();
  await red.press("Enter");
  await expect(red).toBeFocused();
  await red.press("Space");
  const withPlayers = await state(page);
  expect(withPlayers).toHaveLength(original.length + 2);
  expect(withPlayers.slice(-2).map((p) => p.number)).toEqual([0, 1]);
  expect(withPlayers.slice(-2).every((p) => !p.rosterId && p.x >= 100 && p.x <= 1150 && p.y > 50 && p.y < 760)).toBe(
    true
  );
  expect(new Set(withPlayers.map((p) => p.id)).size).toBe(withPlayers.length);
  await red.dispatchEvent("keydown", { key: "Enter", repeat: true, bubbles: true });
  expect(await state(page)).toEqual(withPlayers);
  const ball = page.getByRole("button", { name: "添加足球", exact: true });
  await ball.focus();
  await ball.press("Enter");
  expect((await state(page)).at(-1)!.kind).toBe("ball");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await state(page)).toEqual(withPlayers);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect(await state(page)).toHaveLength(original.length + 3);
  expect(await (await request.get("/api/players")).json()).toEqual(roster);
});

test("palette keyboard input cannot add objects during a transition or playback", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  await page.evaluate(async () => {
    const { useAnimationStore } = await import("../src/stores/animationStore.ts");
    useAnimationStore().seek(0.5);
  });
  const ball = page.getByRole("button", { name: "添加足球", exact: true });
  await expect(ball).toHaveAttribute("aria-disabled", "true");
  await expect(ball).toHaveAttribute("tabindex", "-1");
  const before = await state(page);
  await ball.dispatchEvent("keydown", { key: "Enter", bubbles: true });
  expect(await state(page)).toEqual(before);
  await expect(page.locator(".tool-caption")).toHaveText("动画预览");
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  await expect(ball).toHaveCount(0);
  expect(await state(page)).toEqual(before);
});

test("compact drawing presets expose selection and persistent tool labels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/board");
  await page.getByRole("button", { name: "绘图", exact: true }).click();
  for (const name of ["跑位线", "传球线", "区域"]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(button).toHaveClass(/active/);
    for (const other of ["跑位线", "传球线", "区域"].filter((n) => n !== name)) {
      await expect(page.getByRole("button", { name: other, exact: true })).toHaveAttribute("aria-pressed", "false");
    }
  }
  await page.getByRole("button", { name: "橡皮擦", exact: true }).click();
  await expect(page.locator(".tool-caption")).toHaveText("擦除线条");
  await expect(page.locator(".tool-caption")).toHaveClass(/destructive/);
});

test("clear confirmation is scoped to current canvas, cancels cleanly and remains undoable", async ({
  page,
  request,
}) => {
  await page.goto("/board");
  await expect(page.locator("#players > g").first()).toBeVisible();
  const original = await state(page);
  const roster = await (await request.get("/api/players")).json();
  const trigger = page.getByRole("button", { name: "清空画布", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "清空当前画布" });
  await expect(dialog).toContainText("战术库存档和球员档案不受影响");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(await state(page)).toEqual(original);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole("button", { name: "清空画布", exact: true }).click();
  expect(await state(page)).toEqual([]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await state(page)).toEqual(original);
  expect(await (await request.get("/api/players")).json()).toEqual(roster);
});

test("a stale clear confirmation cannot clear a newer board", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "清空画布", exact: true }).click();
  await page.evaluate(async () => {
    const { useTacticsStore } = await import("../src/stores/tacticsStore.ts");
    const { useItemStore } = await import("../src/stores/itemStore.ts");
    const { FieldElement } = await import("../src/types/fieldElement.ts");
    useTacticsStore().newBoard();
    useItemStore().addElement(new FieldElement({ x: 500, y: 300, number: 17 }));
  });
  const newer = await state(page);
  await page
    .getByRole("dialog", { name: "清空当前画布" })
    .getByRole("button", { name: "清空画布", exact: true })
    .click();
  expect(await state(page)).toEqual(newer);
  await expect(page.getByText("画布已改变，未执行清空。请在当前画布重新操作。", { exact: true })).toBeVisible();
});

["keyboard", "drag"].forEach((method) => {
  test(`animation palette ${method} additions undo and redo together with their full animation`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/board");
    await page.getByRole("button", { name: "制作动画", exact: true }).click();
    await page.getByRole("button", { name: "添加帧", exact: true }).click();
    const snapshot = () =>
      page.evaluate(async () => {
        const { useAnimationStore } = await import("../src/stores/animationStore.ts");
        const { restoreAnimation } = await import("../src/types/animation.ts");
        return restoreAnimation(useAnimationStore().getSnapshot())?.toJSON();
      });
    const before = await snapshot();
    const itemsBefore = await state(page);
    if (method === "keyboard") {
      const ball = page.getByRole("button", { name: "添加足球", exact: true });
      await ball.focus();
      await ball.press("Enter");
    } else {
      const target = await page.locator("#pitch-coordinate-space").evaluate((el) => {
        const point = new DOMPoint(900, 250).matrixTransform((el as SVGGraphicsElement).getScreenCTM()!);
        return { x: point.x, y: point.y };
      });
      await page.locator(".palette image").hover();
      await page.mouse.down();
      await page.mouse.move(target.x, target.y);
      await page.mouse.up();
    }
    const after = await snapshot();
    expect(after).not.toEqual(before);
    const itemsAfter = await state(page);
    expect(itemsAfter).toHaveLength(itemsBefore.length + 1);
    await page.getByRole("button", { name: "返回战术板", exact: true }).click();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    expect(await snapshot()).toEqual(before);
    expect(await state(page)).toEqual(itemsBefore);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    expect(await snapshot()).toEqual(after);
    expect(await state(page)).toEqual(itemsAfter);
  });
});
