import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { openManualMatchDate, setMatchSchedule } from "./match-schedule";
import { selectUiOption, expectUiValue } from "./ui-select";
import { fixturePng } from "./fixture-png";

const evidence = "test-results/visual-review";
async function loginAs(page: Page, username: string, password: string) {
  await page.goto("/club/account");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "球队比赛", exact: true })).toBeVisible();
}

test("composed schedule keeps unknowns and drafts, selects weekdays and crosses midnight", async ({
  page,
  request,
}) => {
  await page.goto("/club");
  await page.getByRole("button", { name: "新建比赛", exact: true }).click();
  await page.getByLabel("对手", { exact: true }).fill("跨年虚构对手");
  const format = await page.getByRole("combobox", { name: "比赛人数制", exact: true }).boundingBox();
  const side = await page.getByRole("combobox", { name: "主客场", exact: true }).boundingBox();
  expect(format).not.toBeNull();
  expect(side).not.toBeNull();
  expect(Math.abs(format!.y - side!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(format!.height - side!.height)).toBeLessThanOrEqual(1);
  for (const label of ["赛事名称", "对手"]) {
    const input = await page.getByRole("textbox", { name: label, exact: true }).boundingBox();
    expect(input).not.toBeNull();
    expect(Math.abs(input!.y - format!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(input!.height - format!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(input!.y - side!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(input!.height - side!.height)).toBeLessThanOrEqual(1);
  }
  await setMatchSchedule(page, "2091-12-31", "23:30");
  await expectUiValue(page.getByRole("combobox", { name: "比赛时长", exact: true }), "90");
  await expect(page.getByText(/预计结束：2092-01-01 周. 01:00 · 按球场当地时间/)).toBeVisible();
  const trigger = page.getByRole("button", { name: /^开始日期时间/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "设置开始日期时间", exact: true });
  await openManualMatchDate(dialog);
  await dialog.getByLabel("日期（YYYY-MM-DD）", { exact: true }).fill("2092-02-30");
  await dialog.getByRole("button", { name: "确定时间", exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.press("Escape");
  await expect(trigger).toContainText("2091-12-31");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await expect(page.getByRole("heading", { name: "比赛信息与分析", exact: true })).toBeVisible();
  const id = Number(page.url().split("/").pop());
  const saved = await (await request.get(`/api/matches/${id}`)).json();
  expect([saved.date, saved.kickoff, saved.durationMinutes]).toEqual(["2091-12-31", "23:30", 90]);
  await selectUiOption(page.getByRole("combobox", { name: "比赛时长", exact: true }), "custom");
  await page.getByLabel("时长（分钟）", { exact: true }).fill("75");
  await page.getByRole("button", { name: "撤销信息修改", exact: true }).click();
  await page
    .getByRole("dialog", { name: "撤销信息修改", exact: true })
    .getByRole("button", { name: "撤销修改", exact: true })
    .click();
  await expectUiValue(page.getByRole("combobox", { name: "比赛时长", exact: true }), "90");
  await expect(page.getByLabel("时长（分钟）", { exact: true })).toHaveCount(0);
  await selectUiOption(page.getByRole("combobox", { name: "比赛时长", exact: true }), "custom");
  await page.getByLabel("时长（分钟）", { exact: true }).fill("75");
  await page.getByRole("button", { name: "保存比赛信息", exact: true }).click();
  await expect(page.getByText(/预计结束：2092-01-01 周. 00:45 · 按球场当地时间/)).toBeVisible();
  await mkdir(evidence, { recursive: true });
  await trigger.click();
  await page.screenshot({ path: `${evidence}/matchday-schedule.png`, fullPage: false });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const old = await (
    await request.post("/api/matches", { data: { opponent: "历史时间未知", date: "2092-02-29" } })
  ).json();
  await page.goto(`/club/matches/${old.id}`);
  await expect(trigger).toContainText("时间待定");
  await expectUiValue(page.getByRole("combobox", { name: "比赛时长", exact: true }), "unknown");
  await selectUiOption(page.getByRole("combobox", { name: "比赛时长", exact: true }), "custom");
  await expect(page.getByLabel("时长（分钟）", { exact: true })).toHaveValue("");
  await page.getByLabel("时长（分钟）", { exact: true }).fill("75");
  await page.getByRole("button", { name: "撤销信息修改", exact: true }).click();
  await page
    .getByRole("dialog", { name: "撤销信息修改", exact: true })
    .getByRole("button", { name: "撤销修改", exact: true })
    .click();
  await expectUiValue(page.getByRole("combobox", { name: "比赛时长", exact: true }), "unknown");
  // Selecting custom without a value keeps the model null: reset must also clear
  // the picker-local mode, not only react to a changed duration prop.
  await selectUiOption(page.getByRole("combobox", { name: "比赛时长", exact: true }), "custom");
  await expect(page.getByLabel("时长（分钟）", { exact: true })).toHaveValue("");
  await page.getByLabel("对手", { exact: true }).fill("应撤销的对手修改");
  await page.getByRole("button", { name: "撤销信息修改", exact: true }).click();
  await page
    .getByRole("dialog", { name: "撤销信息修改", exact: true })
    .getByRole("button", { name: "撤销修改", exact: true })
    .click();
  await expect(page.getByLabel("对手", { exact: true })).toHaveValue("历史时间未知");
  await expectUiValue(page.getByRole("combobox", { name: "比赛时长", exact: true }), "unknown");
  await expect(page.getByLabel("时长（分钟）", { exact: true })).toHaveCount(0);
  await page.getByLabel("赛前计划 / 赛后分析").fill("只改计划");
  await page.getByRole("button", { name: "保存比赛信息", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "比赛信息已保存" })).toHaveText("比赛信息已保存");
  const unchanged = await (await request.get(`/api/matches/${old.id}`)).json();
  expect([unchanged.kickoff, unchanged.durationMinutes]).toEqual(["", null]);
  expect([unchanged.opponent, unchanged.analysis]).toEqual(["历史时间未知", "只改计划"]);
});

test("venues support opt-in map click, coordinate fallback and immutable archived match venue", async ({
  page,
  request,
}) => {
  let tileRequests = 0;
  await page.route("https://tile.openstreetmap.org/**", async (route) => {
    tileRequests += 1;
    await route.fulfill({ status: 200, contentType: "image/png", body: fixturePng() });
  });
  await page.goto("/club/venues");
  await page.getByRole("button", { name: "新增球场", exact: true }).click();
  await page.getByLabel("球场名称", { exact: true }).fill("河岸球场（虚构）");
  await page.getByLabel("球场地址", { exact: true }).fill("虚构公共路 12 号");
  expect(tileRequests).toBe(0);
  await page.getByRole("button", { name: "打开地图选点", exact: true }).click();
  await expect.poll(() => tileRequests).toBeGreaterThan(0);
  const map = page.locator(".venue-map");
  await expect(map.locator(".leaflet-tile").first()).toBeVisible();
  await map.click({ position: { x: 150, y: 100 } });
  await expect(page.getByLabel("纬度（WGS84）", { exact: true })).not.toHaveValue("");
  await expect(page.getByLabel("经度（WGS84）", { exact: true })).not.toHaveValue("");
  await page.getByRole("button", { name: "清除坐标", exact: true }).click();
  await page.getByLabel("纬度（WGS84）", { exact: true }).fill("31.23");
  await page.getByLabel("经度（WGS84）", { exact: true }).fill("121.47");
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/matchday-map-fixture.png`, fullPage: true });
  await page.getByRole("button", { name: "保存球场", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "球场资料已保存" })).toBeVisible();
  const venue = (await (await request.get("/api/venues")).json())[0];
  expect([venue.latitude, venue.longitude]).toEqual([31.23, 121.47]);
  await page.goto("/club");
  await page.getByRole("button", { name: "新建比赛", exact: true }).click();
  await page.getByLabel("对手", { exact: true }).fill("场地历史虚构对手");
  await selectUiOption(page.getByRole("combobox", { name: "球场", exact: true }), venue.id);
  await setMatchSchedule(page, "2092-01-03", "15:00");
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await expect(page.getByRole("heading", { name: "比赛信息与分析", exact: true })).toBeVisible();
  const id = Number(page.url().split("/").pop());
  await page.goto("/club/venues");
  await page.getByRole("button", { name: "编辑球场", exact: true }).click();
  await page.getByLabel("球场名称", { exact: true }).fill("后来改名的球场");
  await page.getByRole("button", { name: "保存球场", exact: true }).click();
  await expect(page.getByRole("heading", { name: "后来改名的球场", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "归档球场", exact: true }).click();
  await page
    .getByRole("dialog", { name: "归档球场", exact: true })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await selectUiOption(page.getByRole("combobox", { name: "球场筛选", exact: true }), "archived");
  await expect(page.getByRole("button", { name: "恢复使用", exact: true })).toBeVisible();
  await page.goto(`/club/matches/${id}`);
  await expect(page.getByRole("combobox", { name: "球场", exact: true })).toContainText("河岸球场（虚构）");
  await page.getByLabel("赛前计划 / 赛后分析").fill("保留原场地，仅更新计划");
  await page.getByRole("button", { name: "保存比赛信息", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "比赛信息已保存" })).toBeVisible();
  const match = await (await request.get(`/api/matches/${id}`)).json();
  expect(match.venueSnapshot.name).toBe("河岸球场（虚构）");
  expect([match.venueSnapshot.latitude, match.venueSnapshot.longitude]).toEqual([31.23, 121.47]);
});

test("match album saves separately from information drafts and player choices update counts without legal consent", async ({
  page,
  request,
}) => {
  const player = await (await request.post("/api/players", { data: { name: "报名虚构成年球员" } })).json();
  expect(
    (
      await request.post(`/api/players/${player.id}/account`, {
        data: { username: "matchday-rsvp", password: "fictional-matchday-password" },
      })
    ).ok()
  ).toBe(true);
  const match = await (
    await request.post("/api/matches", {
      data: {
        opponent: "相册虚构对手",
        date: "2092-02-07",
        status: "published",
        notice: "请带饮水。<script>not executable</script>",
      },
    })
  ).json();
  await page.goto(`/club/matches/${match.id}`);
  const info = page.getByLabel("对手", { exact: true });
  await info.fill("未保存的对手草稿");
  const gallery = page.getByRole("region", { name: "比赛照片", exact: true });
  await gallery.getByLabel("添加比赛照片", { exact: true }).setInputFiles([
    { name: "before.png", mimeType: "image/png", buffer: fixturePng() },
    { name: "after.png", mimeType: "image/png", buffer: fixturePng(162, 217, 247) },
  ]);
  await expect(gallery.getByRole("button", { name: "查看第 2 张比赛照片", exact: true })).toBeVisible();
  await gallery.getByLabel("照片说明 1", { exact: true }).fill("赛前虚构色块");
  await gallery.getByLabel("照片说明 2", { exact: true }).fill("赛后虚构色块");
  await gallery.locator(".photo-card").nth(1).getByRole("button", { name: "设为封面", exact: true }).click();
  await gallery.getByRole("button", { name: "前移第 2 张照片", exact: true }).click();
  await gallery.getByRole("button", { name: "保存比赛照片", exact: true }).click();
  await expect(gallery.getByRole("status")).toHaveText("比赛照片已保存");
  await expect(info).toHaveValue("未保存的对手草稿");
  let saved = await (await request.get(`/api/matches/${match.id}`)).json();
  expect(saved.opponent).toBe("相册虚构对手");
  expect(saved.photos.map((p: { caption: string }) => p.caption)).toEqual(["赛后虚构色块", "赛前虚构色块"]);
  expect(saved.coverPhotoId).toBe(saved.photos[0].id);
  await page.getByRole("button", { name: "保存比赛信息", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "比赛信息已保存" })).toBeVisible();
  saved = await (await request.get(`/api/matches/${match.id}`)).json();
  expect(saved.opponent).toBe("未保存的对手草稿");
  expect(saved.photoCount).toBe(2);
  await gallery
    .getByLabel("添加比赛照片", { exact: true })
    .setInputFiles({ name: "fake.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(gallery.getByRole("alert")).toContainText("PNG");
  await expect(gallery.getByRole("button", { name: "查看第 2 张比赛照片", exact: true })).toBeVisible();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/matchday-album.png`, fullPage: true });
  await loginAs(page, "matchday-rsvp", "fictional-matchday-password");
  const counts = page.getByRole("region", { name: "我的报名统计", exact: true });
  await expect(counts).toContainText("1 场未报名");
  for (const [button, countLabel] of [
    ["参加", "1 场报名参加"],
    ["参加", "1 场报名参加"],
    ["请假 / 不参加", "1 场请假 / 不参加"],
    ["待定", "1 场待定"],
    ["撤回选择，恢复未报名", "1 场未报名"],
  ]) {
    await page.goto(`/club/matches/${match.id}`);
    await expect(page.locator("#match-notice")).toContainText("<script>not executable</script>");
    await expect(page.locator("#match-notice script")).toHaveCount(0);
    await expect(gallery.getByLabel("添加比赛照片", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /同意|免责|责任条款/ })).toHaveCount(0);
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "报名意愿已更新" })).toBeVisible();
    await page.getByRole("link", { name: "查看我的报名次数与记录 →", exact: true }).click();
    await expect(counts).toContainText(countLabel);
  }
  await selectUiOption(page.getByRole("combobox", { name: "我的报名", exact: true }), "unanswered");
  await expect(page.locator(".club-match-card")).toHaveCount(1);
  await selectUiOption(page.getByRole("combobox", { name: "我的报名", exact: true }), "yes");
  await expect(page.locator(".club-match-card")).toHaveCount(0);
});

test("avatar shortcut and true multi-position choices retain explicit save, filter and removal", async ({
  page,
  request,
}) => {
  const player = await (
    await request.post("/api/players", { data: { name: "头像虚构成年球员", positions: ["待定"] } })
  ).json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/club/players");
  const searchInput = page.getByRole("textbox", { name: "查找球员", exact: true });
  const avatarFilter = page.getByRole("combobox", { name: "头像筛选", exact: true });
  await expect(searchInput).toBeVisible();
  await expect(avatarFilter).toBeVisible();
  const searchBox = await searchInput.boundingBox();
  const avatarBox = await avatarFilter.boundingBox();
  expect(searchBox).not.toBeNull();
  expect(avatarBox).not.toBeNull();
  expect(Math.abs(searchBox!.y - avatarBox!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(searchBox!.height - avatarBox!.height)).toBeLessThanOrEqual(1);
  expect(
    await page.locator(".player-filters").evaluate((element) => element.scrollWidth - element.clientWidth)
  ).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  ).toBeLessThanOrEqual(1);
  let row = page.getByRole("row").filter({ hasText: player.name });
  await row.getByRole("button", { name: "管理头像", exact: true }).click();
  await page.getByRole("checkbox", { name: "中场", exact: true }).check();
  await page.getByRole("checkbox", { name: "后腰", exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "待定", exact: true })).not.toBeChecked();
  await page
    .getByLabel("上传球员头像", { exact: true })
    .setInputFiles({ name: "fictional-avatar.png", mimeType: "image/png", buffer: fixturePng() });
  await expect(page.getByAltText("球员头像预览", { exact: true })).toBeVisible();
  expect((await (await request.get(`/api/players/${player.id}`)).json()).avatar).toBeNull();
  await page.getByRole("button", { name: "保存球员", exact: true }).click();
  await expect(row.getByRole("img")).toBeVisible();
  expect((await (await request.get(`/api/players/${player.id}`)).json()).positions).toEqual(["中场", "后腰"]);
  await selectUiOption(page.getByRole("combobox", { name: "头像筛选", exact: true }), { label: "已设置头像" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "管理头像", exact: true }).click();
  await page.getByRole("button", { name: "移除头像", exact: true }).click();
  await page.getByRole("button", { name: "保存球员", exact: true }).click();
  await expect(row).toHaveCount(0);
  await selectUiOption(page.getByRole("combobox", { name: "头像筛选", exact: true }), { label: "未设置头像" });
  row = page.getByRole("row").filter({ hasText: player.name });
  await expect(row).toBeVisible();
  expect((await (await request.get(`/api/players/${player.id}`)).json()).avatar).toBeNull();
});

test("map network failure keeps manual coordinate saving usable without geolocation", async ({ page, request }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort("internetdisconnected"));
  await page.goto("/club/venues");
  await page.getByRole("button", { name: "新增球场", exact: true }).click();
  await page.getByLabel("球场名称", { exact: true }).fill("离线备用虚构球场");
  await page.getByRole("button", { name: "打开地图选点", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "地图瓦片暂时无法加载" })).toBeVisible();
  await page.getByLabel("纬度（WGS84）", { exact: true }).fill("31.23");
  await page.getByRole("button", { name: "保存球场", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("成对");
  await expect(page.getByLabel("球场名称", { exact: true })).toHaveValue("离线备用虚构球场");
  await page.getByLabel("经度（WGS84）", { exact: true }).fill("121.47");
  await page.getByRole("button", { name: "保存球场", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "球场资料已保存" })).toBeVisible();
  expect(
    (await (await request.get("/api/venues")).json()).map((v: { latitude: number; longitude: number }) => [
      v.latitude,
      v.longitude,
    ])
  ).toEqual([[31.23, 121.47]]);
});

test("album revision conflict preserves the local image draft and never overwrites a newer match", async ({
  page,
  request,
}) => {
  const match = await (
    await request.post("/api/matches", { data: { opponent: "相册并发虚构对手", date: "2092-02-07" } })
  ).json();
  await page.goto(`/club/matches/${match.id}`);
  const gallery = page.getByRole("region", { name: "比赛照片", exact: true });
  await gallery
    .getByLabel("添加比赛照片", { exact: true })
    .setInputFiles({ name: "local.png", mimeType: "image/png", buffer: fixturePng() });
  await gallery.getByLabel("照片说明 1", { exact: true }).fill("我的未保存说明");
  const changed = await request.put(`/api/matches/${match.id}`, {
    data: { revision: match.revision, analysis: "其他管理员的新分析" },
  });
  expect(changed.ok()).toBe(true);
  await gallery.getByRole("button", { name: "保存比赛照片", exact: true }).click();
  await expect(gallery.getByRole("alert")).toContainText("照片修改仍保留");
  await expect(gallery.getByLabel("照片说明 1", { exact: true })).toHaveValue("我的未保存说明");
  await expect(gallery.getByRole("button", { name: "查看第 1 张比赛照片", exact: true })).toBeVisible();
  const saved = await (await request.get(`/api/matches/${match.id}`)).json();
  expect(saved.analysis).toBe("其他管理员的新分析");
  expect(saved.photoCount).toBe(0);
});

test("collapsed new match drafts and duration-only changes retain leave and discard protection", async ({ page }) => {
  await page.goto("/club");
  await page.getByRole("button", { name: "新建比赛", exact: true }).click();
  await page.getByLabel("对手", { exact: true }).fill("尚未提交的虚构比赛");
  await page.getByRole("button", { name: "收起", exact: true }).click();
  await page.getByRole("link", { name: "球员", exact: true }).click();
  const leave = page.getByRole("dialog", { name: "离开新比赛草稿？", exact: true });
  await expect(leave).toBeVisible();
  await leave.press("Escape");
  await expect(page).toHaveURL(/\/club$/);
  await page.getByRole("button", { name: "新建比赛", exact: true }).click();
  await expect(page.getByLabel("对手", { exact: true })).toHaveValue("尚未提交的虚构比赛");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "放弃新比赛草稿？", exact: true });
  await discard.getByRole("button", { name: "继续填写", exact: true }).click();
  await expect(page.getByLabel("对手", { exact: true })).toHaveValue("尚未提交的虚构比赛");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await discard.getByRole("button", { name: "放弃填写", exact: true }).click();
  await page.getByRole("button", { name: "新建比赛", exact: true }).click();
  await expect(page.getByLabel("对手", { exact: true })).toHaveValue("");
  await expectUiValue(page.getByRole("combobox", { name: "比赛时长", exact: true }), "90");
  await selectUiOption(page.getByRole("combobox", { name: "比赛时长", exact: true }), "120");
  await page.getByRole("button", { name: "收起", exact: true }).click();
  await page.getByRole("link", { name: "球员", exact: true }).click();
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "放弃填写并离开", exact: true }).click();
  await expect(page).toHaveURL(/\/club\/players$/);
});

test("pending match creation blocks navigation and successful write navigates exactly once", async ({
  page,
  request,
}) => {
  let release!: () => void;
  let intercepted!: () => void;
  let writes = 0;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route("**/api/matches", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes += 1;
    intercepted();
    await hold;
    await route.continue();
  });
  await page.goto("/club");
  await page.getByRole("button", { name: "新建比赛", exact: true }).click();
  await page.getByLabel("对手", { exact: true }).fill("延迟创建虚构比赛");
  await setMatchSchedule(page, "2092-03-07", "15:00");
  const response = page.waitForResponse((r) => r.url().endsWith("/api/matches") && r.request().method() === "POST");
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await seen;
  try {
    await page.getByRole("link", { name: "球员", exact: true }).click();
    await expect(page).toHaveURL(/\/club$/);
    await expect(page.getByRole("button", { name: "正在创建…", exact: true })).toBeDisabled();
  } finally {
    release();
  }
  const created = await response;
  expect(created.status()).toBe(201);
  const match = await created.json();
  await expect(page).toHaveURL(new RegExp(`/club/matches/${match.id}$`));
  expect(writes).toBe(1);
  expect(await (await request.get("/api/matches")).json()).toHaveLength(1);
});
