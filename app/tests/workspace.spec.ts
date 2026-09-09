import { test, expect } from "./fixtures";

test("opens the workspace directly and keeps drawing controls usable after zoom", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#field")).toBeVisible();
  const select = page.getByRole("button", { name: "选择 (V)", exact: true });
  const before = await select.boundingBox();
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect(page.locator("#field")).not.toHaveAttribute("viewBox", "0 0 1250 826");
  const after = await select.boundingBox();
  expect(after?.width).toBe(before?.width);
  expect(after?.x).toBe(before?.x);
  await select.click();
  await expect(select).toHaveAttribute("aria-pressed", "true");
});

test("filters roster by availability and recovers from an empty search", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "替补", exact: true }).click();
  await expect(page.locator(".roster-item.on")).toHaveCount(0);
  await expect(page.locator(".roster-item").first()).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索队员" }).fill("不存在的队员");
  await expect(page.getByText("未找到匹配的队员")).toBeVisible();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await expect(page.locator(".roster-item")).toHaveCount(20);
});

test("roster loads CSV positions and supports selecting multiple enumerated positions", async ({ page }) => {
  await page.goto("/board");
  const player = page.locator(".roster-item").filter({ has: page.locator(".roster-name", { hasText: "刘作涛" }) });
  await expect(player.locator(".roster-pos")).toHaveText("中后卫、后腰");
  const pitchPlayer = page.locator("#players > g").filter({ has: page.locator(".player-name", { hasText: "刘作涛" }) });
  await expect(pitchPlayer.locator(".player-position")).toHaveText("中后卫、后腰");
  await player.getByRole("button", { name: "刘作涛 队员详情" }).click();
  await expect(player.getByRole("checkbox", { name: "中后卫", exact: true })).toBeChecked();
  await expect(player.getByRole("checkbox", { name: "后腰", exact: true })).toBeChecked();
  await player.getByRole("checkbox", { name: "前腰", exact: true }).check();
  await expect(player.locator(".roster-pos")).toHaveText("中后卫、后腰、前腰");
  await expect(page.getByLabel("保存状态")).toContainText("已保存");
  await page.reload();
  await expect(player.locator(".roster-pos")).toHaveText("中后卫、后腰、前腰");
});

test("default formation assigns starters to position-matched slots", async ({ page }) => {
  await page.goto("/board");
  const lineup = await page.locator("#players > g").evaluateAll((groups) =>
    groups
      .map((group) => ({
        name: group.querySelector(".player-name")?.textContent?.trim(),
        x: Number(group.querySelector("circle")?.getAttribute("cx")),
        y: Number(group.querySelector("circle")?.getAttribute("cy")),
      }))
      .filter((player) => player.name)
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map((player) => player.name)
  );

  expect(lineup[0]).toBe("刘建宏");
  expect(lineup.slice(1, 3).sort()).toEqual(["刘作涛", "朱子言"].sort());
  expect(lineup.slice(3, 6).sort()).toEqual(["史丙林", "余哲", "韩达"].sort());
  expect(lineup.slice(6).sort()).toEqual(["妥昰", "王伟"].sort());
});

test("new players can enter the pitch and injured players are excluded from formations", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("textbox", { name: "新队员姓名" }).fill("测试队员");
  await page.getByRole("button", { name: "新增队员", exact: true }).click();
  const added = page.locator(".roster-item").filter({ has: page.locator(".roster-name", { hasText: "测试队员" }) });
  await expect(added.getByRole("button", { name: "上场", exact: true })).toBeEnabled();
  await added.getByRole("button", { name: "上场", exact: true }).click();
  await expect(added.getByRole("button", { name: "下场", exact: true })).toBeVisible();
  const first = page.locator(".roster-item").first();
  await first.getByRole("button", { name: /队员详情/ }).click();
  await first.getByRole("combobox", { name: "状态", exact: true }).selectOption("injured");
  await page.getByRole("button", { name: "3-3-1", exact: true }).click();
  await expect(first.getByRole("button", { name: "上场", exact: true })).toBeDisabled();
  await expect(page.locator(".roster-item.on")).toHaveCount(8);
});

test("saves a tactic and can close the library using its own close control", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "保存战术", exact: true }).click();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await expect(page.locator(".tactic-item").first()).toBeVisible();
  await page.getByRole("button", { name: "关闭战术库", exact: true }).click();
  await expect(page.locator(".tactics-drawer")).toHaveCount(0);
});

test("mobile workspace fits the viewport and keeps tools reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/board");
  await page.getByRole("button", { name: "绘图", exact: true }).click();
  await expect(page.getByRole("button", { name: "选择 (V)", exact: true })).toBeVisible();
  const heading = await page.getByRole("heading", { level: 1 }).boundingBox();
  expect(heading?.y).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const size = await page.getByRole("button", { name: "选择 (V)", exact: true }).boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(40);
  expect(size?.height).toBeGreaterThanOrEqual(40);
});

test("pitch palette is reachable and adds a ball by dragging", async ({ page }) => {
  await page.goto("/board");
  const ball = page.locator("#toolbar-drag image");
  const box = await ball.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  expect(
    await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("#toolbar-drag"), { x: cx, y: cy })
  ).toBe(true);
  const before = await page.locator("#players > g").count();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 130, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#players > g")).toHaveCount(before + 1);
});

test("animation frames play and export produces a PNG", async ({ page }) => {
  await page.goto("/board");
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "当前帧" })).toHaveValue("2");
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  await expect(page.getByRole("button", { name: "暂停动画", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回战术板", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
});
