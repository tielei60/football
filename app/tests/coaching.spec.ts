import { selectUiOption, expectUiValue } from "./ui-select";
import { readFile } from "node:fs/promises";
import { type Page } from "@playwright/test";
import { test, expect } from "./tactical-fixtures";

const row = (page: Page, index: number) => page.locator(".roster-item").nth(index);
const boardPlayers = (page: Page) =>
  page.evaluate(async () => {
    const { useItemStore } = await import("/src/stores/itemStore.ts");
    return useItemStore()
      .items.findByCreationMode("normal")
      .filter((p) => p.elementType === "player")
      .map((p) => ({ id: p.id, rosterId: p.rosterId, x: p.x, y: p.y, role: p.playerPosition }));
  });

test("substitution keeps the outgoing position and can be undone and redone with the roster", async ({
  page,
  request,
}) => {
  const profiles = await (await request.get("/api/players")).json();
  await page.goto("/board");
  await expect(row(page, 0)).toBeVisible();
  const before = await boardPlayers(page);
  await row(page, 8)
    .getByRole("button", { name: /队员详情/ })
    .click();
  await selectUiOption(row(page, 8).getByRole("combobox", { name: "换下队员" }), { index: 1 });
  await row(page, 8).getByRole("button", { name: "确认换人" }).click();
  await expect(row(page, 8).getByRole("button", { name: "下场", exact: true })).toBeVisible();
  await expect(row(page, 0).getByRole("button", { name: "上场", exact: true })).toBeVisible();
  const after = await boardPlayers(page);
  expect(after).toHaveLength(8);
  const incoming = after.find(
    (p) => p.rosterId === profiles.find((player: { number: number }) => player.number === 9).id
  )!;
  const outgoing = before.find(
    (p) => p.rosterId === profiles.find((player: { number: number }) => player.number === 1).id
  )!;
  expect({ x: incoming.x, y: incoming.y, role: incoming.role }).toEqual({
    x: outgoing.x,
    y: outgoing.y,
    role: outgoing.role,
  });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(row(page, 0).getByRole("button", { name: "下场", exact: true })).toBeVisible();
  await expect(row(page, 8).getByRole("button", { name: "上场", exact: true })).toBeVisible();
  expect(await boardPlayers(page)).toEqual(before);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect(await boardPlayers(page)).toEqual(after);
  await expect(row(page, 8).getByRole("button", { name: "下场", exact: true })).toBeVisible();
});

test("changing formation keeps the selected squad instead of restoring the first eight names", async ({ page }) => {
  await page.goto("/board");
  await row(page, 0).getByRole("button", { name: "下场", exact: true }).click();
  await row(page, 8).getByRole("button", { name: "上场", exact: true }).click();
  await page.getByRole("button", { name: "3-3-1", exact: true }).click();
  await expect(row(page, 8).getByRole("button", { name: "下场", exact: true })).toBeVisible();
  await expect(row(page, 0).getByRole("button", { name: "上场", exact: true })).toBeVisible();
  await expect(page.locator(".roster-item.on")).toHaveCount(8);
});

test("undo restores a player health status together with the pitch", async ({ page }) => {
  await page.goto("/board");
  await row(page, 0)
    .getByRole("button", { name: /队员详情/ })
    .click();
  const status = row(page, 0).getByRole("combobox", { name: "状态", exact: true });
  await selectUiOption(status, "injured");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expectUiValue(status, "ok");
  await expect(page.locator(".roster-item.on")).toHaveCount(8);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expectUiValue(status, "injured");
  await expect(page.locator(".roster-item.on")).toHaveCount(7);
});

test("training plan persists, belongs to its tactic, and is included in export and print", async ({ page }) => {
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto("/board");
  await page.getByRole("button", { name: "训练计划", exact: true }).click();
  await page.getByRole("textbox", { name: "训练目标" }).fill("边路推进后完成倒三角传中");
  await page.getByRole("textbox", { name: "执教要点" }).fill("弱侧前锋攻击后点\n丢球后立即反抢");
  await page.getByRole("spinbutton", { name: "训练时长（分钟）" }).fill("25");
  await page.getByRole("button", { name: "关闭训练计划" }).click();
  await expect(page.getByLabel("保存状态")).toContainText("已保存");
  await page.reload();
  await page.getByRole("button", { name: "训练计划", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "训练目标" })).toHaveValue("边路推进后完成倒三角传中");
  await page.getByRole("button", { name: "关闭训练计划" }).click();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.getByRole("textbox", { name: "战术名称", exact: true }).fill("边路训练 A");
  await page.getByRole("button", { name: "保存当前战术" }).click();
  await expect(page.locator(".tactic-item")).toHaveCount(1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出JSON", exact: true }).click();
  const download = await downloadPromise;
  const payload = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(payload.board.trainingPlan).toEqual({
    objective: "边路推进后完成倒三角传中",
    instructions: "弱侧前锋攻击后点\n丢球后立即反抢",
    durationMinutes: 25,
  });
  await page.locator(".tactic-item").getByRole("button", { name: "打印战术" }).click();
  await expect(page.locator(".print-sheet")).toContainText("边路推进后完成倒三角传中");
  await expect(page.locator(".print-sheet")).toContainText("25 分钟");
});

test("save as creates an independent tactic and opening the original restores its form", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const title = page.getByRole("textbox", { name: "战术名称", exact: true });
  await title.fill("进攻方案 A");
  await page.getByRole("textbox", { name: "对手", exact: true }).fill("红星");
  await page.getByRole("button", { name: "保存当前战术" }).click();
  await expect(page.locator(".tactic-item")).toHaveCount(1);
  await title.fill("进攻方案 B");
  await page.getByRole("button", { name: "另存为新战术" }).click();
  await expect(page.locator(".tactic-item")).toHaveCount(2);
  await page
    .locator(".tactic-item")
    .filter({ has: page.locator(".tactic-title", { hasText: "进攻方案 A" }) })
    .getByRole("button", { name: "打开", exact: true })
    .click();
  await expect(title).toHaveValue("进攻方案 A");
  await expect(page.getByRole("textbox", { name: "对手", exact: true })).toHaveValue("红星");
  await page.getByRole("button", { name: "保存当前战术" }).click();
  await expect(page.locator(".tactic-item")).toHaveCount(2);
  await expect(page.locator(".tactic-title", { hasText: "进攻方案 B" })).toBeVisible();
});

test("rolling back another tactic restores its plan and keeps the current draft backup with its owner", async ({
  page,
}) => {
  await page.goto("/board");
  await expect(row(page, 0)).toBeVisible();
  const result = await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const { useCoachingStore } = await import("/src/stores/coachingStore.ts");
    const tactics = useTacticsStore();
    const coaching = useCoachingStore();
    coaching.plan.objective = "方案 A 原始目标";
    await tactics.saveTactic("方案 A", [], null);
    const a = tactics.currentId!;
    const original = tactics.versions[a][0];
    coaching.plan.objective = "方案 B 目标";
    await tactics.saveTactic("方案 B", [], null, "", {}, true);
    const b = tactics.currentId!;
    coaching.plan.objective = "方案 B 未保存调整";
    await tactics.rollback(original);
    const restored = { current: tactics.currentId, objective: coaching.plan.objective };
    await tactics.quickSave();
    return {
      a,
      b,
      restored,
      savedA: (await (await fetch(`/api/tactics/${a}`)).json()).board.trainingPlan?.objective,
      savedB: (await (await fetch(`/api/tactics/${b}`)).json()).board.trainingPlan?.objective,
      backupA: (await (await fetch(`/api/tactics/${a}/versions`)).json())
        .filter((v) => v.note === "回滚前自动备份")
        .map((v) => v.board.trainingPlan?.objective),
      backupB: (await (await fetch(`/api/tactics/${b}/versions`)).json())
        .filter((v) => v.note === "回滚前自动备份")
        .map((v) => v.board.trainingPlan?.objective),
    };
  });
  expect(result.restored).toEqual({ current: result.a, objective: "方案 A 原始目标" });
  expect(result.savedA).toBe("方案 A 原始目标");
  expect(result.savedB).toBe("方案 B 目标");
  expect(result.backupA).toEqual([]);
  expect(result.backupB).toEqual(["方案 B 未保存调整"]);
});

test("backup restores training plans and versions, while legacy imports start with a blank plan", async ({ page }) => {
  await page.goto("/board");
  await expect(row(page, 0)).toBeVisible();
  const result = await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const { useCoachingStore } = await import("/src/stores/coachingStore.ts");
    const tactics = useTacticsStore();
    const coaching = useCoachingStore();
    const plan = { objective: "反击训练", instructions: "三脚传球进入进攻三区", durationMinutes: 20 };
    coaching.plan = { ...plan };
    await tactics.saveTactic("反击", [], null);
    const backup = JSON.parse(await tactics.exportBackup());
    const count = await tactics.importBackup(backup);
    const restored = (await (await fetch("/api/tactics")).json()).sort((a, b) => b.tacticId - a.tacticId)[0];
    await tactics.loadTactic(restored.tacticId);
    const restoredPlan = { ...coaching.plan };
    const versionPlan = (await (await fetch(`/api/tactics/${restored.tacticId}/versions`)).json())[0]?.board
      .trainingPlan;
    await tactics.importTactic("旧版战术", [], { items: [], drawings: [], keyframes: [] });
    return { count, restoredPlan, versionPlan, legacyPlan: { ...coaching.plan }, plan };
  });
  expect(result.count).toBe(1);
  expect(result.restoredPlan).toEqual(result.plan);
  expect(result.versionPlan).toEqual(result.plan);
  expect(result.legacyPlan).toEqual({ objective: "", instructions: "", durationMinutes: 15 });
});
