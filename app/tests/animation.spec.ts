import { selectUiOption } from "./ui-select";
import { type Page } from "@playwright/test";
import { test, expect } from "./tactical-fixtures";

async function openBoard(page: Page) {
  await page.goto("/board");
  await expect(page.locator(".roster-item").first()).toBeVisible();
}

async function makeMovement(page: Page) {
  await page.evaluate(async () => {
    const { useAnimationStore } = await import("/src/stores/animationStore.ts");
    const { FieldElement } = await import("/src/types/fieldElement.ts");
    const store = useAnimationStore();
    store.openAnimationFromBoard([new FieldElement({ id: "test-ball", elementType: "ball", x: 200, y: 300 })]);
    store.addFrame();
    store.updateElementPosition("test-ball", 600, 300);
    store.switchFrame(0);
  });
}

test("pause holds the ball at its visible position and resume continues from there", async ({ page }) => {
  await openBoard(page);
  await makeMovement(page);
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  await page.clock.runFor(700);
  const x = () => page.locator("#players #item-test-ball image").evaluate((el) => Number(el.getAttribute("x")));
  const moving = await x();
  expect(moving).toBeGreaterThan(220);
  expect(moving).toBeLessThan(580);
  await page.getByRole("button", { name: "暂停动画", exact: true }).click();
  const paused = await x();
  expect(Math.abs(paused - moving)).toBeLessThan(8);
  await page.clock.runFor(1000);
  expect(await x()).toBe(paused);
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  await page.clock.runFor(400);
  expect(await x()).toBeGreaterThan(paused + 20);
});

test("timeline seeks, honors single playback and changes speed without restarting", async ({ page }) => {
  await openBoard(page);
  await makeMovement(page);
  const timeline = page.getByRole("slider", { name: "动画进度" });
  await expect(timeline).toBeVisible();
  await page.clock.install();
  await page.getByRole("checkbox", { name: "循环播放" }).uncheck();
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  await page.clock.runFor(500);
  await selectUiOption(page.getByRole("combobox", { name: "播放速度" }), "1.5");
  await page.clock.runFor(500);
  expect(Number(await timeline.inputValue())).toBeGreaterThan(1.3);
  await page.clock.runFor(1500);
  await expect(page.getByRole("button", { name: "播放动画", exact: true })).toBeVisible();
  expect(Number(await timeline.inputValue())).toBe(3);
  await timeline.fill("1.5");
  expect(Number(await timeline.inputValue())).toBe(1.5);
  const x = await page.locator("#players #item-test-ball image").evaluate((el) => Number(el.getAttribute("x")));
  expect(x).toBeGreaterThan(300);
  expect(x).toBeLessThan(500);
});

test("step editing deletes the selected step and retains the remaining descriptions", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "步骤名称" })).toBeVisible();
  await page.getByRole("textbox", { name: "步骤名称" }).fill("边路接应");
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  await page.getByRole("textbox", { name: "步骤名称" }).fill("后点包抄");
  await page.getByRole("textbox", { name: "步骤要点" }).fill("弱侧前锋在出球后启动");
  await page.getByRole("spinbutton", { name: "当前帧" }).fill("2");
  await page.getByRole("spinbutton", { name: "当前帧" }).press("Tab");
  await page.getByRole("button", { name: "删除当前步骤", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "步骤名称" })).toHaveValue("后点包抄");
  await expect(page.getByRole("textbox", { name: "步骤要点" })).toHaveValue("弱侧前锋在出球后启动");
  await page.getByRole("button", { name: "返回战术板", exact: true }).click();
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await expect(page.locator(".timeline-step")).toHaveCount(2);
});

test("saving a tactic preserves its animation across reload and legacy tactics clear it", async ({ page }) => {
  await openBoard(page);
  await makeMovement(page);
  const save = page.getByRole("button", { name: "保存战术", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator(".el-message--success")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.locator(".tactic-item").getByRole("button", { name: "打开", exact: true }).click();
  await page.getByRole("button", { name: "关闭战术库" }).click();
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await expect(page.locator(".timeline-step")).toHaveCount(2);
  const result = await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const { useAnimationStore } = await import("/src/stores/animationStore.ts");
    const tactics = useTacticsStore();
    const snapshot = tactics.snapshotBoard();
    await tactics.importTactic("旧战术", [], { items: [], drawings: [], keyframes: [] });
    return {
      savedFrames: snapshot.animation?.frames.length,
      count: useAnimationStore().currentAnimationFrameCount,
      playing: useAnimationStore().isPlaying,
    };
  });
  expect(result).toEqual({ savedFrames: 2, count: 0, playing: false });
});

test("presets provide coaching plans and distinct multi-step demonstrations", async ({ page }) => {
  await openBoard(page);
  const result = await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    await useTacticsStore().importSeedTactics();
    const all = await (await fetch("/api/tactics")).json();
    return all.map((t) => ({
      title: t.title,
      objective: t.board.trainingPlan?.objective,
      notes: t.board.trainingPlan?.instructions,
      frames: t.board.demonstration?.stages.length ?? 0,
    }));
  });
  expect(result).toHaveLength(10);
  expect(result.every((t) => t.objective && t.notes && t.notes.length > 50)).toBe(true);
  expect(result.filter((t) => t.frames >= 4)).toHaveLength(3);
  await page.getByRole("button", { name: "动态演示", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "演示场景" })).toBeVisible();
  await selectUiOption(page.getByRole("combobox", { name: "演示场景" }), "press");
  const confirmation = page.getByRole("dialog", { name: "请确认操作" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "确认", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.locator(".timeline-title")).toContainText("高位逼抢");
  await expect(page.locator("#players > g")).toHaveCount(17);
});

test("animation backup and version rollback restore positions, timings and coaching steps", async ({ page }) => {
  await openBoard(page);
  await makeMovement(page);
  const result = await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const { useAnimationStore } = await import("/src/stores/animationStore.ts");
    const tactics = useTacticsStore(),
      animation = useAnimationStore();
    animation.switchFrame(1);
    animation.updateFrame({ title: "向前传球", note: "接球前观察", duration: 4.5 });
    await tactics.saveTactic("两步配合", [], null);
    const original = tactics.versions[tactics.currentId!][0];
    animation.updateFrame({ title: "调整后", duration: 2 });
    animation.updateElementPosition("test-ball", 900, 400);
    await tactics.saveTactic("两步配合", [], null);
    await tactics.rollback(original);
    const rolledBack = animation.getSnapshot();
    await tactics.quickSave();
    const backup = JSON.parse(await tactics.exportBackup());
    await tactics.importBackup(backup);
    const restored = (await (await fetch("/api/tactics")).json()).sort((a, b) => b.tacticId - a.tacticId)[0];
    await tactics.loadTactic(restored.tacticId);
    return { rolledBack, restored: animation.getSnapshot() };
  });
  for (const snapshot of [result.rolledBack, result.restored]) {
    expect(snapshot?.frames[1]).toMatchObject({ title: "向前传球", note: "接球前观察", duration: 4.5 });
    expect(snapshot?.frames[1].elements[0]).toEqual({ id: "test-ball", x: 600, y: 300 });
  }
});

test("upgraded presets preserve existing user tactics and repeated imports do not duplicate them", async ({ page }) => {
  await openBoard(page);
  const result = await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const store = useTacticsStore();
    await store.saveTactic("边路下底传中", ["个人方案"], null);
    const original = store.currentId!;
    const first = await store.importSeedTactics();
    const second = await store.importSeedTactics();
    return {
      first,
      second,
      count: (await (await fetch("/api/tactics")).json()).length,
      original: await (await fetch(`/api/tactics/${original}`)).json(),
    };
  });
  expect(result).toMatchObject({ first: 10, second: 0, count: 11 });
  expect(result.original?.tags).toEqual(["个人方案"]);
  expect(result.original?.board.demonstration).toBeUndefined();
});

test("presentation keeps the current animation playing and displays its coaching note", async ({ page }) => {
  await openBoard(page);
  await page.getByRole("button", { name: "动态演示", exact: true }).click();
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  await page.getByRole("button", { name: "演示", exact: true }).click();
  await expect(page.locator(".board")).toHaveClass(/presenting/);
  await expect(page.getByRole("button", { name: "暂停动画", exact: true })).toBeVisible();
  await expect(page.locator(".step-brief")).not.toBeEmpty();
  await page.getByRole("button", { name: "退出演示", exact: true }).click();
  await expect(page.locator(".animation-timeline")).toBeVisible();
});

test("demonstration keyframes keep opposing player markers readable", async ({ page }) => {
  await openBoard(page);
  const minimum = await page.evaluate(async () => {
    const { buildScenario, TACTICAL_SCENARIOS } = await import("/src/data/tacticalScenarios.ts");
    let minimum = Infinity;
    for (const scenario of TACTICAL_SCENARIOS) {
      const animation = buildScenario(scenario.id, []);
      for (let frame = 0; frame < animation.frames.length; frame++) {
        const players = animation.getFrameElements(frame).filter((p) => p.elementType === "player");
        for (let i = 0; i < players.length; i++)
          for (let j = i + 1; j < players.length; j++) {
            minimum = Math.min(minimum, Math.hypot(players[i].x - players[j].x, players[i].y - players[j].y));
          }
      }
    }
    return minimum;
  });
  expect(minimum).toBeGreaterThan(50);
});
