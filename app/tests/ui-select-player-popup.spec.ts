import { test, expect } from "./tactical-fixtures";

test("mouse selection in a teleported role menu keeps its player popup alive and still dismisses outside", async ({
  page,
}) => {
  await page.goto("/board");
  const player = page.locator("#players > g").filter({
    has: page.locator(".player-name", { hasText: "虚构战术队员01" }),
  });
  await player.locator("circle").first().click();
  const popup = player.locator(".popup");
  await expect(popup).toBeVisible();
  const role = popup.getByRole("combobox");
  await role.click();
  // This is a real mouse pointerdown/up/click sequence, not selectOption or dispatched change.
  await page.getByRole("option", { name: "前锋", exact: true }).click();
  await expect(popup).toBeVisible();
  await expect(role).toHaveAttribute("data-value", "FW");
  await expect(role).toBeFocused();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await role.click();
  await page.getByRole("option", { name: "后卫", exact: true }).click();
  await expect(role).toHaveAttribute("data-value", "DF");
  await role.click();
  await page.getByRole("button", { name: "选择 (V)", exact: true }).click();
  await expect(popup).toHaveCount(0);
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("successful browser Back cancels a pending tactic deletion without deleting saved data", async ({
  page,
  request,
}) => {
  await page.goto("/club");
  await page.getByRole("link", { name: "战术板 ↗", exact: true }).click();
  await expect(page.locator("#field")).toBeVisible();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.getByRole("textbox", { name: "战术名称", exact: true }).fill("导航取消删除虚构战术");
  await page.getByRole("button", { name: "保存当前战术", exact: true }).click();
  await expect(page.locator(".tactic-title", { hasText: "导航取消删除虚构战术" })).toBeVisible();
  const before = await (await request.get("/api/tactics")).json();
  await page.getByRole("button", { name: "删除战术", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "请确认操作", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/club$/);
  await expect(page.getByRole("dialog", { name: "请确认操作", exact: true })).toHaveCount(0);
  expect(await (await request.get("/api/tactics")).json()).toEqual(before);
  await page.getByRole("link", { name: "战术板 ↗", exact: true }).click();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await expect(page.locator(".tactic-title", { hasText: "导航取消删除虚构战术" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "请确认操作", exact: true })).toHaveCount(0);
});
