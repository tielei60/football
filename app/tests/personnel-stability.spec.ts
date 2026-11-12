import { test, expect } from "./tactical-fixtures";
import type { Page } from "@playwright/test";

// 在场名单：name@x,y（排序后对比，既验人员也验站位）
const snapshotOnField = async (page: Page) =>
  page.evaluate(async () => {
    const { useRosterStore } = await import("/src/stores/rosterStore.ts");
    const { useItemStore } = await import("/src/stores/itemStore.ts");
    const items = useItemStore().items.findByCreationMode("normal");
    return useRosterStore()
      .players.filter((p) => p.fieldId !== null)
      .map((p) => {
        const el = items.find((e) => e.id === p.fieldId);
        return `${p.name}@${Math.round(el?.x ?? -1)},${Math.round(el?.y ?? -1)}`;
      })
      .sort();
  });

const onFieldNames = async (page: Page) =>
  (await snapshotOnField(page)).map((s) => s.split("@")[0]).sort();

const templateSpots = async (page: Page, id: string) =>
  page.evaluate(async (formationId: string) => {
    const { MATCH_FORMATIONS } = await import("/src/data/matchFormats.ts");
    const { useMatchStore } = await import("/src/stores/matchStore.ts");
    const { toSvgX, toSvgY } = await import("/src/data/eightFormations.ts");
    const formation = MATCH_FORMATIONS[useMatchStore().playerCount].find((f) => f.id === formationId)!;
    return formation.spots.map((s) => `${Math.round(toSvgX(s.ny))},${Math.round(toSvgY(s.nx))}`).sort();
  }, id);

const snapshotPositions = async (page: Page) =>
  (await snapshotOnField(page)).map((s) => s.split("@")[1]).sort();

const selectTemplate = (page: Page, name: string) =>
  page.locator(`.formation-segment button:has-text("${name}")`).click();

const substituteFirst = (page: Page) =>
  page.evaluate(async () => {
    const { useRosterStore } = await import("/src/stores/rosterStore.ts");
    const roster = useRosterStore();
    const onField = roster.players.filter((p) => p.fieldId !== null);
    const bench = roster.players.filter((p) => p.fieldId === null && (!p.status || p.status === "ok"));
    return {
      ok: roster.substitute(bench[0].id, onField[0].id),
      incoming: bench[0].name,
      outgoing: onField[0].name,
    };
  });

test("换人+微调后保存，重载重进模板：人员保持，收敛到模板网格", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await selectTemplate(page, "2-1-3-1");

  const swapped = await substituteFirst(page);
  expect(swapped.ok).toBe(true);
  // 手动把一人拖离网格（模拟站位微调）
  await page.evaluate(async () => {
    const { useItemStore } = await import("/src/stores/itemStore.ts");
    const el = useItemStore().items.findByCreationMode("normal").filter((e) => e.elementType === "player")[0];
    el.x = 1100;
    el.y = 700;
  });
  await expect(page.locator(".board-badge.template")).toContainText("已微调");

  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.getByRole("textbox", { name: "战术名称", exact: true }).fill("2131人员战术");
  await page.getByRole("button", { name: "保存当前战术" }).click();
  await expect(page.locator(".tactic-title", { hasText: "2131人员战术" })).toBeVisible();

  // 重载：工作台恢复阵容与血缘（保存已落盘微调，故为干净态）
  await page.reload();
  await expect(page.locator("#field")).toBeVisible();
  await expect(page.locator(".board-badge.template")).toContainText("模板：2-1-3-1");
  expect(await onFieldNames(page)).toContain(swapped.incoming);

  // 重载后再微调（拖到新位置，确保是有效改动），重进模板：人员不变，站位收敛到模板网格
  await page.evaluate(async () => {
    const { useItemStore } = await import("/src/stores/itemStore.ts");
    const el = useItemStore().items.findByCreationMode("normal").filter((e) => e.elementType === "player")[1];
    el.x = 200;
    el.y = 200;
  });
  await expect(page.locator(".board-badge.template")).toContainText("已微调");
  await selectTemplate(page, "2-1-3-1");
  expect(await onFieldNames(page)).toContain(swapped.incoming);
  expect(await onFieldNames(page)).not.toContain(swapped.outgoing);
  expect(await snapshotPositions(page)).toEqual(await templateSpots(page, "2-1-3-1"));
  // 二次点击幂等
  const once = await snapshotOnField(page);
  await selectTemplate(page, "2-1-3-1");
  expect(await snapshotOnField(page)).toEqual(once);
});

test("保存后从战术库打开：人员与站位完整恢复", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await selectTemplate(page, "2-1-3-1");

  const swapped = await substituteFirst(page);
  expect(swapped.ok).toBe(true);
  const before = await snapshotOnField(page);

  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.getByRole("textbox", { name: "战术名称", exact: true }).fill("2131人员战术");
  await page.getByRole("button", { name: "保存当前战术" }).click();
  await expect(page.locator(".tactic-title", { hasText: "2131人员战术" })).toBeVisible();

  await page.reload();
  await expect(page.locator("#field")).toBeVisible();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.getByRole("button", { name: "打开", exact: true }).click();
  expect(await snapshotOnField(page)).toEqual(before);
});
