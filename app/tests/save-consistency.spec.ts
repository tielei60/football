import { test, expect } from "./tactical-fixtures";

test("opening and importing a tactic restores its exact formation metadata", async ({ page }) => {
  await page.goto("/board");
  await expect(page.getByLabel("保存状态")).toContainText("已保存");
  const restored = await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const store = useTacticsStore();
    store.applyFormationState("2-3-2", "3-3-1");
    store.markBoardEdited();
    await store.saveTactic("完整阵型", []);
    const id = store.currentId!;
    store.newBoard();
    await store.loadTactic(id);
    const opened = [store.currentFormationId, store.awayFormationId, store.formationCustomized];
    const snapshot = store.snapshotBoard();
    await store.importTactic("导入阵型", [], snapshot);
    return { opened, imported: [store.currentFormationId, store.awayFormationId, store.formationCustomized] };
  });
  expect(restored.opened).toEqual(["2-3-2", "3-3-1", true]);
  expect(restored.imported).toEqual(["2-3-2", "3-3-1", true]);
});

test("training edits and a restored older version remain unsaved to the tactic library after reload", async ({
  page,
}) => {
  await page.goto("/board");
  await expect(page.getByLabel("保存状态")).toContainText("已保存");
  await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    await useTacticsStore().saveTactic("训练草稿", []);
  });
  await page.evaluate(async () => {
    const { useCoachingStore } = await import("/src/stores/coachingStore.ts");
    useCoachingStore().plan.objective = "尚未存入战术库";
  });
  await expect(page.locator(".board-badge.dirty")).toBeVisible();
  await page.evaluate(async () => {
    const { useCoachingDeskStore } = await import("/src/stores/coachingDeskStore.ts");
    await useCoachingDeskStore().flush();
  });
  await page.reload();
  await expect(page.locator(".board-badge.dirty")).toBeVisible();
  await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const store = useTacticsStore();
    await store.saveTactic("训练草稿", []);
    const versions = store.versions[store.currentId!];
    await store.rollback(versions[versions.length - 1]);
  });
  await expect(page.locator(".board-badge.dirty")).toBeVisible();
});
