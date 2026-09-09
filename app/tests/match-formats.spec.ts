import { test, expect } from "./fixtures";
import { MATCH_FORMATIONS, MATCH_PLAYER_COUNTS } from "../src/data/matchFormats";

test("every formation has one goalkeeper and the correct number of players", () => {
  for (const size of MATCH_PLAYER_COUNTS) {
    const formations = MATCH_FORMATIONS[size];
    expect(new Set(formations.map((f) => f.id)).size).toBe(formations.length);
    for (const formation of formations) {
      expect(formation.spots).toHaveLength(size);
      expect(formation.spots.filter((spot) => spot.role === "GK")).toHaveLength(1);
      if (formation.category === "常规") {
        expect(formation.name.split("-").reduce((sum, line) => sum + Number(line), 1)).toBe(size);
      }
    }
  }
});

test("each match size offers working home and opponent formation choices on mobile", async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/board");
  for (const size of MATCH_PLAYER_COUNTS) {
    await page.getByRole("combobox", { name: "比赛人数", exact: true }).selectOption(String(size));
    for (const formation of MATCH_FORMATIONS[size].filter((f) => f.category === "常规")) {
      const choice = page.getByRole("button", { name: formation.name, exact: true });
      await choice.click();
      await expect(choice).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("combobox", { name: "对手阵型" }).selectOption(formation.id);
      await expect(page.locator(".roster-item.on")).toHaveCount(size);
      await expect(page.locator("#players > g")).toHaveCount(size * 2);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await page.getByRole("combobox", { name: "比赛人数", exact: true }).selectOption("11");
  await page.screenshot({ path: "test-results/formation-options-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.screenshot({ path: "test-results/formation-options-desktop.png", fullPage: true });
});

test("match formats resize both teams and survive undo, save and reload", async ({ page, request }) => {
  await page.goto("/board");
  const count = page.getByRole("combobox", { name: "比赛人数", exact: true });
  await expect(count).toHaveValue("8");
  await expect(page.locator(".roster-item.on")).toHaveCount(8);
  await page.getByRole("combobox", { name: "对手阵型" }).selectOption("2-3-2");
  for (const size of [11, 9, 6, 5, 7, 8]) {
    await count.selectOption(String(size));
    await expect(page.locator(".roster-item.on")).toHaveCount(size);
    await expect(page.locator("#players > g")).toHaveCount(size * 2);
    await expect(page.locator(".pitch-size")).toHaveText(`${size} 人制`);
  }
  await count.selectOption("11");
  await page.locator("h1").click();
  await page.keyboard.press("Control+z");
  await expect(count).toHaveValue("8");
  await expect(page.locator("#players > g")).toHaveCount(16);
  await page.keyboard.press("Control+y");
  await expect(count).toHaveValue("11");
  await expect(page.locator("#players > g")).toHaveCount(22);
  await expect(page.locator(".watermark")).toContainText("11人制");
  await expect(page.getByRole("combobox", { name: "对手阵型" })).toHaveValue("custom");
  await page.getByRole("button", { name: "保存战术", exact: true }).click();
  await expect.poll(async () => (await (await request.get("/api/tactics")).json())[0]?.board.playerCount).toBe(11);
  await expect(page.getByLabel("保存状态")).toContainText("已保存");
  await page.reload();
  await expect(count).toHaveValue("11");
  await expect(page.locator("#players > g")).toHaveCount(22);
  await page.screenshot({ path: "test-results/match-format-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(count).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/match-format-mobile.png", fullPage: true });
});

test("API rejects unsupported match sizes and accepts every preset", async ({ request }) => {
  for (const playerCount of [5, 6, 7, 8, 9, 11, 10, 0, "8"]) {
    const { edition } = await (await request.get("/api/coaching-desk")).json();
    const response = await request.put("/api/coaching-desk", {
      data: {
        edition,
        desk: { board: { pieces: [], markings: [], playerCount }, players: [], selectedTacticId: null },
      },
    });
    expect(response.ok()).toBe([5, 6, 7, 8, 9, 11].includes(playerCount as number));
  }
});
