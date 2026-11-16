import { selectUiOption, expectUiValue } from "./ui-select";
import { test, expect } from "./fixtures";

test("sharing a match copies saved details and returns a logged-out player to the match", async ({ page, request }) => {
  const suffix = Date.now().toString();
  const player = await (await request.post("/api/players", { data: { name: `分享球员${suffix}` } })).json();
  expect(
    (
      await request.post(`/api/players/${player.id}/account`, {
        data: { username: `share${suffix}`, password: "player-password-123" },
      })
    ).ok()
  ).toBeTruthy();
  const match = await (
    await request.post("/api/matches", {
      data: { opponent: "分享对手", date: "2027-02-03", status: "published", location: "足球场" },
    })
  ).json();
  await page.goto(`/club/matches/${match.id}`);
  await page.getByRole("button", { name: "分享比赛" }).click();
  await expect(page.getByLabel("分享比赛")).toContainText("分享对手");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (text: string) => {
          (window as Window & { copied?: string }).copied = text;
          return Promise.resolve();
        },
      },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "复制邀请内容" }).click();
  await expect(page.getByRole("status").filter({ hasText: "邀请内容已复制" })).toBeVisible();
  const copied = await page.evaluate(() => (window as Window & { copied?: string }).copied);
  expect(copied).toContain("分享对手");
  expect(copied).toContain("足球场");
  expect(copied).toContain(`/club/matches/${match.id}`);
  await request.post("/api/auth/logout", { data: {} });
  await page.goto(`/club/matches/${match.id}`);
  await page.getByLabel("用户名").fill(`share${suffix}`);
  await page.getByLabel("密码", { exact: true }).fill("player-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/club/matches/${match.id}$`));
  await page.getByRole("button", { name: "参加", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "报名意愿已更新" })).toBeVisible();
});

test("club admin records unknown statistics separately from zero and creates cross-year seasons", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString();
  const playerResponse = await request.post("/api/players", { data: { name: `新球员${suffix}`, positions: ["中场"] } });
  expect(playerResponse.ok()).toBeTruthy();
  const player = await playerResponse.json();
  await page.goto("/club");
  await expect(page.getByRole("heading", { name: "球队比赛" })).toBeVisible();
  await page.getByRole("button", { name: "新建比赛" }).click();
  await page.getByLabel("对手", { exact: true }).fill(`对手${suffix}`);
  await page.getByLabel("比赛日期").fill("2027-01-15");
  await page.getByRole("button", { name: "创建草稿" }).click();
  await expect(page.getByRole("heading", { name: /比赛信息与分析/ })).toBeVisible();
  const matchId = Number(page.url().split("/").pop());
  await selectUiOption(page.getByLabel("发布状态"), "completed");
  await page.getByLabel("本队比分").fill("0");
  await page.getByLabel("对手比分").fill("1");
  await page.getByRole("button", { name: "保存比赛信息" }).click();
  await expect(page.getByRole("status").filter({ hasText: "比赛信息已保存" })).toHaveText("比赛信息已保存");
  await selectUiOption(page.getByLabel("添加至名单"), player.id);
  await page.getByRole("button", { name: "添加球员", exact: true }).click();
  await selectUiOption(page.getByLabel(`${player.name}实际出场`), { label: "已出场" });
  await page.getByLabel(`${player.name}进球`).fill("0");
  await page.getByRole("button", { name: "保存名单与出场数据" }).click();
  await expect(page.getByRole("status").filter({ hasText: "名单与实际出场已保存" })).toHaveText("名单与实际出场已保存");
  await page.reload();
  await expect(page.getByLabel(`${player.name}进球`)).toHaveValue("0");
  await expect(page.getByLabel(`${player.name}助攻`)).toHaveValue("");
  await page.getByRole("link", { name: "统计与赛季" }).click();
  await page.getByRole("button", { name: "新建赛季" }).click();
  await page.getByLabel("赛季名称").fill(`跨年赛季${suffix}`);
  await page.getByLabel("开始日期").fill("2026-08-01");
  await page.getByLabel("结束日期").fill("2027-07-31");
  await page.getByRole("button", { name: "保存赛季" }).click();
  await expect(page.getByRole("heading", { name: "新建赛季", exact: true })).not.toBeVisible();
  const savedSeason = (await (await request.get("/api/seasons")).json()).find(
    (s: { name: string }) => s.name === `跨年赛季${suffix}`
  );
  const currentMatch = await (await request.get(`/api/matches/${matchId}`)).json();
  expect(
    (
      await request.put(`/api/matches/${matchId}`, {
        data: { revision: currentMatch.revision, seasonId: savedSeason.id },
      })
    ).ok()
  ).toBe(true);
  await selectUiOption(page.getByLabel("统计周期"), "season");
  await selectUiOption(page.getByLabel("赛季", { exact: true }), {
    label: `跨年赛季${suffix}（2026-08-01 至 2027-07-31）`,
  });
  const row = page.getByRole("row").filter({ hasText: player.name });
  await expect(row).toContainText("未知");
  await expect(row).toContainText("1 / 1 场");
  await expect(row).toContainText("0 / 1 场");
});

test("player logs in, registers independently of appearance, and cannot access board", async ({ page, request }) => {
  const suffix = Date.now().toString();
  const player = await (await request.post("/api/players", { data: { name: `报名球员${suffix}` } })).json();
  const account = await request.post(`/api/players/${player.id}/account`, {
    data: { username: `player${suffix}`, password: "player-password-123" },
  });
  expect(account.ok()).toBeTruthy();
  const match = await (
    await request.post("/api/matches", {
      data: { opponent: `报名测试${suffix}`, date: "2027-02-03", status: "published" },
    })
  ).json();
  await request.post("/api/auth/logout", { data: {} });
  await page.goto("/login");
  await page.getByLabel("用户名").fill(`player${suffix}`);
  await page.getByLabel("密码", { exact: true }).fill("player-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "球队比赛" })).toBeVisible();
  await page.goto(`/club/matches/${match.id}`);
  await page.getByRole("button", { name: "参加", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "报名意愿已更新" })).toHaveText("报名意愿已更新");
  await expect(page.getByText("尚未录入比赛名单")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存比赛信息" })).toHaveCount(0);
  await page.goto("/board");
  await expect(page).toHaveURL(/\/club$/);
});

test("leaving a loading board settles and suspends it before club profile edits", async ({ page, request }) => {
  expect((await request.post("/api/players", { data: { name: "加载竞态虚构球员" } })).ok()).toBe(true);
  await page.goto("/board");
  await expect(page.locator(".roster-item").first()).toBeVisible();
  await page.getByRole("link", { name: "← 俱乐部" }).click();
  await expect(page).toHaveURL(/\/club$/);
  const players = await (await request.get("/api/players")).json();
  const player = players.find((entry: { status: string }) => entry.status === "active");
  expect(player).toBeTruthy();
  let release!: () => void;
  let seen!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route("**/api/coaching-desk", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    seen();
    await held;
    return route.fulfill({ response });
  });
  await page.goto("/board");
  await intercepted;
  await expect(page.getByText("正在载入战术与球队名单")).toBeVisible();
  await page.getByRole("link", { name: "← 俱乐部" }).click();
  release();
  await expect(page).toHaveURL(/\/club$/);
  await page.unroute("**/api/coaching-desk");
  const newName = `延迟载入回归${Date.now()}`;
  const edited = await request.put(`/api/players/${player.id}`, { data: { name: newName, revision: player.revision } });
  expect(edited.ok()).toBeTruthy();
  try {
    await page.getByRole("link", { name: "战术板 ↗" }).click();
    await expect(page.locator(".roster-item").filter({ hasText: newName })).toBeVisible();
  } finally {
    await page.getByRole("link", { name: "← 俱乐部" }).click();
    await expect(page).toHaveURL(/\/club$/);
    const current = await (await request.get(`/api/players/${player.id}`)).json();
    await request.put(`/api/players/${player.id}`, { data: { name: player.name, revision: current.revision } });
  }
});

test("statistics disclose completed matches with no roster and missing individual details", async ({
  page,
  request,
}) => {
  const suffix = Date.now().toString();
  const player = await (await request.post("/api/players", { data: { name: `缺失明细${suffix}` } })).json();
  const response = await request.post("/api/matches", {
    data: { opponent: `无名单${suffix}`, date: "2091-01-15", status: "completed" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/club/statistics");
  await page.getByLabel("年份").fill("2091");
  await page.getByLabel("年份").blur();
  await expect(page.getByText(/有 \d+ 场已完赛比赛尚未录入名单/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "未录入个人明细" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: player.name });
  await expect(row.getByRole("cell").nth(1)).toHaveText("0");
  await expect(row.getByRole("cell").nth(2)).toHaveText("0");
  await expect(row.getByRole("cell").nth(3)).toHaveText(/[1-9]\d*/);
  await expect(row.getByRole("cell").nth(4)).toHaveText("未知");
  await expect(page.getByText(/未录入个人明细不等于确认未出场/)).toBeVisible();
});

[320, 390].forEach((width) => {
  test(`club return link leaves mobile roster navigation clickable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/board");
    await expect(page.getByRole("link", { name: "← 俱乐部" })).toBeVisible();
    const rosterTab = page
      .getByRole("navigation", { name: "操作分区" })
      .getByRole("button", { name: "阵容", exact: true });
    await rosterTab.click();
    await expect(rosterTab).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#mobile-roster-panel")).toBeVisible();
  });
});

test("first board save adopts club-only players immediately and persists them on reopening", async ({
  page,
  request,
}) => {
  const name = `首次载入俱乐部球员${Date.now()}`;
  const response = await request.post("/api/players", { data: { name, positions: ["中场"] } });
  expect(response.ok()).toBeTruthy();
  const player = await response.json();
  const before = await (await request.get("/api/coaching-desk")).json();
  expect(before.desk).toBeNull();
  await page.goto("/board");
  await expect(page.locator(".roster-item").filter({ hasText: name })).toBeVisible();
  await page.getByRole("link", { name: "← 俱乐部" }).click();
  await expect(page).toHaveURL(/\/club$/);
  const saved = await (await request.get("/api/coaching-desk")).json();
  expect(saved.desk.players.some((p: { playerId: string }) => p.playerId === player.id)).toBeTruthy();
  await page.getByRole("link", { name: "战术板 ↗" }).click();
  await expect(page.locator(".roster-item").filter({ hasText: name })).toBeVisible();
});

test("autosave preserves board undo and redo history", async ({ page, request }) => {
  expect((await request.post("/api/players", { data: { name: "撤销历史虚构球员" } })).ok()).toBe(true);
  await page.goto("/board");
  const row = page.locator(".roster-item").first();
  await row.getByRole("button", { name: /队员详情/ }).click();
  const status = row.getByRole("combobox", { name: "状态", exact: true });
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/coaching-desk") && response.request().method() === "PUT" && response.ok()
  );
  await selectUiOption(status, "injured");
  await saved;
  await expect(page.getByLabel("保存状态")).toContainText("已保存");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expectUiValue(status, "ok");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expectUiValue(status, "injured");
});
