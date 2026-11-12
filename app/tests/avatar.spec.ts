/* eslint-disable no-restricted-syntax, no-await-in-loop -- Browser steps share one isolated fixture. */
import { mkdir } from "node:fs/promises";
import { test, expect } from "./fixtures";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64"
);
const image = { name: "portrait.png", mimeType: "image/png", buffer: png };
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

test("admin uploads saves and removes a portrait; player sees their own readonly avatar", async ({ page, request }) => {
  const response = await request.post("/api/players", { data: { name: "头像球员", positions: ["中场"] } });
  expect(response.ok()).toBe(true);
  const player = await response.json();
  expect(
    (
      await request.post(`/api/players/${player.id}/account`, {
        data: { username: "avatarplayer", password: "avatar-password-123" },
      })
    ).ok()
  ).toBe(true);
  await page.goto("/club/players");
  await page
    .getByRole("row")
    .filter({ hasText: "头像球员" })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.getByLabel("上传球员头像").setInputFiles(image);
  await expect(page.getByAltText("球员头像预览")).toHaveAttribute("src", dataUrl);
  expect((await (await request.get(`/api/players/${player.id}`)).json()).avatar).toBeNull();
  await mkdir("test-results/visual-review", { recursive: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.screenshot({ path: `test-results/visual-review/admin-player-avatar-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "保存球员", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("球员资料已保存");
  expect((await (await request.get(`/api/players/${player.id}`)).json()).avatar).toBe(dataUrl);
  await expect(page.getByAltText("头像球员头像")).toHaveAttribute("src", dataUrl);
  await request.post("/api/auth/logout");
  expect(
    (
      await request.post("/api/auth/login", { data: { username: "avatarplayer", password: "avatar-password-123" } })
    ).ok()
  ).toBe(true);
  await page.reload();
  await expect(page.getByText("头像球员（我）", { exact: true })).toBeVisible();
  await expect(page.getByAltText("头像球员头像")).toHaveAttribute("src", dataUrl);
  await expect(page.getByLabel("上传球员头像")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    await page.screenshot({ path: `test-results/visual-review/player-own-avatar-${width}.png`, fullPage: true });
  }
  await request.post("/api/auth/logout");
  expect(
    (await request.post("/api/auth/login", { data: { username: "testadmin", password: "test-password-123" } })).ok()
  ).toBe(true);
  await page.reload();
  await page
    .getByRole("row")
    .filter({ hasText: "头像球员" })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.getByRole("button", { name: "移除头像", exact: true }).click();
  await expect(page.getByAltText("球员头像预览")).toHaveCount(0);
  await page.getByRole("button", { name: "保存球员", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("球员资料已保存");
  expect((await (await request.get(`/api/players/${player.id}`)).json()).avatar).toBeNull();
});

test("invalid avatar files preserve the image and failed writes retain the removal draft", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/players", { data: { name: "原头像", avatar: dataUrl } });
  expect(response.ok()).toBe(true);
  const player = await response.json();
  await page.goto("/club/players");
  await page.getByRole("row").filter({ hasText: "原头像" }).getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByLabel("上传球员头像")
    .setInputFiles({ name: "fake.png", mimeType: "image/png", buffer: Buffer.from("not PNG") });
  await expect(page.getByRole("alert")).toContainText("图片内容与格式不符");
  await expect(page.getByAltText("球员头像预览")).toHaveAttribute("src", dataUrl);
  await page
    .getByLabel("上传球员头像")
    .setInputFiles({ name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toContainText("不能超过 2 MiB");
  await page
    .getByLabel("上传球员头像")
    .setInputFiles({ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(page.getByRole("alert")).toContainText("请选择 PNG");
  await expect(page.getByAltText("球员头像预览")).toHaveAttribute("src", dataUrl);
  await page.route(`**/api/players/${player.id}`, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { message: "保存暂时失败" } })
      : route.continue()
  );
  await page.getByRole("button", { name: "移除头像", exact: true }).click();
  await page.getByRole("button", { name: "保存球员", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("保存暂时失败");
  await expect(page.getByAltText("球员头像预览")).toHaveCount(0);
  expect((await (await request.get(`/api/players/${player.id}`)).json()).avatar).toBe(dataUrl);
  await page.unroute(`**/api/players/${player.id}`);
  await page.getByRole("button", { name: "保存球员", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("球员资料已保存");
  expect((await (await request.get(`/api/players/${player.id}`)).json()).avatar).toBeNull();
});

test("late avatar reads cannot mutate a different player draft or survive cancel", async ({ page, request }) => {
  for (const name of ["甲头像", "乙头像"])
    expect((await request.post("/api/players", { data: { name } })).ok()).toBe(true);
  await page.goto("/club/players");
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL;
    const pending: (() => Promise<void>)[] = [];
    FileReader.prototype.readAsDataURL = function delayedRead(blob) {
      const reader = this;
      pending.push(
        () =>
          new Promise<void>((resolve) => {
            reader.addEventListener("loadend", () => resolve(), { once: true });
            original.call(reader, blob);
          })
      );
    };
    (window as typeof window & { flushAvatarReads: () => Promise<void[]> }).flushAvatarReads = () =>
      Promise.all(pending.splice(0).map((read) => read()));
  });
  await page.getByRole("row").filter({ hasText: "甲头像" }).getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("上传球员头像").setInputFiles(image);
  await expect(page.getByRole("button", { name: "保存球员", exact: true })).toBeDisabled();
  await page.getByRole("row").filter({ hasText: "乙头像" }).getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("姓名", { exact: true })).toHaveValue("乙头像");
  await page.evaluate(() => (window as typeof window & { flushAvatarReads: () => Promise<void[]> }).flushAvatarReads());
  await expect(page.getByAltText("球员头像预览")).toHaveCount(0);
  await page.getByLabel("上传球员头像").setInputFiles(image);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => (window as typeof window & { flushAvatarReads: () => Promise<void[]> }).flushAvatarReads());
  await page.getByRole("row").filter({ hasText: "甲头像" }).getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByAltText("球员头像预览")).toHaveCount(0);
});
