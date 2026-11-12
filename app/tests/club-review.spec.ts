/* eslint-disable no-restricted-syntax, no-await-in-loop -- Browser steps share a page and must run sequentially, not concurrently. */
import { mkdir } from "node:fs/promises";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures";

async function seedMatch(request: APIRequestContext, opponent = "审查对手", extra = {}) {
  const response = await request.post("/api/matches", {
    data: { opponent, date: "2092-01-15", status: "published", ...extra },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function seedPlayer(request: APIRequestContext, name = "审查球员") {
  const response = await request.post("/api/players", { data: { name, positions: ["中场"] } });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function holdWrite(page: Page, url: string) {
  let release!: () => void;
  let seen!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    seen = resolve;
  });
  await page.route(url, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const response = await route.fetch();
    seen();
    await hold;
    return route.fulfill({ response });
  });
  return { release, intercepted };
}

test("history jump between match details reloads the route and cannot write the previous match", async ({
  page,
  request,
}) => {
  const a = await seedMatch(request, "比赛甲");
  const b = await seedMatch(request, "比赛乙");
  await page.goto(`/club/matches/${a.id}`);
  await expect(page.getByLabel("对手", { exact: true })).toHaveValue("比赛甲");
  await page.getByRole("link", { name: "← 全部比赛" }).click();
  await page.locator("article").filter({ hasText: "比赛乙" }).getByRole("link").click();
  await expect(page.getByLabel("对手", { exact: true })).toHaveValue("比赛乙");
  await page.evaluate(() => window.history.go(-2));
  await expect(page).toHaveURL(new RegExp(`/club/matches/${a.id}$`));
  await expect(page.getByLabel("对手", { exact: true })).toHaveValue("比赛甲");
  await page.getByLabel("地点", { exact: true }).fill("甲队的新场地");
  await page.getByRole("button", { name: "保存比赛信息" }).click();
  await expect(page.getByRole("status")).toHaveText("比赛信息已保存");
  expect((await (await request.get(`/api/matches/${a.id}`)).json()).location).toBe("甲队的新场地");
  const untouched = await (await request.get(`/api/matches/${b.id}`)).json();
  expect(untouched.opponent).toBe("比赛乙");
  expect(untouched.location).toBe("");
});

test("match and roster saves lock fields while pending and preserve unsaved sibling edits", async ({
  page,
  request,
}) => {
  const player = await seedPlayer(request);
  const match = await seedMatch(request);
  await page.goto(`/club/matches/${match.id}`);
  await page.getByLabel("添加至名单").selectOption(player.id);
  await page.getByRole("button", { name: "添加球员", exact: true }).click();
  await page.getByLabel(`${player.name}比赛位置`).fill("中锋");
  const held = await holdWrite(page, `**/api/matches/${match.id}`);
  await page.getByLabel("地点", { exact: true }).fill("保存中的场地");
  await page.getByRole("button", { name: "保存比赛信息" }).click();
  await held.intercepted;
  await expect(page.getByLabel("赛前计划 / 赛后分析")).toBeDisabled();
  await expect(page.getByLabel(`${player.name}比赛位置`)).toBeDisabled();
  await expect(page.getByRole("button", { name: "移出" })).toBeDisabled();
  held.release();
  await expect(page.getByRole("status")).toHaveText("比赛信息已保存");
  await expect(page.getByLabel(`${player.name}比赛位置`)).toHaveValue("中锋");
  await page.getByLabel("赛前计划 / 赛后分析").fill("名单保存不能覆盖这份未保存分析");
  await page.getByRole("button", { name: "保存名单与出场数据" }).click();
  await expect(page.getByRole("status")).toHaveText("名单与实际出场已保存");
  await expect(page.getByLabel("赛前计划 / 赛后分析")).toHaveValue("名单保存不能覆盖这份未保存分析");
  await page.getByRole("button", { name: "保存比赛信息" }).click();
  await expect(page.getByRole("status")).toHaveText("比赛信息已保存");
  expect((await (await request.get(`/api/matches/${match.id}`)).json()).roster[0].position).toBe("中锋");
});
for (const panel of ["match", "roster"] as const) {
  test(`${panel} conflict retains input and requires explicit reload`, async ({ page, request }) => {
    const player = await seedPlayer(request);
    const match = await seedMatch(request);
    await page.goto(`/club/matches/${match.id}`);
    await expect(page.getByLabel("对手", { exact: true })).toHaveValue(match.opponent);
    await page.getByLabel("赛前计划 / 赛后分析").fill("保留本地分析");
    await page.getByLabel("添加至名单").selectOption(player.id);
    await page.getByRole("button", { name: "添加球员", exact: true }).click();
    await page.getByLabel(`${player.name}比赛位置`).fill("保留本地位置");
    expect(
      (
        await request.put(`/api/matches/${match.id}`, {
          data: { revision: match.revision, analysis: "其他管理员的新分析" },
        })
      ).ok()
    ).toBe(true);
    await page.getByRole("button", { name: panel === "match" ? "保存比赛信息" : "保存名单与出场数据" }).click();
    await expect(page.getByRole("alert")).toContainText("你的输入已保留");
    await expect(page.getByLabel("赛前计划 / 赛后分析")).toHaveValue("保留本地分析");
    await expect(page.getByLabel(`${player.name}比赛位置`)).toHaveValue("保留本地位置");
    expect((await (await request.get(`/api/matches/${match.id}`)).json()).analysis).toBe("其他管理员的新分析");
    await page.getByRole("button", { name: "重新载入比赛（放弃未保存修改）" }).click();
    await expect(page.getByLabel("赛前计划 / 赛后分析")).toHaveValue("其他管理员的新分析");
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("player save locks cancellation and switching, then stale profile retains the draft", async ({
  page,
  request,
}) => {
  const player = await seedPlayer(request);
  await seedPlayer(request, "另一个球员");
  await page.goto("/club/players");
  await page
    .getByRole("row")
    .filter({ hasText: player.name })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.getByLabel("姓名", { exact: true }).fill("第一次保存");
  const held = await holdWrite(page, `**/api/players/${player.id}`);
  await page.getByRole("button", { name: "保存球员" }).click();
  await held.intercepted;
  await expect(page.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "添加球员", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("row").filter({ hasText: "另一个球员" }).getByRole("button", { name: "编辑", exact: true })
  ).toBeDisabled();
  held.release();
  await expect(page.getByRole("status")).toHaveText("球员资料已保存");
  await page.unroute(`**/api/players/${player.id}`);
  await page
    .getByRole("row")
    .filter({ hasText: "第一次保存" })
    .getByRole("button", { name: "编辑", exact: true })
    .click();
  await page.getByLabel("姓名", { exact: true }).fill("保留球员草稿");
  const fresh = await (await request.get(`/api/players/${player.id}`)).json();
  expect(
    (
      await request.put(`/api/players/${player.id}`, { data: { revision: fresh.revision, name: "其他管理员姓名" } })
    ).ok()
  ).toBe(true);
  await page.getByRole("button", { name: "保存球员" }).click();
  await expect(page.getByRole("alert")).toContainText("你的输入已保留");
  await expect(page.getByLabel("姓名", { exact: true })).toHaveValue("保留球员草稿");
  await page.getByRole("button", { name: "重新载入球员（放弃未保存修改）" }).click();
  await expect(page.getByRole("row").filter({ hasText: "其他管理员姓名" })).toBeVisible();
});

test("season creation does not repeat after a failed statistics refresh and season conflict preserves input", async ({
  page,
  request,
}) => {
  await page.goto("/club/statistics");
  await expect(page.getByRole("heading", { name: /场已完赛/ })).toBeVisible();
  await page.getByRole("button", { name: "新建赛季", exact: true }).click();
  await page.getByLabel("赛季名称").fill("只创建一次的跨年赛季");
  await page.getByLabel("开始日期").fill("2091-08-01");
  await page.getByLabel("结束日期").fill("2092-07-31");
  await page.route("**/api/statistics?*", (route) =>
    route.fulfill({ status: 503, json: { message: "统计临时不可用" } })
  );
  await page.route("**/api/seasons", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ status: 503, json: { message: "列表临时不可用" } })
      : route.continue()
  );
  await page.getByRole("button", { name: "保存赛季" }).click();
  await expect(page.getByRole("alert")).toContainText("统计临时不可用");
  await expect(page.getByRole("button", { name: "保存赛季" })).toHaveCount(0);
  await expect(page.getByText("只创建一次的跨年赛季", { exact: true })).toBeVisible();
  await page.unroute("**/api/seasons");
  await page.unroute("**/api/statistics?*");
  const seasons = await (await request.get("/api/seasons")).json();
  expect(seasons.filter((s: { name: string }) => s.name === "只创建一次的跨年赛季")).toHaveLength(1);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("赛季名称").fill("本地赛季草稿");
  const season = seasons.find((s: { name: string }) => s.name === "只创建一次的跨年赛季");
  expect(
    (await request.put(`/api/seasons/${season.id}`, { data: { revision: season.revision, name: "远程赛季名称" } })).ok()
  ).toBe(true);
  await page.getByRole("button", { name: "保存赛季" }).click();
  await expect(page.getByRole("alert")).toContainText("你的输入已保留");
  await expect(page.getByLabel("赛季名称")).toHaveValue("本地赛季草稿");
  await page.getByRole("button", { name: "重新载入赛季（放弃未保存修改）" }).click();
  await expect(page.getByText("远程赛季名称", { exact: true })).toBeVisible();
});

test("team summary shows partial coverage and unknown scores rather than inventing zero", async ({ page, request }) => {
  await seedMatch(request, "已知胜局", { status: "completed", homeScore: 2, awayScore: 1 });
  await seedMatch(request, "部分已知", { status: "completed", homeScore: null, awayScore: 0 });
  await seedMatch(request, "完全未知", { status: "completed", date: "2093-01-01" });
  await page.goto("/club/statistics");
  await page.getByLabel("年份").fill("2092");
  await page.getByLabel("年份").blur();
  const summary = page.getByRole("region", { name: "球队汇总" });
  await expect(summary).toContainText("1 胜 · 0 平 · 0 负");
  await expect(summary).toContainText("胜平负覆盖：1 / 2 场");
  await expect(summary).toContainText("进球记录覆盖：1 / 2 场");
  await expect(summary).toContainText("失球记录覆盖：2 / 2 场");
  await page.getByLabel("年份").fill("2093");
  await page.getByLabel("年份").blur();
  await expect(summary).toContainText("已知进球 未知 · 已知失球 未知");
  await expect(summary).toContainText("胜平负覆盖：0 / 1 场");
});

test("expired admin session returns to login and player login cannot reuse admin controls", async ({
  page,
  request,
}) => {
  const player = await seedPlayer(request);
  expect(
    (
      await request.post(`/api/players/${player.id}/account`, {
        data: { username: "reviewplayer", password: "review-password-123" },
      })
    ).ok()
  ).toBe(true);
  await page.goto("/club/players");
  await expect(page.getByRole("button", { name: "添加球员", exact: true })).toBeVisible();
  await request.post("/api/auth/logout", { data: {} });
  await page.getByRole("link", { name: "统计与赛季" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("用户名").fill("reviewplayer");
  await page.getByLabel("密码", { exact: true }).fill("review-password-123");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/club$/);
  await page.getByRole("link", { name: "球员", exact: true }).click();
  await expect(page.getByRole("button", { name: "添加球员", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "战术板 ↗" })).toHaveCount(0);
});
for (const width of [320, 390, 1440]) {
  test(`club screens fit ${width}px and provide admin and player review screenshots`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 960 });
    const player = await seedPlayer(request, "视觉复核球员");
    const season = await (
      await request.post("/api/seasons", {
        data: { name: "视觉复核赛季", startDate: "2091-08-01", endDate: "2092-07-31" },
      })
    ).json();
    expect(
      (
        await request.put(`/api/seasons/${season.id}/roster`, {
          data: { revision: season.revision, roster: [{ playerId: player.id, number: 7 }] },
        })
      ).ok()
    ).toBe(true);
    const savedTactic = await seedSnapshotTactic(request, player.id);
    const match = await seedMatch(
      request,
      "非常长的对手球队名称LongOpponentNameWithoutAnySpacesABCDEFGHIJKLMNOPQRSTUVWXYZ",
      {
        status: "completed",
        homeScore: 2,
        awayScore: null,
        analysis: "比赛观察：保持传接球节奏。\n下一场改善回防与保护。",
        seasonId: season.id,
        competition: "周末联赛",
        format: 8,
        side: "home",
        tacticIds: [savedTactic.tacticId],
      }
    );
    expect(
      (
        await request.put(`/api/matches/${match.id}/roster`, {
          data: {
            revision: match.revision,
            roster: [
              { playerId: player.id, position: "中场", selection: "starter", appeared: true, goals: 1, assists: null },
            ],
          },
        })
      ).ok()
    ).toBe(true);
    expect(
      (
        await request.post(`/api/players/${player.id}/account`, {
          data: { username: "visualplayer", password: "visual-password-123" },
        })
      ).ok()
    ).toBe(true);
    const team = await (await request.get("/api/team")).json();
    const crest = await crestImage(page);
    expect(
      (
        await request.put("/api/team", {
          data: { revision: team.revision, name: "视觉复核足球俱乐部LongClubNameWithoutSpaces", crest },
        })
      ).ok()
    ).toBe(true);
    await mkdir("test-results/visual-review", { recursive: true });
    for (const role of ["admin", "player"]) {
      if (role === "player") {
        await request.post("/api/auth/logout", { data: {} });
        expect(
          (
            await request.post("/api/auth/login", {
              data: { username: "visualplayer", password: "visual-password-123" },
            })
          ).ok()
        ).toBe(true);
      }
      for (const [name, path, heading] of [
        ["matches", "/club", "球队比赛"],
        ["detail", `/club/matches/${match.id}`, "比赛名单与实际出场"],
        ["players", "/club/players", "球队球员"],
        ["statistics", "/club/statistics", "统计与赛季"],
        ["team-account", "/club/account", "我的账号"],
      ]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
        if (name === "statistics") {
          await page.getByLabel("年份").fill("2092");
          await page.getByLabel("年份").blur();
          await expect(page.getByRole("region", { name: "球队汇总" })).toContainText("0 / 1 场");
        }
        if (name === "detail") {
          const score = page.locator(".club-match-heading .club-score");
          expect(await score.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("nowrap");
          const scoreBox = await score.boundingBox();
          expect(scoreBox!.height).toBeLessThan(65);
          if (role === "player") await expect(page.getByText(/先更新并保存本队比分/)).toHaveCount(0);
          await page.getByText("查看已保存战术：快照阵型").click();
          await expect(page.getByRole("img", { name: "快照阵型已保存战术画布" })).toBeVisible();
          if (width <= 390) {
            const table = page.getByRole("region", { name: "比赛名单表", exact: true });
            await expect(page.getByText("表格还有更多列，请左右滑动或使用方向键查看。")).toBeVisible();
            expect(
              await table.evaluate((el) => {
                el.scrollTo(el.scrollWidth, 0);
                return el.scrollLeft;
              })
            ).toBeGreaterThan(0);
            await table.evaluate((el) => {
              el.scrollTo(0, 0);
            });
          }
        }
        await expect(page.getByText(/正在载入|正在计算统计/)).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (width !== 320)
          await page.screenshot({ path: `test-results/visual-review/${role}-${name}-${width}.png`, fullPage: true });
        if (name === "statistics") {
          await page.getByRole("button", { name: "赛季名单", exact: true }).click();
          const rosterCard = page.getByRole("form", { name: "赛季名单详情", exact: true });
          await expect(rosterCard).toBeVisible();
          if (width !== 320)
            await rosterCard.screenshot({ path: `test-results/visual-review/${role}-season-roster-${width}.png` });
        }
      }
    }
  });
}

test("failed match save retains the draft and retry sends only one new request", async ({ page, request }) => {
  const match = await seedMatch(request);
  await page.goto(`/club/matches/${match.id}`);
  await page.getByLabel("赛前计划 / 赛后分析").fill("失败后保留的分析");
  let writes = 0;
  await page.route(`**/api/matches/${match.id}`, (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes += 1;
    return route.fulfill({ status: 503, json: { message: "临时保存失败" } });
  });
  await page.getByRole("button", { name: "保存比赛信息" }).click();
  await expect(page.getByRole("alert")).toContainText("临时保存失败");
  await expect(page.getByLabel("赛前计划 / 赛后分析")).toBeEnabled();
  await expect(page.getByLabel("赛前计划 / 赛后分析")).toHaveValue("失败后保留的分析");
  expect(writes).toBe(1);
  await page.unroute(`**/api/matches/${match.id}`);
  await page.getByRole("button", { name: "保存比赛信息" }).click();
  await expect(page.getByRole("status")).toHaveText("比赛信息已保存");
  expect((await (await request.get(`/api/matches/${match.id}`)).json()).analysis).toBe("失败后保留的分析");
});
test("deleting a template preserves the match tactic snapshot", async ({ page, request }) => {
  await page.goto("/board");
  await expect(page.getByLabel("保存状态")).toContainText("已保存");
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page.getByRole("textbox", { name: "战术名称", exact: true }).fill("关联比赛不能误删的战术");
  await page.getByRole("button", { name: "保存当前战术", exact: true }).click();
  const card = page.locator(".tactic-item").filter({ hasText: "关联比赛不能误删的战术" });
  await expect(card).toBeVisible();
  const [tactic] = await (await request.get("/api/tactics")).json();
  const match = await seedMatch(request, "保留战术关联", { tacticIds: [tactic.tacticId] });
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "删除战术", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect((await (await request.get(`/api/matches/${match.id}`)).json()).tacticIds).toEqual([tactic.tacticId]);
  expect((await request.get(`/api/tactics/${tactic.tacticId}`)).status()).toBe(404);
  const saved = await (await request.get(`/api/matches/${match.id}`)).json();
  expect(saved.tacticSnapshots[0].tactic.title).toBe("关联比赛不能误删的战术");
});
async function crestImage(page: Page, color = "green") {
  return page.evaluate((fill) => {
    const canvas = document.createElement("canvas");
    canvas.width = 12;
    canvas.height = 12;
    const context = canvas.getContext("2d")!;
    context.fillStyle = fill;
    context.fillRect(0, 0, 12, 12);
    return canvas.toDataURL("image/png");
  }, color);
}
function crestFile(data: string, name = "crest.png") {
  return { name, mimeType: "image/png", buffer: Buffer.from(data.split(",")[1], "base64") };
}

test("team name and crest save immediately updates the header without clearing password draft", async ({
  page,
  request,
}) => {
  await page.goto("/club/account");
  await expect(page.getByLabel("球队名称", { exact: true })).toBeEnabled();
  await page.getByLabel("当前密码").fill("unsaved-password-draft");
  await page.getByLabel("新密码（至少 10 位）").fill("unsaved-new-password");
  const image = await crestImage(page);
  await page.getByLabel("上传球队队徽").setInputFiles(crestFile(image));
  await expect(page.getByAltText("球队队徽预览")).toHaveAttribute("src", image);
  await page.getByLabel("球队名称", { exact: true }).fill("新的球队名称");
  const held = await holdWrite(page, "**/api/team");
  await page.getByRole("button", { name: "保存球队资料", exact: true }).click();
  await held.intercepted;
  await expect(page.getByLabel("球队名称", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("上传球队队徽")).toBeDisabled();
  await expect(page.getByRole("button", { name: "移除自定义队徽" })).toBeDisabled();
  held.release();
  await expect(page.getByRole("status")).toHaveText("球队资料已保存");
  await expect(page.locator(".club-brand")).toContainText("新的球队名称");
  await expect(page.locator(".club-brand img")).toHaveAttribute("src", image);
  await expect(page.getByLabel("当前密码")).toHaveValue("unsaved-password-draft");
  await expect(page.getByLabel("新密码（至少 10 位）")).toHaveValue("unsaved-new-password");
  await page.unroute("**/api/team");
  await page.reload();
  await expect(page.getByLabel("球队名称", { exact: true })).toHaveValue("新的球队名称");
  await expect(page.getByAltText("球队队徽预览")).toHaveAttribute("src", image);
  await page.getByRole("button", { name: "移除自定义队徽" }).click();
  await page.getByRole("button", { name: "保存球队资料", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("球队资料已保存");
  expect((await (await request.get("/api/team")).json()).crest).toBeNull();
  await expect(page.locator(".club-brand img")).toHaveAttribute("src", "/team-badge.png");
});
test("team failed save and revision conflict preserve draft, explicit reload preserves password fields", async ({
  page,
  request,
}) => {
  await page.goto("/club/account");
  await page.getByLabel("球队名称", { exact: true }).fill("本地球队草稿");
  await page.getByLabel("当前密码").fill("keep-current-password");
  const image = await crestImage(page);
  await page.getByLabel("上传球队队徽").setInputFiles(crestFile(image));
  await expect(page.getByAltText("球队队徽预览")).toHaveAttribute("src", image);
  await page.route("**/api/team", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { message: "球队保存临时失败" } })
      : route.continue()
  );
  await page.getByRole("button", { name: "保存球队资料", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("球队保存临时失败");
  await expect(page.getByLabel("球队名称", { exact: true })).toHaveValue("本地球队草稿");
  await expect(page.getByAltText("球队队徽预览")).toHaveAttribute("src", image);
  await page.unroute("**/api/team");
  const team = await (await request.get("/api/team")).json();
  expect((await request.put("/api/team", { data: { revision: team.revision, name: "远程球队名称" } })).ok()).toBe(true);
  await page.getByRole("button", { name: "保存球队资料", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("你的输入已保留");
  await expect(page.getByLabel("球队名称", { exact: true })).toHaveValue("本地球队草稿");
  await expect(page.getByAltText("球队队徽预览")).toHaveAttribute("src", image);
  await page.getByRole("button", { name: "重新载入球队（放弃未保存修改）" }).click();
  await expect(page.getByLabel("球队名称", { exact: true })).toHaveValue("远程球队名称");
  await expect(page.getByLabel("当前密码")).toHaveValue("keep-current-password");
});
test("crest rejects unsupported and oversized files and ignores superseded file read completion", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeReader = window.FileReader;
    const completions: (() => void)[] = [];
    Object.defineProperty(window, "finishCrestReads", { value: completions });
    Object.defineProperty(window, "FileReader", {
      value: class {
        result: string | ArrayBuffer | null = null;

        onload?: () => void;

        onerror?: () => void;

        // A completed callback can remain queued even after cancellation.
        abort() {
          this.result = null;
        }

        readAsDataURL(file: Blob) {
          const real = new NativeReader();
          real.onload = () =>
            completions.push(() => {
              this.result = real.result;
              this.onload?.();
            });
          real.onerror = () => this.onerror?.();
          real.readAsDataURL(file);
        }
      },
    });
  });
  await page.goto("/club/account");
  const input = page.getByLabel("上传球队队徽");
  await input.setInputFiles({ name: "bad.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(page.getByRole("alert")).toContainText("请选择 PNG、JPEG、WebP 或 GIF 图片");
  await input.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(2 * 1024 * 1024 + 1) });
  await expect(page.getByRole("alert")).toContainText("不能超过 2 MiB");
  const first = await crestImage(page, "green");
  const second = await crestImage(page, "blue");
  await input.setInputFiles(crestFile(first, "first.png"));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { finishCrestReads: unknown[] }).finishCrestReads.length))
    .toBe(1);
  await expect(page.getByRole("button", { name: "保存球队资料", exact: true })).toBeDisabled();
  await input.setInputFiles(crestFile(second, "second.png"));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { finishCrestReads: unknown[] }).finishCrestReads.length))
    .toBe(2);
  await page.evaluate(() => {
    const callbacks = (window as unknown as { finishCrestReads: (() => void)[] }).finishCrestReads;
    callbacks[1]();
    callbacks[0]();
  });
  await expect(page.getByAltText("球队队徽预览")).toHaveAttribute("src", second);
  await input.setInputFiles(crestFile(first, "third.png"));
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { finishCrestReads: unknown[] }).finishCrestReads.length))
    .toBe(3);
  await page.getByRole("button", { name: "移除自定义队徽" }).click();
  await page.evaluate(() => (window as unknown as { finishCrestReads: (() => void)[] }).finishCrestReads[2]());
  await expect(page.getByAltText("球队队徽预览")).toHaveAttribute("src", "/team-badge.png");
});
test("player sees team details and custom crest without editing controls", async ({ page, request }) => {
  const player = await seedPlayer(request);
  const team = await (await request.get("/api/team")).json();
  const image = await crestImage(page);
  expect(
    (await request.put("/api/team", { data: { revision: team.revision, name: "球员只读球队", crest: image } })).ok()
  ).toBe(true);
  expect(
    (
      await request.post(`/api/players/${player.id}/account`, {
        data: { username: "teamplayer", password: "team-player-password" },
      })
    ).ok()
  ).toBe(true);
  await request.post("/api/auth/logout", { data: {} });
  expect(
    (await request.post("/api/auth/login", { data: { username: "teamplayer", password: "team-player-password" } })).ok()
  ).toBe(true);
  await page.goto("/club/account");
  const card = page.getByRole("region", { name: "球队资料", exact: true });
  await expect(card).toContainText("球员只读球队");
  await expect(card.getByAltText("球队队徽预览")).toHaveAttribute("src", image);
  await expect(page.getByRole("button", { name: "保存球队资料", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("上传球队队徽")).toHaveCount(0);
});
test("opponent results follow cross-year season and calendar-year filters with unknown coverage", async ({
  page,
  request,
}) => {
  await seedMatch(request, "跨年交锋对手", { status: "completed", date: "2091-12-31" });
  await seedMatch(request, "跨年交锋对手", { status: "completed", date: "2092-01-01", homeScore: 2, awayScore: 1 });
  await seedMatch(request, "完全未知对手", { status: "completed", date: "2092-01-02" });
  const response = await request.post("/api/seasons", {
    data: { name: "对手交锋跨年赛季", startDate: "2091-08-01", endDate: "2092-07-31" },
  });
  expect(response.ok()).toBe(true);
  const season = await response.json();
  const assignedMatches = await (await request.get("/api/matches")).json();
  for (const m of assignedMatches)
    expect(
      (await request.put(`/api/matches/${m.id}`, { data: { revision: m.revision, seasonId: season.id } })).ok()
    ).toBe(true);
  await page.goto("/club/statistics");
  await page.getByLabel("统计周期").selectOption("season");
  await page.getByLabel("赛季", { exact: true }).selectOption(String(season.id));
  const region = page.getByRole("region", { name: "对手交锋", exact: true });
  const row = region.getByRole("row").filter({ hasText: "跨年交锋对手" });
  await expect(row.getByRole("cell").nth(1)).toHaveText("2");
  await expect(row.getByRole("cell").nth(2)).toHaveText("1 / 0 / 0");
  await expect(row.getByRole("cell").nth(3)).toHaveText("1 / 2 场");
  const unknownRow = region.getByRole("row").filter({ hasText: "完全未知对手" });
  await expect(unknownRow.getByRole("cell").nth(4)).toHaveText("未知");
  await expect(unknownRow.getByRole("cell").nth(6)).toHaveText("未知");
  await expect(unknownRow.getByRole("cell").nth(3)).toHaveText("0 / 1 场");
  await page.getByLabel("统计周期").selectOption("year");
  await page.getByLabel("年份").fill("2092");
  await page.getByLabel("年份").blur();
  await expect(row.getByRole("cell").nth(1)).toHaveText("1");
  await expect(row.getByRole("cell").nth(3)).toHaveText("1 / 1 场");
});

async function seedSnapshotTactic(request: APIRequestContext, playerId: string) {
  const response = await request.post("/api/tactics", {
    data: {
      tactic: {
        title: "快照阵型",
        tags: [],
        favorite: false,
        formationName: "2-3-2",
        thumbnail: null,
        board: {
          playerCount: 8,
          pieces: [
            {
              pieceId: "saved-player",
              kind: "player",
              x: 300,
              y: 400,
              label: "保存时球员",
              shirtNumber: 7,
              playerId,
              color: "#2465a8",
            },
          ],
          markings: [],
          trainingPlan: { objective: "保存时计划", instructions: "保持宽度", durationMinutes: 20 },
          demonstration: {
            demonstrationId: "saved-demo",
            title: "保存演示",
            participants: [
              {
                pieceId: "saved-player",
                kind: "player",
                x: 300,
                y: 400,
                label: "保存时球员",
                shirtNumber: 7,
                playerId,
              },
            ],
            stages: [
              { stageNumber: 0, title: "初始", positions: [{ pieceId: "saved-player", x: 300, y: 400 }] },
              { stageNumber: 1, title: "前插", positions: [{ pieceId: "saved-player", x: 500, y: 400 }] },
            ],
            runs: [],
          },
        },
      },
      note: "快照测试",
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test("season roster and match fields preserve historical identity, number and tactic after later edits", async ({
  page,
  request,
}) => {
  const player = await seedPlayer(request, "赛时姓名");
  const tactic = await seedSnapshotTactic(request, player.id);
  const season = await (
    await request.post("/api/seasons", { data: { name: "归属跨年季", startDate: "2091-08-01", endDate: "2092-07-31" } })
  ).json();
  await page.goto("/club/statistics");
  await page.getByRole("button", { name: "赛季名单", exact: true }).click();
  await page.getByLabel("添加赛季球员").selectOption(player.id);
  await page.getByRole("button", { name: "加入赛季名单" }).click();
  await page.getByLabel("赛时姓名赛季号码").fill("22");
  const seasonSaved = page.waitForResponse(
    (r) => r.url().endsWith(`/api/seasons/${season.id}/roster`) && r.request().method() === "PUT"
  );
  await page.getByRole("button", { name: "保存赛季名单" }).click();
  expect((await seasonSaved).ok()).toBe(true);
  await page.getByRole("link", { name: "比赛", exact: true }).click();
  await page.getByRole("button", { name: "新建比赛" }).click();
  await page.getByLabel("对手", { exact: true }).fill("归属对手");
  await page.getByLabel("比赛日期").fill("2092-01-01");
  await page.getByLabel("赛事名称").fill("业余杯");
  await page.getByLabel("比赛人数制").selectOption("8");
  await page.getByLabel("主客场", { exact: true }).selectOption("away");
  await page.getByLabel("归属赛季").selectOption(String(season.id));
  await page.getByRole("button", { name: "创建草稿" }).click();
  await expect(page.getByLabel("赛事名称")).toHaveValue("业余杯");
  await expect(page.getByLabel("主客场", { exact: true })).toHaveValue("away");
  await page.getByLabel("快照阵型", { exact: true }).check();
  await page.getByLabel("发布状态").selectOption("completed");
  await page.getByRole("button", { name: "保存比赛信息" }).click();
  await expect(page.getByRole("status")).toHaveText("比赛信息已保存");
  await page.getByLabel("添加至名单").selectOption(player.id);
  await page.getByRole("button", { name: "添加球员", exact: true }).click();
  await page.getByLabel("赛时姓名首发替补").selectOption("bench");
  await page.getByLabel("赛时姓名实际出场").selectOption({ label: "已出场" });
  await page.getByRole("button", { name: "保存名单与出场数据" }).click();
  await expect(page.getByRole("status")).toHaveText("名单与实际出场已保存");
  const id = Number(page.url().split("/").pop());
  const roster = page.getByRole("region", { name: "比赛名单表", exact: true });
  await expect(roster.getByRole("row").filter({ hasText: "赛时姓名" }).getByRole("cell").nth(1)).toHaveText("22");
  const freshPlayer = await (await request.get(`/api/players/${player.id}`)).json();
  expect(
    (
      await request.put(`/api/players/${player.id}`, {
        data: { revision: freshPlayer.revision, name: "现在姓名", number: 88 },
      })
    ).ok()
  ).toBe(true);
  const sr = await (await request.get(`/api/seasons/${season.id}/roster`)).json();
  expect(
    (
      await request.put(`/api/seasons/${season.id}/roster`, {
        data: { revision: sr.season.revision, roster: [{ playerId: player.id, number: 44 }] },
      })
    ).ok()
  ).toBe(true);
  expect(
    (
      await request.put(`/api/tactics/${tactic.tacticId}`, {
        data: { tactic: { ...tactic, title: "新版模板", board: { ...tactic.board, pieces: [] } } },
      })
    ).ok()
  ).toBe(true);
  expect((await request.delete(`/api/tactics/${tactic.tacticId}`)).ok()).toBe(true);
  await page.reload();
  await expect(roster).toContainText("赛时姓名");
  await expect(roster).not.toContainText("现在姓名");
  await expect(roster.getByRole("row").filter({ hasText: "赛时姓名" }).getByRole("cell").nth(1)).toHaveText("22");
  await page.getByText("查看已保存战术：快照阵型").click();
  const canvas = page.getByRole("img", { name: "快照阵型已保存战术画布" });
  await expect(canvas).toContainText("保存时球员");
  await page.getByLabel("战术演示步骤").selectOption("1");
  await expect(canvas.locator('[data-piece-id="saved-player"]')).toHaveAttribute("transform", "translate(500 400)");
  await page.getByLabel("地点", { exact: true }).fill("只改地点");
  await page.getByRole("button", { name: "保存比赛信息" }).click();
  await expect(page.getByRole("status")).toHaveText("比赛信息已保存");
  expect((await (await request.get(`/api/matches/${id}`)).json()).tacticSnapshots[0].tactic.title).toBe("快照阵型");
});

test("registration yes no maybe unanswered and actual attendance remain separate", async ({ page, request }) => {
  const player = await seedPlayer(request, "报名统计球员");
  expect(
    (
      await request.post(`/api/players/${player.id}/account`, {
        data: { username: "registration-review", password: "registration-password" },
      })
    ).ok()
  ).toBe(true);
  const season = await (
    await request.post("/api/seasons", { data: { name: "报名赛季", startDate: "2091-08-01", endDate: "2092-07-31" } })
  ).json();
  const matches = [];
  for (const response of ["yes", "no", "maybe", "unanswered"])
    matches.push(await seedMatch(request, response, { seasonId: season.id }));
  await seedMatch(request, "不归属赛季", { status: "completed" });
  await request.post("/api/auth/logout", { data: {} });
  expect(
    (
      await request.post("/api/auth/login", {
        data: { username: "registration-review", password: "registration-password" },
      })
    ).ok()
  ).toBe(true);
  for (let i = 0; i < 3; i += 1)
    expect(
      (await request.put(`/api/matches/${matches[i].id}/rsvp`, { data: { response: ["yes", "no", "maybe"][i] } })).ok()
    ).toBe(true);
  await request.post("/api/auth/logout", { data: {} });
  expect(
    (await request.post("/api/auth/login", { data: { username: "testadmin", password: "test-password-123" } })).ok()
  ).toBe(true);
  const completed = await (
    await request.put(`/api/matches/${matches[0].id}`, { data: { revision: matches[0].revision, status: "completed" } })
  ).json();
  expect(
    (
      await request.put(`/api/matches/${completed.id}/roster`, {
        data: { revision: completed.revision, roster: [{ playerId: player.id, selection: "starter", appeared: null }] },
      })
    ).ok()
  ).toBe(true);
  await page.goto("/club/statistics");
  await page.getByLabel("统计周期").selectOption("season");
  await page.getByLabel("赛季", { exact: true }).selectOption(String(season.id));
  const row = page
    .getByRole("region", { name: "球员统计表", exact: true })
    .getByRole("row")
    .filter({ hasText: player.name });
  for (const i of [8, 9, 10, 11]) await expect(row.getByRole("cell").nth(i)).toHaveText("1");
  await expect(row.getByRole("cell").nth(1)).toHaveText("0");
  await expect(row.getByRole("cell").nth(2)).toHaveText("1");
  await expect(page.getByRole("region", { name: "球队汇总", exact: true })).toContainText("出场待确认 1 人次");
  await expect(page.getByText(/球队有 1 场未归属赛季/)).toBeVisible();
});

test("season roster conflict retains edited number and migration snapshots disclose their origin", async ({
  page,
  request,
}) => {
  const player = await seedPlayer(request);
  const season = await (
    await request.post("/api/seasons", { data: { name: "冲突赛季", startDate: "2091-08-01", endDate: "2092-07-31" } })
  ).json();
  expect(
    (
      await request.put(`/api/seasons/${season.id}/roster`, {
        data: { revision: season.revision, roster: [{ playerId: player.id, number: 0 }] },
      })
    ).ok()
  ).toBe(true);
  await page.goto("/club/statistics");
  await page.getByRole("button", { name: "赛季名单", exact: true }).click();
  await page.getByLabel(`${player.name}赛季号码`).fill("55");
  const fresh = await (await request.get(`/api/seasons/${season.id}/roster`)).json();
  expect(
    (
      await request.put(`/api/seasons/${season.id}/roster`, {
        data: { revision: fresh.season.revision, roster: [{ playerId: player.id, number: 66 }] },
      })
    ).ok()
  ).toBe(true);
  await page.getByRole("button", { name: "保存赛季名单" }).click();
  await expect(page.getByRole("alert")).toContainText("你的输入已保留");
  await expect(page.getByLabel(`${player.name}赛季号码`)).toHaveValue("55");
  const match = await seedMatch(request);
  await page.route(`**/api/matches/${match.id}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.roster = [
      {
        playerId: player.id,
        position: "",
        selection: "unknown",
        appeared: null,
        goals: null,
        assists: null,
        playerSnapshot: { id: player.id, name: player.name, number: null, positions: [] },
        snapshotCapturedAt: 1,
        snapshotSource: "migration",
      },
    ];
    return route.fulfill({ response, json: body });
  });
  await page.goto(`/club/matches/${match.id}`);
  await expect(page.getByText(/并非真实赛时资料还原/)).toBeVisible();
});
