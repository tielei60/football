import { test, expect } from "./fixtures";

test("animated players move as a group without relaying out avatar coordinates", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.evaluate(async () => {
    const { useAnimationStore } = await import("/src/stores/animationStore.ts");
    const { FieldElement } = await import("/src/types/fieldElement.ts");
    const store = useAnimationStore();
    store.openAnimationFromBoard([
      new FieldElement({ id: "moving-player", elementType: "player", x: 200, y: 300, number: 9 }),
    ]);
    store.addFrame();
    store.updateElementPosition("moving-player", 600, 300);
    store.switchFrame(0);
  });
  await page.clock.install();
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  await page.clock.runFor(500);
  const circle = page.locator("#item-moving-player > g > g > circle").first();
  const coordinate = await circle.getAttribute("cx");
  const before = (await circle.boundingBox())!;
  await page.clock.runFor(500);
  expect(await circle.getAttribute("cx")).toBe(coordinate);
  expect((await circle.boundingBox())!.x).toBeGreaterThan(before.x + 10);
});

test("playing animation avoids per-player SVG shadow filters", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  await page.getByRole("checkbox", { name: "循环播放", exact: true }).check();
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  const marker = page.locator("#players > g > g > g").first();
  await expect(marker).toHaveCSS("filter", "none");
  await page.getByRole("button", { name: "暂停动画", exact: true }).click();
  await expect(marker).not.toHaveCSS("filter", "none");
});

test("editing a tactic name during a slow save keeps the newer input", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const savingVersions = new Promise<void>((resolve) => {
    reached = resolve;
  });
  await page.route("**/api/tactics/*/versions", async (route) => {
    const response = await route.fetch();
    reached();
    await held;
    await route.fulfill({ response });
  });
  await page.goto("/board");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const title = page.getByRole("textbox", { name: "战术名称", exact: true });
  await title.fill("原始方案");
  await page.getByRole("button", { name: "保存当前战术" }).click();
  await savingVersions;
  await title.fill("继续编辑的方案");
  release();
  await expect(page.getByRole("button", { name: "保存当前战术" })).toBeEnabled();
  await expect(title).toHaveValue("继续编辑的方案");
});

test("autosave defers full board snapshots until editing settles", async ({ page }) => {
  await page.goto("/board");
  await expect(page.getByLabel("保存状态")).toContainText("已保存");
  const result = await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const { useItemStore } = await import("/src/stores/itemStore.ts");
    const { useCoachingDeskStore } = await import("/src/stores/coachingDeskStore.ts");
    const tactics = useTacticsStore();
    const original = tactics.snapshotBoard;
    let captures = 0;
    tactics.snapshotBoard = () => {
      captures++;
      return original();
    };
    try {
      const player = useItemStore().items.getAll()[0];
      for (let i = 0; i < 30; i++) {
        player.x += 1;
        await Promise.resolve();
      }
      const during = captures;
      await useCoachingDeskStore().flush();
      return { during, after: captures };
    } finally {
      tactics.snapshotBoard = original;
    }
  });
  expect(result.during).toBe(0);
  expect(result.after).toBeGreaterThan(0);
});

test("animation playback does not serialize its full snapshot on every rendered frame", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  const writes = await page.evaluate(async () => {
    const { useAnimationStore } = await import("/src/stores/animationStore.ts");
    const { useItemStore } = await import("/src/stores/itemStore.ts");
    const store = useAnimationStore();
    store.openAnimationFromBoard(useItemStore().items.getAll());
    store.addFrame();
    store.switchFrame(0);
    await new Promise(requestAnimationFrame);
    let count = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "animation") count++;
      original.call(this, key, value);
    };
    try {
      store.startAutoPlay();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      store.stopAutoPlay();
      return count;
    } finally {
      Storage.prototype.setItem = original;
    }
  });
  expect(writes).toBeLessThanOrEqual(4);
});

test("rapid drag events are coalesced and releasing preserves the final position", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#players > g").first()).toBeVisible();
  const result = await page
    .locator("#players > g")
    .nth(3)
    .evaluate(async (group) => {
      const circle = group.querySelector(":scope > g > g > circle")!;
      const box = circle.getBoundingClientRect();
      const start = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
      const previous = circle.getAttribute("cx");
      const options = { bubbles: true, pointerId: 1, pointerType: "mouse", buttons: 1 };
      circle.dispatchEvent(new PointerEvent("pointerdown", { ...options, ...start }));
      for (let i = 1; i <= 80; i++) {
        document.dispatchEvent(
          new PointerEvent("pointermove", { ...options, clientX: start.clientX + i, clientY: start.clientY })
        );
        await Promise.resolve();
      }
      const beforeFrame = circle.getAttribute("cx");
      document.dispatchEvent(
        new PointerEvent("pointerup", { ...options, clientX: start.clientX + 80, clientY: start.clientY })
      );
      await new Promise(requestAnimationFrame);
      return { previous, beforeFrame, final: circle.getAttribute("cx") };
    });
  expect(result.beforeFrame).toBe(result.previous);
  expect(result.final).not.toBe(result.previous);
  await expect(page.getByLabel("保存状态")).toContainText("已保存");
  await page.reload();
  await expect(page.locator(`#players circle[cx="${result.final}"]`).first()).toBeAttached();
});
