import { test, expect } from "./tactical-fixtures";

for (const verification of ["legacy-unverified", undefined] as const) {
  test(`本机迁移 ${verification ?? "旧服务缺标记"} 不报成功且保留本地入口`, async ({ page }) => {
    await page.goto("/board");
    await expect(page.locator("#field")).toBeVisible();
    await page.evaluate(async () => {
      const { db } = await import("/src/db.ts");
      await db.tactics.add({ title: "待核对本机战术", tags: [], fav: false, formationId: null,
        snapshot: { items: [], drawings: [], keyframes: [] }, thumb: null, createdAt: 1, updatedAt: 2 });
    });
    await page.route("**/api/tactic-collections", route => route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ importedCount: 0, receiptVerification: verification }) }));
    await page.reload();
    await page.getByRole("button", { name: "导入本机战术", exact: true }).click();
    await expect(page.locator(".el-message--warning")).toContainText("无法核验");
    await expect(page.locator(".el-message--success")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "导入本机战术", exact: true })).toBeEnabled();
    expect(await page.evaluate(async () => (await import("/src/db.ts")).db.tactics.count())).toBe(1);
  });
}

test("具名备份保留收据标识，未核验不会清除当前战术或显示恢复成功", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  let posted: any;
  await page.route("**/api/tactic-collections", route => {
    posted = route.request().postDataJSON();
    return route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ importedCount: 0, receiptVerification: "legacy-unverified" }) });
  });
  await page.evaluate(async () => { (await import("/src/stores/tacticsStore.ts")).useTacticsStore().currentId = 123; });
  const alerts: string[] = [];
  page.on("dialog", async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "恢复备份", exact: true }).click();
  await (await chooser).setFiles({ name: "战术.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
    collectionName: "旧具名备份", tactics: [], versions: [],
  })) });
  await expect.poll(() => alerts.length).toBe(1);
  expect(alerts[0]).toContain("未确认完整恢复");
  expect(alerts[0]).not.toContain("恢复成功");
  expect(posted.collectionName).toBe("旧具名备份");
  expect(await page.evaluate(async () => (await import("/src/stores/tacticsStore.ts")).useTacticsStore().currentId)).toBe(123);
});

test("已核验零新增与首次导入数量保留明确结果", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  for (const count of [0, 2]) {
    await page.route("**/api/tactic-collections", route => route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ importedCount: count, receiptVerification: "verified" }) }));
    const result = await page.evaluate(async () => {
      const store = (await import("/src/stores/tacticsStore.ts")).useTacticsStore();
      store.currentId = 123;
      const result = await store.importBackup({ tactics: [], versions: [] });
      return { result, id: store.currentId };
    });
    expect(result).toEqual({ result: { importedCount: count, receiptVerification: "verified" }, id: null });
    await page.unroute("**/api/tactic-collections");
  }
});

test("备份转换不创造名称，错误名称由服务端拒绝", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  const values = await page.evaluate(async () => {
    const { readCollection } = await import("/src/services/tacticLanguage.ts");
    return [readCollection({ tactics: [], versions: [] }), readCollection({ collectionName: 123, tactics: [], versions: [] })];
  });
  expect(values[0]).not.toHaveProperty("collectionName");
  expect(values[1].collectionName).toBe(123);
  expect((await request.post("/api/tactic-collections", { data: values[1] })).status()).toBe(400);
});

test("具名缺时间标准备份两次真实导入一致并保留历史末阶段曲线", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  const payload = { collectionName: "稳定具名旧备份", tactics: [{ title: "历史完整演示", tags: [], favorite: false, formationName: null, thumbnail: null,
    board: { pieces: [], markings: [], demonstration: { demonstrationId: "old-demo", title: "旧演示",
      participants: [{ pieceId: "old-player", kind: "player", x: 10, y: 20 }], stages: [{ stageNumber: 0, positions: [{ pieceId: "old-player", x: 10, y: 20 }] }], runs: [{ pieceId: "old-player", fromStage: 0, bend: { x: 20, y: 40 } }] } } }],
    versions: [{ tacticNumber: 0, note: "无时间版本", board: { pieces: [], markings: [] } }] };
  const convert = () => page.evaluate(async payload => (await import("/src/services/tacticLanguage.ts")).readCollection(payload), payload);
  const first = await convert();
  expect(first.tactics[0]).not.toHaveProperty("createdAt");
  expect(first.versions[0].createdAt).toBeUndefined();
  const created = await request.post("/api/tactic-collections", { data: first });
  const createdBody = await created.json();
  expect(created.ok(), JSON.stringify(createdBody)).toBeTruthy();
  expect(createdBody).toMatchObject({ importedCount: 1, receiptVerification: "verified" });
  const second = await convert();
  expect(second.tactics).toEqual(first.tactics);
  expect(second.versions).toEqual(first.versions);
  const duplicate = await request.post("/api/tactic-collections", { data: second });
  expect(duplicate.ok()).toBeTruthy();
  expect(await duplicate.json()).toMatchObject({ importedCount: 0, receiptVerification: "verified" });
  const saved = await (await request.get("/api/tactics")).json();
  expect(saved).toHaveLength(1);
  expect(saved[0].board.demonstration.runs).toEqual(payload.tactics[0].board.demonstration.runs);
});

test("旧快照缺演示标识转换稳定且刷新失败不冒充导入失败", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  const stable = await page.evaluate(async () => {
    const { readCollection } = await import("/src/services/tacticLanguage.ts");
    const input = { collectionName: "旧快照", tactics: [{ title: "旧", snapshot: { items: [], drawings: [],
      animation: { name: "旧动画", frames: [{ frameNumber: 0, elements: [] }], actions: [], sharedElementPool: [] } } }], versions: [] };
    return [readCollection(input).tactics, readCollection(input).tactics];
  });
  expect(stable[0]).toEqual(stable[1]);
  let posts = 0;
  await page.route("**/api/tactic-collections", route => { posts++; return route.fulfill({ status: 200,
    contentType: "application/json", body: JSON.stringify({ importedCount: 1, receiptVerification: "verified" }) }); });
  await page.route("**/api/tactics", route => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  const result = await page.evaluate(async () => (await import("/src/stores/tacticsStore.ts")).useTacticsStore().importBackup({ tactics: [], versions: [] }));
  expect(result).toEqual({ importedCount: 1, receiptVerification: "verified", listRefreshFailed: true });
  expect(posts).toBe(1);
});

test("本机迁移缺演示ID的旧快照两次真实请求不重复也不冲突", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.evaluate(async () => {
    const { db } = await import("/src/db.ts");
    const snapshot = { items: [], drawings: [], animation: { id: null, name: "历史动画", frames: [{ frameNumber: 0, elements: [] }], actions: [], sharedElementPool: [] } };
    const tacticId = await db.tactics.add({ title: "历史本机快照", tags: [], fav: false, formationId: null, snapshot, thumb: null, createdAt: 1, updatedAt: 2 });
    await db.versions.add({ tacticId, note: "历史版本", snapshot, createdAt: 1 });
  });
  const run = () => page.evaluate(async () => (await import("/src/services/tacticsApi.ts")).migrateLegacyTactics());
  expect(await run()).toEqual({ importedCount: 1, receiptVerification: "verified" });
  expect(await run()).toEqual({ importedCount: 0, receiptVerification: "verified" });
  expect(await (await request.get("/api/tactics")).json()).toHaveLength(1);
  expect(await page.evaluate(async () => (await import("/src/db.ts")).db.tactics.count())).toBe(1);
});
