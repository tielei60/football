import { openAnimationDetails } from "./animation-editor";
import { test, expect } from "./tactical-fixtures";

async function openSteps(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1180, height: 757 });
  await page.goto("/board");
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  await openAnimationDetails(page);
  await page.getByRole("textbox", { name: "步骤名称" }).fill("虚构第二步");
}

test("1180px workspace keeps the pitch and playback controls visible with independent draft/archive states", async ({
  page,
  request,
}) => {
  await openSteps(page);
  await expect(page.getByRole("button", { name: "播放动画", exact: true })).toBeInViewport();
  await expect(page.locator(".timeline-transport")).toBeInViewport({ ratio: 1 });
  const field = (await page.locator("#field").boundingBox())!;
  expect(field.height).toBeGreaterThanOrEqual(190);
  expect(field.y + field.height).toBeLessThanOrEqual(757);
  await expect(page.getByLabel("保存状态")).toHaveText("草稿已同步到服务器");
  await expect(page.locator(".board-badge.draft")).toHaveText("战术尚未存档");
  expect(await (await request.get("/api/tactics")).json()).toHaveLength(0);
  await page.getByRole("button", { name: "保存动画", exact: true }).click();
  await expect(page.locator(".board-badge.clean")).toHaveText("✓ 已存入战术库");
  await openAnimationDetails(page);
  await page.getByRole("textbox", { name: "步骤名称" }).fill("存档之后的草稿修改");
  await expect(page.getByLabel("保存状态")).toHaveText("草稿已同步到服务器");
  await expect(page.locator(".board-badge.dirty")).toContainText("有未存档修改");
  await page.screenshot({ path: "test-results/board-layout-1180-animation.png" });
});

test("animation delete names its target, cancels safely, and only deletes the confirmed step", async ({ page }) => {
  await openSteps(page);
  const remove = page.getByRole("button", { name: "删除当前步骤", exact: true });
  await remove.click();
  const dialog = page.getByRole("dialog", { name: "请确认操作" });
  await expect(dialog).toContainText("虚构第二步");
  await expect(dialog).toContainText("不可撤销");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(remove).toBeFocused();
  await expect(page.locator(".timeline-step")).toHaveCount(2);
  await remove.click();
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator(".timeline-step")).toHaveCount(1);
});

["step", "playback"].forEach((change) => {
  test(`pending step deletion cannot delete after background ${change} changes`, async ({ page }) => {
    await openSteps(page);
    await page.getByRole("button", { name: "删除当前步骤", exact: true }).click();
    // Deliberate async race injection; user interaction is blocked by the confirmation modal.
    await page.evaluate(async (kind) => {
      const store = (await import("../../../../../../src/stores/animationStore.ts")).useAnimationStore();
      if (kind === "step") store.switchFrame(0);
      else {
        store.startAutoPlay();
        store.stopAutoPlay();
      }
    }, change);
    await page.getByRole("dialog", { name: "请确认操作" }).getByRole("button", { name: "确认", exact: true }).click();
    await expect(page.locator(".timeline-step")).toHaveCount(2);
    await expect(page.getByText("当前步骤或播放状态已变化，未删除任何步骤", { exact: true })).toBeVisible();
  });
});

test("invalid animation duration restores its actual value and playback explains disabled editing", async ({
  page,
}) => {
  await openSteps(page);
  await openAnimationDetails(page);
  const duration = page.getByRole("spinbutton", { name: "过渡时长（秒）" });
  await duration.fill("4.5");
  await duration.press("Tab");
  await expect(duration).toHaveValue("4.5");
  await duration.fill("99");
  await duration.press("Tab");
  await expect(duration).toHaveValue("4.5");
  await duration.fill("");
  await duration.press("Tab");
  await expect(duration).toHaveValue("4.5");
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  await expect(duration).toBeDisabled();
  await expect(page.locator(".edit-hint")).toHaveText("播放中，请先暂停并选择步骤后编辑");
  await page.getByRole("button", { name: "暂停动画", exact: true }).click();
  await page.locator(".timeline-step").first().click();
  await expect(page.locator(".edit-hint")).toContainText("初始站位没有过渡时长");
});

test("desktop animation details disclose explicitly while collapsed pitch stays usable without changing data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1180, height: 757 });
  await page.goto("/board");
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  const edit = page.getByRole("button", { name: "编辑步骤", exact: true });
  await expect(edit).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("textbox", { name: "步骤名称" })).toBeHidden();
  await expect(page.getByRole("button", { name: "保存动画", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "删除当前步骤", exact: true })).toBeInViewport();
  expect((await page.locator("#field").boundingBox())!.height).toBeGreaterThanOrEqual(320);
  const before = await page.evaluate(async () =>
    (await import("../../../../../../src/stores/animationStore.ts")).useAnimationStore().getSnapshot()
  );
  await page.screenshot({ path: "test-results/board-1180-details-collapsed.png" });
  await edit.click();
  await expect(page.getByRole("button", { name: "收起详情", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("textbox", { name: "步骤名称" })).toBeVisible();
  await page.screenshot({ path: "test-results/board-1180-details-expanded.png" });
  await page.getByRole("button", { name: "收起详情", exact: true }).click();
  expect(
    await page.evaluate(async () =>
      (await import("../../../../../../src/stores/animationStore.ts")).useAnimationStore().getSnapshot()
    )
  ).toEqual(before);
  await expect(page.locator(".timeline-transport")).toBeInViewport({ ratio: 1 });
});
