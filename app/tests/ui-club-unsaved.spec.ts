import { test, expect } from "./fixtures";
import { selectUiOption } from "./ui-select";

test("club match dirty sections preserve drafts when cancelling navigation and discard only after confirmation", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/matches", {
    data: { opponent: "浅紫导航验收（虚构）", date: "2027-02-10", location: "原球场", status: "published" },
  });
  expect(response.ok()).toBe(true);
  const match = await response.json();
  await page.goto(`/club/matches/${match.id}`);
  await page.getByLabel("地点", { exact: true }).fill("尚未保存的球场");
  await expect(page.getByText("信息有未保存修改", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "球员", exact: true }).click();
  const leave = page.getByRole("dialog", { name: "离开未保存的比赛？" });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(leave).not.toBeVisible();
  await expect(page.getByLabel("地点", { exact: true })).toHaveValue("尚未保存的球场");
  await page.getByRole("button", { name: "撤销信息修改", exact: true }).click();
  const reset = page.getByRole("dialog", { name: "撤销信息修改" });
  await reset.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(page.getByLabel("地点", { exact: true })).toHaveValue("原球场");
  await expect(page.getByText("信息有未保存修改", { exact: true })).not.toBeVisible();
  await page.getByLabel("地点", { exact: true }).fill("放弃的球场");
  await page.getByRole("link", { name: "球员", exact: true }).click();
  await leave.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
  await expect(page).toHaveURL(/\/club\/players$/);
  expect((await (await request.get(`/api/matches/${match.id}`)).json()).location).toBe("原球场");
});

test("resetting match information does not erase the independent unsaved roster", async ({ page, request }) => {
  const playerResponse = await request.post("/api/players", {
    data: { name: "名单独立保存验收（虚构）", positions: ["中场"] },
  });
  expect(playerResponse.ok()).toBe(true);
  const player = await playerResponse.json();
  const response = await request.post("/api/matches", {
    data: { opponent: "名单撤销验收（虚构）", date: "2027-02-11", location: "原球场" },
  });
  const match = await response.json();
  await page.goto(`/club/matches/${match.id}`);
  await selectUiOption(page.getByLabel("添加至名单", { exact: true }), player.id);
  await page.getByRole("button", { name: "添加球员", exact: true }).click();
  await page.getByLabel("地点", { exact: true }).fill("信息草稿");
  await page.getByRole("button", { name: "撤销信息修改", exact: true }).click();
  await page
    .getByRole("dialog", { name: "撤销信息修改" })
    .getByRole("button", { name: "撤销修改", exact: true })
    .click();
  await expect(page.getByLabel(`${player.name}比赛位置`)).toBeVisible();
  await expect(page.getByText("名单有未保存修改，请独立保存名单与出场数据。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "保存名单与出场数据", exact: true }).click();
  await expect(page.getByText("名单与实际出场已保存", { exact: true })).toBeVisible();
  await expect(page.getByText("名单有未保存修改，请独立保存名单与出场数据。", { exact: true })).not.toBeVisible();
  const saved = await (await request.get(`/api/matches/${match.id}`)).json();
  expect(saved.roster).toHaveLength(1);
  expect(saved.roster[0].appeared).toBeNull();
  expect(saved.location).toBe("原球场");
});

test("match section anchors preserve both drafts and switching matches confirms before reloading", async ({
  page,
  request,
}) => {
  const playerResponse = await request.post("/api/players", {
    data: { name: "锚点草稿球员（虚构）", positions: ["中场"] },
  });
  expect(playerResponse.ok()).toBe(true);
  const player = await playerResponse.json();
  const matches = [];
  for (const [opponent, location] of [
    ["锚点验收甲（虚构）", "甲球场"],
    ["锚点验收乙（虚构）", "乙球场"],
  ]) {
    const response = await request.post("/api/matches", {
      data: { opponent, location, date: "2027-02-12", status: "published" },
    });
    expect(response.ok()).toBe(true);
    matches.push(await response.json());
  }
  await page.goto(`/club/matches/${matches[0].id}`);
  await page.getByLabel("地点", { exact: true }).fill("锚点信息草稿");
  await selectUiOption(page.getByLabel("添加至名单", { exact: true }), player.id);
  await page.getByRole("button", { name: "添加球员", exact: true }).click();
  await page.getByLabel(`${player.name}比赛位置`).fill("左中场草稿");
  for (const [label, hash] of [
    ["信息与分析", "match-information"],
    ["报名情况", "match-registration"],
    ["名单与出场", "match-roster"],
    ["战术快照", "match-tactics"],
  ]) {
    await page.getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#${hash}$`));
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByLabel("地点", { exact: true })).toHaveValue("锚点信息草稿");
    await expect(page.getByLabel(`${player.name}比赛位置`)).toHaveValue("左中场草稿");
  }
  // Exercise Vue Router's same-record parameter transition, not a full document load.
  const switchMatch = () =>
    page.evaluate((path) => {
      const app = document.querySelector("#app") as Element & {
        __vue_app__: { config: { globalProperties: { $router: { push(path: string): Promise<unknown> } } } };
      };
      void app.__vue_app__.config.globalProperties.$router.push(path);
    }, `/club/matches/${matches[1].id}`);
  await switchMatch();
  const dialog = page.getByRole("dialog", { name: "离开未保存的比赛？" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page.getByLabel("地点", { exact: true })).toHaveValue("锚点信息草稿");
  await expect(page.getByLabel(`${player.name}比赛位置`)).toHaveValue("左中场草稿");
  await switchMatch();
  await dialog.getByRole("button", { name: "放弃修改并离开", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/club/matches/${matches[1].id}$`));
  await expect(page.getByLabel("地点", { exact: true })).toHaveValue("乙球场");
  await expect(page.getByLabel(`${player.name}比赛位置`)).toHaveCount(0);
  const saved = await (await request.get(`/api/matches/${matches[0].id}`)).json();
  expect(saved.location).toBe("甲球场");
  expect(saved.roster).toHaveLength(0);
});
