import { test, expect } from "./tactical-fixtures";

test("an empty new board can apply its default formation", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    useTacticsStore().newBoard();
  });
  await expect(page.locator("#players > g")).toHaveCount(0);
  await page.locator('.formation-segment button:has-text("2-3-2")').click();
  await expect(page.locator(".roster-item.on")).toHaveCount(8);
});

test("undoing a player-count change restores the original formation metadata", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  const result = await page.evaluate(async () => {
    const { useFormation } = await import("/src/composables/useFormation.ts");
    const { useHistory } = await import("/src/composables/useHistory.ts");
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const { useMatchStore } = await import("/src/stores/matchStore.ts");
    useFormation().applyFormation("3-3-1");
    useFormation().changePlayerCount(11);
    useHistory().handleUndo();
    return { count: useMatchStore().playerCount, formation: useTacticsStore().currentFormationId };
  });
  expect(result).toEqual({ count: 8, formation: "3-3-1" });
});
