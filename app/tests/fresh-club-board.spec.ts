/* eslint-disable no-await-in-loop, no-restricted-syntax -- Stateful setup and UI steps are deliberately sequential. */
import { test, expect } from "./fixtures";

test("fresh four-person club never adopts legacy local roster or demonstration branding", async ({ page, request }) => {
  const oldPlayers = await (await request.get("/api/players")).json();
  for (const player of oldPlayers)
    expect(
      (await request.put(`/api/players/${player.id}`, { data: { revision: player.revision, status: "inactive" } })).ok()
    ).toBe(true);
  const team = await (await request.get("/api/team")).json();
  expect(
    (
      await request.put("/api/team", { data: { revision: team.revision, name: "四人星河队（虚构）", crest: null } })
    ).ok()
  ).toBe(true);
  const names = ["星河甲", "星河乙", "星河丙", "星河丁"];
  for (const name of names) expect((await request.post("/api/players", { data: { name } })).ok()).toBe(true);
  // The signed-out screen and both club surfaces share the neutral default, not the old sample crest.
  expect((await request.post("/api/auth/logout", { data: {} })).ok()).toBe(true);
  await page.goto("/login");
  const loginBadge = page.getByAltText("球队徽章");
  await expect(loginBadge).toHaveAttribute("src", /default-club-badge/);
  const defaultSrc = (await loginBadge.getAttribute("src"))!;
  await page.getByLabel("用户名").fill("testadmin");
  await page.getByLabel("密码", { exact: true }).fill("test-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByAltText("球队队徽", { exact: true })).toHaveAttribute("src", defaultSrc);
  await page.getByRole("link", { name: "账号", exact: true }).click();
  await expect(page.getByAltText("球队队徽预览")).toHaveAttribute("src", defaultSrc);
  await page.addInitScript(() => {
    localStorage.setItem(
      "roster",
      JSON.stringify({
        players: [
          {
            id: "bg-local-foreign",
            name: "旧缓存示例不得上传",
            number: 20,
            positions: ["中场"],
            foot: "右脚",
            status: "ok",
            note: "",
            fieldId: null,
          },
        ],
      })
    );
  });
  await page.goto("/board");
  await expect(page.locator(".roster-item")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "四人星河队（虚构）", exact: true })).toBeVisible();
  for (const name of names) await expect(page.locator(".roster-item").filter({ hasText: name })).toBeVisible();
  await expect(page.getByText("旧缓存示例不得上传")).toHaveCount(0);
  await expect(page.getByText(/柏林花园/)).toHaveCount(0);
  await expect(page.locator(".roster-number").first()).toHaveText("—");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出JSON", exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/^四人星河队（虚构）_战术_/);
  await page.getByRole("link", { name: "← 俱乐部" }).click();
  await expect(page).toHaveURL(/\/club$/);
  const after = await (await request.get("/api/players")).json();
  const active = after.filter((p: { status: string }) => p.status === "active");
  expect(active.map((p: { name: string }) => p.name).sort()).toEqual([...names].sort());
  expect(active.every((p: { number: number | null }) => p.number === null)).toBe(true);
  expect(after).toHaveLength(oldPlayers.length + 4);
  expect((await (await request.get("/api/coaching-desk")).json()).desk.players).toHaveLength(4);
  await page.goto("/board");
  await expect(page.locator(".roster-item")).toHaveCount(4);
});
