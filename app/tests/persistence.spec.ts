import { test, expect, authenticateAdmin } from "./tactical-fixtures";

test("legacy browser tactics import into the server once with their version history", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.evaluate(async () => {
    const { db } = await import("/src/db.ts");
    const snapshot = {
      items: [],
      drawings: [],
      keyframes: [],
      coaching: { objective: "旧战术训练目标", instructions: "保留历史", durationMinutes: 20 },
    };
    const tacticId = await db.tactics.add({
      title: "本机旧战术",
      tags: ["进攻"],
      fav: true,
      formationId: "2-3-2",
      snapshot,
      thumb: null,
      createdAt: 1,
      updatedAt: 2,
    });
    await db.versions.add({ tacticId, note: "原始版本", snapshot, createdAt: 1 });
  });
  await page.reload();
  await page.getByRole("button", { name: "导入本机战术", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/tactics")).json()).length).toBe(1);
  const [saved] = await (await request.get("/api/tactics")).json();
  expect(saved).toMatchObject({
    title: "本机旧战术",
    favorite: true,
    board: { trainingPlan: { objective: "旧战术训练目标" } },
  });
  const versions = await (await request.get(`/api/tactics/${saved.tacticId}/versions`)).json();
  expect(versions).toHaveLength(1);
  expect(versions[0]).toMatchObject({ note: "原始版本", board: { trainingPlan: { objective: "旧战术训练目标" } } });
  await page.evaluate(async () => {
    const { migrateLegacyTactics } = await import("/src/services/tacticsApi.ts");
    await migrateLegacyTactics();
  });
  expect((await (await request.get("/api/tactics")).json()).length).toBe(1);
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/db.ts");
      return db.tactics.count();
    })
  ).toBe(1);
});

test("saved tactics are available in a fresh browser without browser storage", async ({ page, browser }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.getByRole("textbox", { name: "战术名称", exact: true }).fill("跨浏览器持久化战术");
  await page.getByRole("button", { name: "保存当前战术" }).click();
  await expect(page.locator(".tactic-title", { hasText: "跨浏览器持久化战术" })).toBeVisible();

  const freshContext = await browser.newContext();
  try {
    await authenticateAdmin(freshContext.request, page.url());
    expect((await freshContext.storageState()).origins).toEqual([]);
    const freshPage = await freshContext.newPage();
    await freshPage.goto(new URL("/board", page.url()).href);
    await freshPage.getByRole("button", { name: "战术库", exact: true }).click();
    await expect(freshPage.locator(".tactic-title", { hasText: "跨浏览器持久化战术" })).toBeVisible();
  } finally {
    await freshContext.close();
  }
});

test("a fresh browser restores the roster, board, training plan and animation from the coaching desk", async ({
  page,
  browser,
  request,
}) => {
  await page.goto("/board");
  await expect(page.locator(".roster-item").first()).toBeVisible();
  await page.getByRole("textbox", { name: "新队员姓名" }).fill("持久化新队员");
  await page.getByRole("button", { name: "新增队员", exact: true }).click();
  await page.evaluate(async () => {
    const { useCoachingStore } = await import("/src/stores/coachingStore.ts");
    const { useAnimationStore } = await import("/src/stores/animationStore.ts");
    const { useItemStore } = await import("/src/stores/itemStore.ts");
    const coaching = useCoachingStore();
    coaching.plan = { objective: "后场出球训练", instructions: "门将参与传递", durationMinutes: 35 };
    const item = useItemStore().items.findByCreationMode("normal")[0];
    item.x = 321;
    item.y = 456;
    const animation = useAnimationStore();
    animation.openAnimationFromBoard(useItemStore().items.findByCreationMode("normal"));
    animation.addFrame();
    animation.updateFrame({ title: "向边路出球", note: "观察接应位置", duration: 4.5 });
  });
  await expect
    .poll(async () => {
      const { desk } = await (await request.get("/api/coaching-desk")).json();
      return desk?.board.demonstration?.stages[1]?.title;
    })
    .toBe("向边路出球");

  const freshContext = await browser.newContext();
  try {
    await authenticateAdmin(freshContext.request, page.url());
    const fresh = await freshContext.newPage();
    await fresh.goto(new URL("/board", page.url()).href);
    await expect(fresh.locator(".roster-name", { hasText: "持久化新队员" })).toBeVisible();
    const restored = await fresh.evaluate(async () => {
      const { useCoachingStore } = await import("/src/stores/coachingStore.ts");
      const { useAnimationStore } = await import("/src/stores/animationStore.ts");
      const { useItemStore } = await import("/src/stores/itemStore.ts");
      return {
        plan: useCoachingStore().plan,
        position: useItemStore()
          .items.findByCreationMode("normal")
          .map(({ x, y }) => ({ x, y }))[0],
        frames: useAnimationStore().getSnapshot()?.frames,
      };
    });
    expect(restored.plan).toEqual({ objective: "后场出球训练", instructions: "门将参与传递", durationMinutes: 35 });
    expect(restored.position).toEqual({ x: 321, y: 456 });
    expect(restored.frames).toHaveLength(2);
    expect(restored.frames?.[1]).toMatchObject({ title: "向边路出球", note: "观察接应位置", duration: 4.5 });
  } finally {
    await freshContext.close();
  }
});

test("a failed desk write reports failure and keeps the previous server state", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.getByLabel("保存状态")).toContainText("草稿已同步到服务器");
  const before = await (await request.get("/api/coaching-desk")).json();
  await page.route("**/api/coaching-desk", (route) => {
    if (route.request().method() === "PUT") {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "服务暂时不可用" }),
      });
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "训练计划", exact: true }).click();
  await page.getByRole("textbox", { name: "训练目标" }).fill("尚未写入后端的目标");
  await expect(page.getByLabel("保存状态")).toContainText("草稿同步失败");
  expect((await (await request.get("/api/coaching-desk")).json()).desk).toEqual(before.desk);
  await expect(page.locator(".el-message--success")).toHaveCount(0);
});

test("a failed tactic save does not report success or create a library entry", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.route("**/api/tactics", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "服务暂时不可用" }),
      });
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "保存战术", exact: true }).click();
  await expect(page.locator(".el-message--error")).toBeVisible();
  await expect(page.locator(".el-message--success")).toHaveCount(0);
  expect(await (await request.get("/api/tactics")).json()).toEqual([]);
});

test("an intentionally empty desk stays empty after reload", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.locator(".roster-item.on")).toHaveCount(8);
  await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    useTacticsStore().newBoard();
  });
  await expect
    .poll(async () => {
      const { desk } = await (await request.get("/api/coaching-desk")).json();
      return desk?.board.pieces.length;
    })
    .toBe(0);
  await page.reload();
  await expect(page.locator("#field")).toBeVisible();
  await expect(page.locator(".roster-item.on")).toHaveCount(0);
  await expect(page.locator("#players > g")).toHaveCount(0);
});

test("concurrent desks report conflicts without overwriting another browser's changes", async ({
  page,
  browser,
  request,
}) => {
  await page.goto("/board");
  await expect(page.getByLabel("保存状态")).toContainText("草稿已同步到服务器");
  const otherContext = await browser.newContext();
  try {
    await authenticateAdmin(otherContext.request, page.url());
    const other = await otherContext.newPage();
    await other.goto(new URL("/board", page.url()).href);
    await expect(other.getByLabel("保存状态")).toContainText("草稿已同步到服务器");
    await page.getByRole("button", { name: "训练计划", exact: true }).click();
    await page.getByRole("textbox", { name: "训练目标" }).fill("先保存的训练目标");
    await expect
      .poll(async () => {
        const { desk } = await (await request.get("/api/coaching-desk")).json();
        return desk?.board.trainingPlan.objective;
      })
      .toBe("先保存的训练目标");
    await other.getByRole("button", { name: "训练计划", exact: true }).click();
    await other.getByRole("textbox", { name: "训练目标" }).fill("过期页面的训练目标");
    await expect(other.getByLabel("保存状态")).toContainText("工作台已在其他页面修改");
    const { desk } = await (await request.get("/api/coaching-desk")).json();
    expect(desk.board.trainingPlan.objective).toBe("先保存的训练目标");
  } finally {
    await otherContext.close();
  }
});

test("save status fits desktop and mobile workspaces", async ({ page }, testInfo) => {
  await page.goto("/board");
  await expect(page.getByLabel("保存状态")).toContainText("草稿已同步到服务器");
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#field")).toBeVisible();
    await expect(page.getByLabel("保存状态")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    const bounds = await page.getByLabel("保存状态").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`workspace-${viewport.width}.png`), fullPage: true });
  }
});

test("deleting the selected tactic elsewhere detaches it and preserves subsequent desk edits", async ({
  page,
  request,
}) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.getByRole("button", { name: "保存战术", exact: true }).click();
  await expect
    .poll(async () => {
      const { desk } = await (await request.get("/api/coaching-desk")).json();
      return desk?.selectedTacticId;
    })
    .toEqual(expect.any(Number));
  const before = await (await request.get("/api/coaching-desk")).json();
  expect((await request.delete(`/api/tactics/${before.desk.selectedTacticId}`)).ok()).toBe(true);
  await page.getByRole("button", { name: "训练计划", exact: true }).click();
  await page.getByRole("textbox", { name: "训练目标" }).fill("战术删除后继续训练");
  await expect
    .poll(async () => {
      const { desk } = await (await request.get("/api/coaching-desk")).json();
      return desk?.board.trainingPlan.objective;
    })
    .toBe("战术删除后继续训练");
  await expect(page.getByLabel("保存状态")).toContainText("草稿已同步到服务器");
  const { desk } = await (await request.get("/api/coaching-desk")).json();
  expect(desk.selectedTacticId).toBeNull();
  expect(desk.players).toEqual(before.desk.players);
  expect(desk.board.pieces).toEqual(before.desk.board.pieces);
});

test("formation metadata survives tactic save, versions and backup conversion", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.getByLabel("保存状态")).toContainText("草稿已同步到服务器");
  await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const store = useTacticsStore();
    store.applyFormationState("2-3-2", "3-3-1");
    store.markBoardEdited();
    await store.saveTactic("阵型元数据", []);
  });
  const [saved] = await (await request.get("/api/tactics")).json();
  const expected = { formationId: "2-3-2", awayFormationId: "3-3-1", formationCustomized: true };
  expect(saved.board).toMatchObject(expected);
  const [version] = await (await request.get(`/api/tactics/${saved.tacticId}/versions`)).json();
  expect(version.board).toMatchObject(expected);
  const converted = await page.evaluate(async (tactic) => {
    const { readCollection } = await import("/src/services/tacticLanguage.ts");
    return readCollection({ tactics: [tactic] }).tactics[0].board;
  }, saved);
  expect(converted).toMatchObject(expected);
});

test("metadata-only edits autosave and remain customized after reload", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.getByLabel("保存状态")).toContainText("草稿已同步到服务器");
  await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    useTacticsStore().applyFormationState("2-3-2", "3-3-1");
    useTacticsStore().markBoardEdited();
  });
  await expect
    .poll(async () => (await (await request.get("/api/coaching-desk")).json()).desk.board.formationCustomized)
    .toBe(true);
  await page.reload();
  await expect(page.locator("#field")).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
      return useTacticsStore().formationCustomized;
    })
  ).toBe(true);
});

test("editing during a tactic save keeps the newer draft dirty", async ({ page }) => {
  await page.goto("/board");
  await expect(page.getByLabel("保存状态")).toContainText("草稿已同步到服务器");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const received = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/tactics", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    started();
    await gate;
    await route.continue();
  });
  const saving = page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    await useTacticsStore().saveTactic("保存中编辑", []);
  });
  await received;
  await page.evaluate(async () => {
    const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
    const { useCoachingStore } = await import("/src/stores/coachingStore.ts");
    useCoachingStore().plan.objective = "请求发出后的修改";
    useTacticsStore().markBoardEdited();
  });
  release();
  await saving;
  expect(
    await page.evaluate(async () => {
      const { useTacticsStore } = await import("/src/stores/tacticsStore.ts");
      return useTacticsStore().boardDirty;
    })
  ).toBe(true);
});
