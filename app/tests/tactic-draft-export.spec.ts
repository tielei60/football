import { readFile } from "node:fs/promises";
import { test, expect } from "./tactical-fixtures";

test("JSON export uses unsaved metadata and cleared tags without saving, and imports the same draft", async ({
  page,
  request,
}) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const form = page.locator(".save-box");
  await form.getByLabel("战术名称", { exact: true }).fill("导出测试 A");
  await form.getByLabel("对手", { exact: true }).fill("原对手 A");
  await form.getByLabel("日期", { exact: true }).fill("2026-11-14");
  await form.getByLabel("比分", { exact: true }).fill("3 : 1");
  await form.locator(".tag-btn").first().click();
  await form.getByRole("button", { name: "保存当前战术", exact: true }).click();
  await expect(page.getByText("战术已保存", { exact: true })).toBeVisible();
  const before = await (await request.get("/api/tactics")).json();
  expect(before).toHaveLength(1);
  expect(before[0].tags).toHaveLength(1);

  await form.getByLabel("战术名称", { exact: true }).fill("导出测试 B");
  await form.getByLabel("对手", { exact: true }).fill("草稿对手 B");
  await form.getByLabel("日期", { exact: true }).fill("");
  await form.getByLabel("比分", { exact: true }).fill("");
  await form.locator('.tag-btn[aria-pressed="true"]').click();
  const writes: string[] = [];
  const onRequest = (r: import("@playwright/test").Request) => {
    if (new URL(r.url()).pathname.startsWith("/api/tactics") && !["GET", "HEAD"].includes(r.method()))
      writes.push(r.method());
  };
  page.on("request", onRequest);
  const downloadPromise = page.waitForEvent("download");
  await form.getByRole("button", { name: "导出JSON", exact: true }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const buffer = await readFile(path!);
  const payload = JSON.parse(buffer.toString());
  expect(payload.title).toBe("导出测试 B");
  expect(payload.tags).toEqual([]);
  expect(payload.match).toEqual({ opponent: "草稿对手 B", date: "", score: "" });
  expect(payload.board).toBeTruthy();
  expect(await (await request.get("/api/tactics")).json()).toEqual(before);
  expect(writes).toEqual([]);
  page.off("request", onRequest);

  const imported = page.waitForResponse((r) => r.url().endsWith("/api/tactics") && r.request().method() === "POST");
  await form.locator('input[type="file"]').first().setInputFiles({
    name: "draft.json",
    mimeType: "application/json",
    buffer,
  });
  expect((await imported).ok()).toBeTruthy();
  // Import must populate the form immediately, without manually reopening the card.
  await expect(form.getByLabel("战术名称", { exact: true })).toHaveValue("导出测试 B");
  await expect(form.getByLabel("对手", { exact: true })).toHaveValue("草稿对手 B");
  await expect(form.getByLabel("日期", { exact: true })).toHaveValue("");
  await expect(form.getByLabel("比分", { exact: true })).toHaveValue("");
  await expect(form.locator('.tag-btn[aria-pressed="true"]')).toHaveCount(0);
  const roundTripPromise = page.waitForEvent("download");
  await form.getByRole("button", { name: "导出JSON", exact: true }).click();
  const roundTrip = JSON.parse(await readFile((await (await roundTripPromise).path())!, "utf8"));
  expect(roundTrip.title).toEqual(payload.title);
  expect(roundTrip.tags).toEqual(payload.tags);
  expect(roundTrip.match).toEqual(payload.match);
  expect(roundTrip.board).toEqual(payload.board);

  const complete = {
    ...payload,
    title: "完整元信息导入 C",
    tags: before[0].tags,
    match: { opponent: "虚构完整对手 C", date: "2026-12-20", score: "2 : 2" },
  };
  await form
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "complete.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(complete)),
    });
  await expect(form.getByLabel("战术名称", { exact: true })).toHaveValue(complete.title);
  await expect(form.getByLabel("对手", { exact: true })).toHaveValue(complete.match.opponent);
  await expect(form.getByLabel("日期", { exact: true })).toHaveValue(complete.match.date);
  await expect(form.getByLabel("比分", { exact: true })).toHaveValue(complete.match.score);
  await expect(form.getByRole("button", { name: complete.tags[0], exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  const saved = page.waitForResponse((r) => r.url().includes("/api/tactics") && r.request().method() === "PUT");
  await form.getByRole("button", { name: "保存当前战术", exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  const records = await (await request.get("/api/tactics")).json();
  const persisted = records.find((record: { title: string }) => record.title === complete.title);
  expect(persisted).toBeTruthy();
  expect(persisted.tags).toEqual(complete.tags);
  expect(persisted.match).toEqual(complete.match);
});
