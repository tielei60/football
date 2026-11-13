import { expect, type Locator, type Page } from "@playwright/test";
import { selectUiOption } from "./ui-select";

/** Native details retains its open state when the dialog is closed and reopened. */
export async function openManualMatchDate(panel: Locator) {
  const details = panel.locator("details").filter({ hasText: "手动输入日期" });
  await expect(panel).toBeVisible();
  if ((await details.getAttribute("open")) === null) {
    await details.getByText("手动输入日期", { exact: true }).click();
  }
  await expect(panel.getByLabel("日期（YYYY-MM-DD）", { exact: true })).toBeVisible();
}

/** Exercise the visible composed calendar, never its hidden form-validation bridge. */
export async function setMatchSchedule(page: Page, date: string, kickoff?: string) {
  await page.getByRole("button", { name: /^开始日期时间/ }).click();
  const panel = page.getByRole("dialog", { name: "设置开始日期时间", exact: true });
  await expect(panel).toBeVisible();
  await openManualMatchDate(panel);
  await panel.getByLabel("日期（YYYY-MM-DD）", { exact: true }).fill(date);
  if (kickoff !== undefined) {
    await selectUiOption(
      panel.getByRole("combobox", { name: "开球小时", exact: true }),
      kickoff ? kickoff.slice(0, 2) : ""
    );
    if (kickoff) await selectUiOption(panel.getByRole("combobox", { name: "开球分钟", exact: true }), kickoff.slice(3));
  }
  await panel.getByRole("button", { name: "确定时间", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^开始日期时间/ })).toContainText(date);
}
