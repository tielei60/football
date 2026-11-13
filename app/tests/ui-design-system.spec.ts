import { test, expect } from "./fixtures";
import { selectUiOption, expectUiValue } from "./ui-select";

test("keyboard custom choices preserve number and null values through real match writes", async ({ page, request }) => {
  const season = await (
    await request.post("/api/seasons", {
      data: { name: "控件类型回归季", startDate: "2094-08-01", endDate: "2095-07-31" },
    })
  ).json();
  await page.goto("/club");
  await page.getByRole("button", { name: "新建比赛", exact: true }).click();
  const format = page.getByRole("combobox", { name: "比赛人数制", exact: true });
  await expectUiValue(format, null);
  // Clicking the visible label must activate the visible combobox, not its hidden form bridge.
  await page
    .locator("label")
    .filter({ has: format })
    .click({ position: { x: 8, y: 8 } });
  await expect(format).toBeFocused();
  await expect(format).toHaveAttribute("aria-expanded", "true");
  await format.press("End");
  await format.press("Escape");
  await expectUiValue(format, null);
  await expect(format).toBeFocused();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await format.press("ArrowDown");
  await format.press("Home");
  await format.press("ArrowDown");
  await format.press("Enter");
  await expectUiValue(format, 5);
  await selectUiOption(page.getByRole("combobox", { name: "归属赛季", exact: true }), season.id);
  await page.getByLabel("对手", { exact: true }).fill("控件类型虚构对手");
  await page.getByLabel("比赛日期").fill("2095-01-15");
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await expect(page.getByRole("heading", { name: "比赛信息与分析", exact: true })).toBeVisible();
  const id = Number(page.url().split("/").pop());
  const created = await (await request.get(`/api/matches/${id}`)).json();
  expect(created.format).toBe(5);
  expect(created.seasonId).toBe(season.id);
  expect(typeof created.seasonId).toBe("number");
  await selectUiOption(page.getByRole("combobox", { name: "比赛人数制", exact: true }), null);
  await selectUiOption(page.getByRole("combobox", { name: "归属赛季", exact: true }), null);
  await page.getByRole("button", { name: "保存比赛信息", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "比赛信息已保存" })).toHaveText("比赛信息已保存");
  const saved = await (await request.get(`/api/matches/${id}`)).json();
  expect(saved.format).toBeNull();
  expect(saved.seasonId).toBeNull();
});

test("custom select Tab and outside click dismiss without committing highlighted choices", async ({ page }) => {
  await page.goto("/club");
  const filter = page.getByRole("combobox", { name: "筛选状态", exact: true });
  await expectUiValue(filter, "");
  await filter.click();
  await filter.press("End");
  await filter.press("Tab");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expectUiValue(filter, "");
  await filter.click();
  await filter.press("ArrowDown");
  await page.getByRole("heading", { name: "球队比赛", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expectUiValue(filter, "");
  await filter.click();
  await expect(page.getByRole("option", { selected: true })).toHaveText("全部比赛");
  await filter.press("Escape");
  await expect(filter).toBeFocused();
});

test("styled confirmation preserves drafts on Escape and resets only after explicit confirmation", async ({
  page,
  request,
}) => {
  const match = await (
    await request.post("/api/matches", { data: { opponent: "确认对话框虚构对手", date: "2095-01-15" } })
  ).json();
  await page.goto(`/club/matches/${match.id}`);
  const opponent = page.getByLabel("对手", { exact: true });
  await opponent.fill("未保存虚构修改");
  const reset = page.getByRole("button", { name: "撤销信息修改", exact: true }).first();
  await reset.click();
  const dialog = page.getByRole("dialog", { name: "撤销信息修改", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opponent).toHaveValue("未保存虚构修改");
  await expect(reset).toBeFocused();
  await reset.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(opponent).toHaveValue("确认对话框虚构对手");
  const saved = await (await request.get(`/api/matches/${match.id}`)).json();
  expect(saved.opponent).toBe("确认对话框虚构对手");
});
