import type { Page } from "@playwright/test";

// Explicitly use the same disclosure button as a desktop user; compact panels already show all fields.
export async function openAnimationDetails(page: Page) {
  const edit = page.getByRole("button", { name: "编辑步骤", exact: true });
  if (await edit.isVisible()) await edit.click();
}
