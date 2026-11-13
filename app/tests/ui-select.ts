import { expect, type Locator } from "@playwright/test";

type Choice = string | number | boolean | null | { label: string } | { index: number };

/** Choose through the public combobox/listbox, never the hidden form bridge. */
export async function selectUiOption(labelledControl: Locator, choice: Choice) {
  const control = labelledControl.and(labelledControl.page().getByRole("combobox"));
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await expect(control).toHaveAttribute("role", "combobox");
  await control.click();
  await expect(control).toHaveAttribute("aria-expanded", "true");
  const id = await control.getAttribute("aria-controls");
  expect(id, "custom select must identify its listbox").toBeTruthy();
  const list = control.page().locator(`[id=${JSON.stringify(id)}]`);
  await expect(list).toHaveAttribute("role", "listbox");
  await expect(list).toBeVisible();
  const options = list.getByRole("option");
  const option =
    choice !== null && typeof choice === "object"
      ? "label" in choice
        ? list.getByRole("option", { name: choice.label, exact: true })
        : options.nth(choice.index)
      : list.locator(`[role="option"][data-value=${JSON.stringify(String(choice))}]`);
  await expect(option).toHaveCount(1);
  await expect(option).not.toHaveAttribute("aria-disabled", "true");
  await option.click();
  await expect(control).toHaveAttribute("aria-expanded", "false");
  await expect(list).not.toBeVisible();
}

/** The visible trigger exposes the current raw value for typed model regressions. */
export async function expectUiValue(labelledControl: Locator, value: string | number | boolean | null) {
  const control = labelledControl.and(labelledControl.page().getByRole("combobox"));
  await expect(control).toBeVisible();
  await expect(control).toHaveAttribute("role", "combobox");
  await expect(control).toHaveAttribute("data-value", String(value));
}
