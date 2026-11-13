import type { Page } from "@playwright/test";
import { test, expect } from "./tactical-fixtures";

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { useAnimationStore } = await import("../../../../../../src/stores/animationStore.ts");
    return useAnimationStore().getSnapshot() ?? null;
  });
}

async function makeTwoSteps(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  await expect(page.locator(".roster-item").first()).toBeVisible();
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  await page.getByRole("textbox", { name: "步骤名称" }).fill("虚构斜插第二步");
  await page.getByRole("textbox", { name: "步骤要点" }).fill("保持宽度，观察后前插");
  await page.getByRole("textbox", { name: "步骤要点" }).press("Tab");
  await expect(page.locator(".timeline-step")).toHaveCount(2);
  await page.getByRole("button", { name: "返回战术板", exact: true }).click();
  return snapshot(page);
}

async function undoRedo(page: Page, before: unknown, after: unknown) {
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect(await snapshot(page)).toEqual(after);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
}

test("new blank board undo and redo preserve complete custom animation instead of rebuilding one initial step", async ({
  page,
}) => {
  const before = await makeTwoSteps(page);
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.getByRole("button", { name: "新建空白板", exact: true }).click();
  await page.getByRole("dialog", { name: "请确认操作" }).getByRole("button", { name: "确认", exact: true }).click();
  await page.getByRole("button", { name: "关闭战术库", exact: true }).click();
  expect(await snapshot(page)).toBeNull();
  await undoRedo(page, before, null);
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await expect(page.locator(".timeline-step")).toHaveCount(2);
  await page.getByRole("spinbutton", { name: "当前帧" }).fill("2");
  await page.getByRole("spinbutton", { name: "当前帧" }).press("Tab");
  await expect(page.getByRole("textbox", { name: "步骤名称" })).toHaveValue("虚构斜插第二步");
  await expect(page.getByRole("textbox", { name: "步骤要点" })).toHaveValue("保持宽度，观察后前插");
});

(["open", "import", "rollback"] as const).forEach((operation) => {
  test(`${operation} boundary undo/redo restores its own animation, including legacy no-animation boards`, async ({
    page,
  }) => {
    const before = await makeTwoSteps(page);
    // Prepare an alternate saved board; boundary actions below use the production store.
    // New-board above is fully UI-driven; this test covers all shared restoreSnapshot entry points.
    const beforeId = await page.evaluate(async () => {
      const { useTacticsStore } = await import("../../../../../../src/stores/tacticsStore.ts");
      await useTacticsStore().saveTactic("虚构来源画板", [], null);
      return useTacticsStore().currentId;
    });
    await page.evaluate(async (boundaryOperation) => {
      const { useTacticsStore } = await import("../../../../../../src/stores/tacticsStore.ts");
      const store = useTacticsStore();
      if (boundaryOperation === "import") {
        await store.importTactic("虚构旧版导入", [], { items: [], drawings: [], keyframes: [] });
      } else {
        await store.saveTactic("虚构动画历史", [], null);
        const version = store.versions[store.currentId!][0];
        if (boundaryOperation === "rollback") {
          // Use a distinct valid legacy snapshot while preserving a real version's metadata.
          await store.rollback({ ...version, snapshot: { ...version.snapshot, animation: undefined } });
        } else {
          const saved = await fetch("/api/tactics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tactic: {
                title: "虚构旧版画板",
                board: { pieces: [], markings: [], playerCount: 8 },
                tags: [],
              },
            }),
          });
          if (!saved.ok) throw new Error(`fixture failed: ${saved.status}`);
          const target = await saved.json();
          await store.loadTactic(target.tacticId);
        }
      }
    }, operation);
    expect(await snapshot(page)).toBeNull();
    const afterId = await page.evaluate(
      async () => (await import("../../../../../../src/stores/tacticsStore.ts")).useTacticsStore().currentId
    );
    await undoRedo(page, before, null);
    expect(
      await page.evaluate(
        async () => (await import("../../../../../../src/stores/tacticsStore.ts")).useTacticsStore().currentId
      )
    ).toBe(beforeId);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    expect(
      await page.evaluate(
        async () => (await import("../../../../../../src/stores/tacticsStore.ts")).useTacticsStore().currentId
      )
    ).toBe(afterId);
  });
});

test("ordinary drawing undo does not silently undo later animation edits", async ({ page }) => {
  await makeTwoSteps(page);
  await page.getByRole("button", { name: "文字标注 (T)", exact: true }).click();
  const box = (await page.locator("#field").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.25);
  await expect(page.locator("#field .text-drawing text")).toHaveCount(1);
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await page.getByRole("spinbutton", { name: "当前帧" }).fill("2");
  await page.getByRole("spinbutton", { name: "当前帧" }).press("Tab");
  await page.getByRole("textbox", { name: "步骤名称" }).fill("后续动画编辑必须保留");
  await page.getByRole("textbox", { name: "步骤名称" }).press("Tab");
  await page.getByRole("button", { name: "返回战术板", exact: true }).click();
  const edited = await snapshot(page);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.locator("#field .text-drawing text")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(edited);
});

test("failed rollback target-version read leaves canvas, animation, owner and formation unchanged", async ({
  page,
}) => {
  await makeTwoSteps(page);
  const fixture = await page.evaluate(async () => {
    const store = (await import("../../../../../../src/stores/tacticsStore.ts")).useTacticsStore();
    await store.saveTactic("原草稿 A", [], "8-3-3-1");
    const sourceId = store.currentId!;
    await store.saveTactic("目标 B", [], "8-2-3-2", "", {}, true);
    const targetId = store.currentId!;
    await store.loadTactic(sourceId);
    const history = (await import("../../../../../../src/stores/historyStore.ts")).useHistoryStore();
    return {
      sourceId,
      targetId,
      before: store.snapshotBoard(),
      dirty: store.boardDirty,
      undo: history.undoStack.length,
      redo: history.redoStack.length,
    };
  });
  await page.route(`**/api/tactics/${fixture.targetId}/versions`, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "回归模拟版本读取失败" }),
    });
  });
  const after = await page.evaluate(async (targetId) => {
    const store = (await import("../../../../../../src/stores/tacticsStore.ts")).useTacticsStore();
    const history = (await import("../../../../../../src/stores/historyStore.ts")).useHistoryStore();
    let failed = false;
    try {
      await store.rollback(store.versions[targetId][0]);
    } catch {
      failed = true;
    }
    return {
      failed,
      id: store.currentId,
      board: store.snapshotBoard(),
      dirty: store.boardDirty,
      undo: history.undoStack.length,
      redo: history.redoStack.length,
    };
  }, fixture.targetId);
  expect(after).toEqual({
    failed: true,
    id: fixture.sourceId,
    board: fixture.before,
    dirty: fixture.dirty,
    undo: fixture.undo,
    redo: fixture.redo,
  });
});
