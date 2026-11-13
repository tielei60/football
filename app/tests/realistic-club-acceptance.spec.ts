import { setMatchSchedule } from "./match-schedule";
import { selectUiOption } from "./ui-select";
/* eslint-disable no-await-in-loop, no-restricted-syntax -- One sequential story shares a browser session and depends on previous steps. */
import type { Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures";

const members = [
  { name: "林远（虚构）", username: "acceptance-lin", number: "9" },
  { name: "周禾（虚构）", username: "acceptance-zhou", number: "6" },
  { name: "陈川（虚构）", username: "acceptance-chen", number: "12" },
];
const password = "fictional-player-2027";
const evidenceDir = "test-results/visual-review";
async function switchAccount(page: Page, username: string, secret: string) {
  await page.goto("/club/account");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(secret);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "球队比赛" })).toBeVisible();
}

test("realistic fictional club: accounts, seasonal squad, RSVP, results, immutable history and recovery", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  await mkdir(evidenceDir, { recursive: true });
  await test.step("管理员建立球队及三个球员账号", async () => {
    await page.goto("/club/account");
    await page.getByLabel("球队名称", { exact: true }).fill("星河周末足球队（虚构演练）");
    await page.getByRole("button", { name: "保存球队资料" }).click();
    await expect(page.locator(".club-brand")).toContainText("星河周末足球队");
    await page.getByRole("link", { name: "球员", exact: true }).click();
    for (const member of members) {
      await page.getByRole("button", { name: "添加球员", exact: true }).click();
      await page.getByLabel("姓名", { exact: true }).fill(member.name);
      await page.getByLabel("球衣号码", { exact: true }).fill("99");
      await page.getByRole("checkbox", { name: "中场", exact: true }).check();
      await page.getByRole("button", { name: "保存球员", exact: true }).click();
      const row = page.getByRole("row").filter({ hasText: member.name });
      await row.getByRole("button", { name: "创建账号" }).click();
      await page.getByLabel("用户名", { exact: true }).fill(member.username);
      await page.getByLabel("新密码（至少 10 位）", { exact: true }).fill(password);
      await page.getByRole("button", { name: "创建账号", exact: true }).first().click();
      await expect(row.getByRole("button", { name: "重置密码" })).toBeVisible();
    }
  });
  const players = await (await request.get("/api/players")).json();
  const ids = members.map((m) => players.find((p: { name: string }) => p.name === m.name).id);
  await test.step("跨年赛季名单与独立号码", async () => {
    await page.getByRole("link", { name: "统计与赛季" }).click();
    await page.getByRole("button", { name: "新建赛季" }).click();
    await page.getByLabel("赛季名称", { exact: true }).fill("星河 2091–92 跨年赛季");
    await page.getByLabel("开始日期", { exact: true }).fill("2091-08-01");
    await page.getByLabel("结束日期", { exact: true }).fill("2092-07-31");
    await page.getByRole("button", { name: "保存赛季" }).click();
    await page.getByRole("button", { name: "赛季名单", exact: true }).click();
    for (let i = 0; i < members.length; i += 1) {
      await selectUiOption(page.getByLabel("添加赛季球员", { exact: true }), ids[i]);
      await page.getByRole("button", { name: "加入赛季名单" }).click();
      await page.getByLabel(`${members[i].name}赛季号码`, { exact: true }).fill(members[i].number);
    }
    await page.getByRole("button", { name: "保存赛季名单" }).click();
    await expect(page.getByRole("status").filter({ hasText: "赛季名单已保存" })).toHaveText("赛季名单已保存");
  });
  const season = (await (await request.get("/api/seasons")).json())[0];
  // API-assisted template preparation only; the club business workflow uses actual UI controls.
  const tacticResponse = await request.post("/api/tactics", {
    data: {
      tactic: {
        title: "星河赛前阵型",
        tags: [],
        favorite: false,
        formationName: "2-3-2",
        thumbnail: null,
        board: {
          playerCount: 8,
          pieces: [
            {
              pieceId: "lin",
              kind: "player",
              playerId: ids[0],
              x: 300,
              y: 400,
              label: members[0].name,
              shirtNumber: 9,
              color: "#2465a8",
            },
          ],
          markings: [],
        },
      },
    },
  });
  expect(tacticResponse.ok()).toBe(true);
  const tactic = await tacticResponse.json();
  const matches: string[] = [];
  await test.step("发布跨两个自然年的同赛季比赛", async () => {
    for (const date of ["2091-12-28", "2092-01-04"]) {
      await page.goto("/club");
      await page.getByRole("button", { name: "新建比赛" }).click();
      await page.getByLabel("对手", { exact: true }).fill("河岸联队（虚构）");
      await setMatchSchedule(page, date);
      await page.getByLabel("赛事名称", { exact: true }).fill("周末友谊杯");
      await selectUiOption(page.getByLabel("比赛人数制", { exact: true }), "8");
      await selectUiOption(page.getByRole("combobox", { name: "主客场", exact: true }), "neutral");
      await selectUiOption(page.getByLabel("归属赛季", { exact: true }), String(season.id));
      await page.getByRole("button", { name: "创建草稿" }).click();
      await expect(page.getByLabel("发布状态", { exact: true })).toBeVisible();
      matches.push(page.url());
      await selectUiOption(page.getByLabel("发布状态", { exact: true }), "published");
      await page.getByLabel("星河赛前阵型", { exact: true }).check();
      await page.getByRole("button", { name: "保存比赛信息" }).click();
      await expect(page.getByRole("status").filter({ hasText: "比赛信息已保存" })).toHaveText("比赛信息已保存");
    }
  });
  await test.step("三个球员独立登录并参加、不参加、待定", async () => {
    for (let i = 0; i < members.length; i += 1) {
      await switchAccount(page, members[i].username, password);
      await page.goto(matches[0]);
      await page.getByRole("button", { name: ["参加", "请假 / 不参加", "待定"][i], exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "报名意愿已更新" })).toHaveText("报名意愿已更新");
      await expect(page.getByRole("button", { name: "保存比赛信息" })).toHaveCount(0);
      await expect(page.getByText("尚未录入比赛名单")).toBeVisible();
    }
    await switchAccount(page, "testadmin", "test-password-123");
  });
  await test.step("首发替补独立于实际出场，第二场保留未知", async () => {
    for (let game = 0; game < matches.length; game += 1) {
      await page.goto(matches[game]);
      await selectUiOption(page.getByLabel("发布状态", { exact: true }), "completed");
      if (game === 0) {
        await page.getByLabel("本队比分", { exact: true }).fill("2");
        await page.getByLabel("对手比分", { exact: true }).fill("1");
      }
      await page.getByRole("button", { name: "保存比赛信息" }).click();
      await expect(page.getByRole("status").filter({ hasText: "比赛信息已保存" })).toHaveText("比赛信息已保存");
      for (let i = 0; i < members.length; i += 1) {
        await selectUiOption(page.getByLabel("添加至名单", { exact: true }), ids[i]);
        await page.getByRole("button", { name: "添加球员", exact: true }).click();
        await selectUiOption(
          page.getByLabel(`${members[i].name}首发替补`, { exact: true }),
          i === 0 ? "starter" : "bench"
        );
        if (game === 0) {
          await selectUiOption(page.getByLabel(`${members[i].name}实际出场`, { exact: true }), {
            label: i === 1 ? "未出场" : "已出场",
          });
          if (i !== 1) {
            await page.getByLabel(`${members[i].name}进球`, { exact: true }).fill(i === 0 ? "2" : "0");
            await page.getByLabel(`${members[i].name}助攻`, { exact: true }).fill(i === 0 ? "0" : "1");
          }
        }
      }
      await page.getByRole("button", { name: "保存名单与出场数据" }).click();
      await expect(page.getByRole("status").filter({ hasText: "名单与实际出场已保存" })).toHaveText(
        "名单与实际出场已保存"
      );
    }
  });
  await test.step("跨年赛季与自然年统计分开，未知不当零", async () => {
    await page.goto("/club/statistics");
    await selectUiOption(page.getByLabel("统计周期", { exact: true }), "season");
    await selectUiOption(page.getByLabel("赛季", { exact: true }), String(season.id));
    const team = page.getByRole("region", { name: "球队汇总", exact: true });
    await expect(team).toContainText("1 胜 · 0 平 · 0 负");
    await expect(team).toContainText("1 / 2 场");
    await expect(team).toContainText("已确认出场 2 人次");
    const table = page.getByRole("region", { name: "球员统计表", exact: true });
    const lin = table.getByRole("row").filter({ hasText: members[0].name });
    await expect(lin.getByRole("cell").nth(4)).toHaveText("2");
    await expect(lin.getByRole("cell").nth(8)).toHaveText("1");
    await expect(table.getByRole("row").filter({ hasText: members[1].name }).getByRole("cell").nth(9)).toHaveText("1");
    await expect(table.getByRole("row").filter({ hasText: members[2].name }).getByRole("cell").nth(10)).toHaveText("1");
    await page.screenshot({ path: `${evidenceDir}/realistic-season-statistics.png`, fullPage: true });
    await selectUiOption(page.getByLabel("统计周期", { exact: true }), "year");
    await page.getByLabel("年份", { exact: true }).fill("2092");
    await page.getByLabel("年份", { exact: true }).blur();
    await expect(team).toContainText("0 / 1 场");
    await expect(team).toContainText("已知进球 未知");
    await expect(lin.getByRole("cell").nth(4)).toHaveText("未知");
    await expect(lin.getByRole("cell").nth(11)).toHaveText("1");
    await page.screenshot({ path: `${evidenceDir}/realistic-annual-unknown.png`, fullPage: true });
  });
  await test.step("档案和模板变化不改历史快照", async () => {
    await page.goto("/club/players");
    await page
      .getByRole("row")
      .filter({ hasText: members[0].name })
      .getByRole("button", { name: "编辑", exact: true })
      .click();
    await page.getByLabel("姓名", { exact: true }).fill("林远改名（虚构）");
    await page.getByLabel("球衣号码", { exact: true }).fill("88");
    await page.getByRole("button", { name: "保存球员" }).click();
    await expect(page.getByRole("row").filter({ hasText: "林远改名（虚构）" })).toBeVisible();
    expect(
      (
        await request.put(`/api/tactics/${tactic.tacticId}`, {
          data: { tactic: { ...tactic, title: "后改模板", board: { ...tactic.board, pieces: [] } } },
        })
      ).ok()
    ).toBe(true);
    await page.goto(matches[0]);
    const historical = page.getByRole("region", { name: "比赛名单表", exact: true });
    await expect(historical).toContainText(members[0].name);
    await expect(historical).not.toContainText("林远改名");
    await expect(historical.getByRole("row").filter({ hasText: members[0].name }).getByRole("cell").nth(1)).toHaveText(
      "9"
    );
    await page.getByText("查看已保存战术：星河赛前阵型").click();
    await expect(page.getByRole("img", { name: "星河赛前阵型已保存战术画布" })).toContainText(members[0].name);
    await page.screenshot({ path: `${evidenceDir}/realistic-historical-match.png`, fullPage: true });
  });
  await test.step("原战术板可导出并解析JSON", async () => {
    await page.goto("/board");
    await expect(page.locator(".roster-item").first()).toBeVisible();
    await page.getByRole("button", { name: "战术库", exact: true }).click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出JSON", exact: true }).click();
    const download = await downloading;
    const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(exported.board).toBeTruthy();
    await writeFile(`${evidenceDir}/realistic-board-export.json`, JSON.stringify(exported, null, 2));
  });
  await test.step("CLI备份及独立临时路径恢复", async () => {
    await page.getByRole("button", { name: "关闭战术库", exact: true }).click();
    await page.getByRole("link", { name: "← 俱乐部" }).click();
    await expect(page).toHaveURL(/\/club$/);
    await expect(page.getByRole("heading", { name: "球队比赛" })).toBeVisible();
    await page.goto("about:blank");
    const evidence = execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./realistic-acceptance-backup.mjs", import.meta.url)), process.env.FOOTBALL_E2E_DB_PATH!],
      { encoding: "utf8" }
    );
    expect(evidence).toContain("restored database verified");
    await writeFile(`${evidenceDir}/realistic-backup-verification.txt`, evidence);
  });
});
