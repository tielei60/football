import { test, expect } from "./tactical-fixtures";

test("route re-entry restores saved tactic metadata without resetting drawer edits", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const form = page.locator(".save-box");
  await form.getByLabel("战术名称", { exact: true }).fill("跨页元信息保护");
  await form.getByLabel("对手", { exact: true }).fill("虚构紫杉队");
  await form.getByLabel("日期", { exact: true }).fill("2026-11-14");
  await form.getByLabel("比分", { exact: true }).fill("3 : 1");
  const tag = form.locator(".tag-btn").first();
  const tagName = (await tag.innerText()).trim();
  await tag.click();
  await form.getByRole("button", { name: "保存当前战术", exact: true }).click();
  await expect(page.getByText("战术已保存", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭战术库", exact: true }).click();
  await page.getByRole("link", { name: "← 俱乐部", exact: true }).click();
  await expect(page).toHaveURL(/\/club$/);
  await page.locator('a[href="/board"]').click();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await expect(form.getByLabel("战术名称", { exact: true })).toHaveValue("跨页元信息保护");
  await expect(form.getByLabel("对手", { exact: true })).toHaveValue("虚构紫杉队");
  await expect(form.getByLabel("日期", { exact: true })).toHaveValue("2026-11-14");
  await expect(form.getByLabel("比分", { exact: true })).toHaveValue("3 : 1");
  await expect(form.getByRole("button", { name: tagName, exact: true })).toHaveAttribute("aria-pressed", "true");
  await form.getByLabel("对手", { exact: true }).fill("虚构紫杉队·修订");
  await page.getByRole("button", { name: "关闭战术库", exact: true }).click();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await expect(form.getByLabel("对手", { exact: true })).toHaveValue("虚构紫杉队·修订");
  const saved = page.waitForResponse(
    (r) => r.url().includes("/api/tactics") && ["PUT", "POST"].includes(r.request().method()) && r.ok()
  );
  await form.getByRole("button", { name: "保存当前战术", exact: true }).click();
  await saved;
  const response = await request.get("/api/tactics");
  expect(response.ok()).toBeTruthy();
  const tactic = (await response.json()).find((t: { title: string }) => t.title === "跨页元信息保护");
  expect(tactic.tags).toContain(tagName);
  expect(tactic.match).toEqual({ opponent: "虚构紫杉队·修订", date: "2026-11-14", score: "3 : 1" });
});
