import { test, expect } from "./tactical-fixtures";

const formationButton = (name: string) => `.formation-segment button:has-text("${name}")`;

test("阵型选择写入战术存档，重开后回填高亮", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await expect(page.locator(".roster-item.on")).toHaveCount(8);

  // 1. 选模板 → 画布徽标展示血缘
  await page.locator(formationButton("3-3-1")).click();
  await expect(page.locator(".board-badge.template")).toContainText("模板：3-3-1");

  // 2. 保存 → 存档带阵型，列表展示阵型名
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await expect(page.locator(".current-card")).toContainText("模板：3-3-1");
  await page.getByRole("textbox", { name: "战术名称", exact: true }).fill("阵型血缘战术");
  await page.getByRole("button", { name: "保存当前战术" }).click();
  await expect(page.locator(".tactic-title", { hasText: "阵型血缘战术" })).toBeVisible();
  await expect
    .poll(async () => (await (await request.get("/api/tactics")).json())[0]?.formationName)
    .toBe("3-3-1");
  await expect(page.locator(".tactic-formation", { hasText: "3-3-1" })).toBeVisible();
  await expect(page.locator(".current-card")).toContainText("✓ 已保存");

  // 3. 切走再打开 → 模板高亮回填
  await page.getByRole("button", { name: "关闭战术库", exact: true }).click();
  await page.locator(formationButton("2-3-2")).click();
  await expect(page.locator(".board-badge.template")).toContainText("模板：2-3-2");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page.locator(formationButton("3-3-1"))).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".board-badge.template")).toContainText("模板：3-3-1");
});

test("默认阵型可设并在切换人数后沿用", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();

  await page.locator(formationButton("3-3-1")).click();
  await page.getByRole("button", { name: /设为默认/ }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("football-default-formations")))
    .toContain("3-3-1");
  await expect(page.locator(formationButton("3-3-1"))).toContainText("★");

  const count = page.getByRole("combobox", { name: "比赛人数", exact: true });
  await count.selectOption("11");
  await expect(page.locator(formationButton("4-4-2"))).toHaveAttribute("aria-pressed", "true");
  await count.selectOption("8");
  await expect(page.locator(formationButton("3-3-1"))).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".board-badge.template")).toContainText("（默认）");
});

test("有走位线条时一键落位先确认", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();

  // 画一条线（S 传球线 + 拖拽由 startDrawing 处理，此处直接构造一条线条）
  await page.evaluate(async () => {
    const { useDrawStore } = await import("/src/stores/drawStore.ts");
    const { Drawing } = await import("/src/types/drawing.ts");
    useDrawStore().drawings.add(
      new Drawing({ startX: 200, startY: 200, endX: 400, endY: 400 } as never)
    );
  });

  let dialogMessage = "";
  page.on("dialog", async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.dismiss();
  });
  await page.locator(formationButton("3-3-1")).click();
  expect(dialogMessage).toContain("一键落位");
  // 拒绝后模板保持不变
  await expect(page.locator(formationButton("3-3-1"))).toHaveAttribute("aria-pressed", "false");
});
