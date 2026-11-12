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
    const match = await seedMatch(
      request,
      "非常长的对手球队名称LongOpponentNameWithoutAnySpacesABCDEFGHIJKLMNOPQRSTUVWXYZ",
      {
        status: "completed",
        homeScore: 2,
        awayScore: null,
        analysis: "比赛观察：保持传接球节奏。\n下一场改善回防与保护。",
      }
    );
    expect(
      (
        await request.put(`/api/matches/${match.id}/roster`, {
          data: {
            revision: match.revision,
            roster: [{ playerId: player.id, position: "中场", appeared: true, goals: 1, assists: null }],
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
        await expect(page.getByText(/正在载入|正在计算统计/)).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (width !== 320)
          await page.screenshot({ path: `test-results/visual-review/${role}-${name}-${width}.png`, fullPage: true });
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
test("linked tactic deletion explains the match dependency and keeps the saved tactic visible", async ({
  page,
  request,
}) => {
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
  await expect(page.getByText(/请先解除比赛关联后再删除/)).toBeVisible();
  await expect(card).toBeVisible();
  expect((await (await request.get(`/api/matches/${match.id}`)).json()).tacticIds).toEqual([tactic.tacticId]);
  expect((await request.get(`/api/tactics/${tactic.tacticId}`)).ok()).toBe(true);
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
