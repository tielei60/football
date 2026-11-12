import { mkdir, readFile } from "node:fs/promises";
import { test, expect } from "./fixtures";

test("print media uses current club identity but archived player details, with explicit unknown numbers", async ({
  page,
  request,
}) => {
  // We verify DOM and print CSS only; this intentionally does not open or claim a real print dialog.
  await page.addInitScript(() => {
    window.print = () => {};
  });
  const team = await (await request.get("/api/team")).json();
  const crest = `data:image/png;base64,${(await readFile(new URL("../public/team-badge.png", import.meta.url))).toString("base64")}`;
  expect(
    (await request.put("/api/team", { data: { revision: team.revision, name: "星河打印队（虚构）", crest } })).ok()
  ).toBe(true);
  const player = await (
    await request.post("/api/players", { data: { name: "存档球员", positions: ["中后卫"] } })
  ).json();
  const created = await request.post("/api/tactics", {
    data: {
      tactic: {
        title: "打印存档核对",
        tags: [],
        favorite: false,
        formationName: null,
        thumbnail: null,
        board: {
          playerCount: 7,
          markings: [],
          pieces: [
            {
              pieceId: "archived",
              kind: "player",
              playerId: player.id,
              x: 300,
              y: 400,
              label: "存档球员",
              position: "DF",
              team: "home",
              color: "#2465a8",
            },
            {
              pieceId: "known-zero",
              kind: "player",
              x: 700,
              y: 300,
              label: "对手零号",
              shirtNumber: 0,
              position: "GK",
              team: "away",
            },
            { pieceId: "unknown-away", kind: "player", x: 700, y: 500, label: "对手未知", team: "away" },
          ],
        },
      },
    },
  });
  expect(created.ok(), `Tactic fixture rejected: ${await created.text()}`).toBe(true);
  expect(
    (
      await request.put(`/api/players/${player.id}`, {
        data: { revision: player.revision, name: "后改姓名", number: 88, positions: ["门将"], avatar: crest },
      })
    ).ok()
  ).toBe(true);
  await page.goto("/board");
  await expect(page.locator(".roster-item").filter({ hasText: "后改姓名" })).toBeVisible();
  await page.getByRole("button", { name: "战术库", exact: true }).click();
  await page
    .locator(".tactic-item")
    .filter({ hasText: "打印存档核对" })
    .getByRole("button", { name: "打印战术" })
    .click();
  const sheet = page.locator(".print-sheet");
  await expect(sheet).toContainText("星河打印队（虚构） · 打印存档核对");
  await expect(sheet).not.toContainText("柏林花园");
  await expect(sheet).not.toContainText("后改姓名");
  await expect(sheet.locator(".ps-badge")).toHaveAttribute("src", crest);
  await expect(sheet.locator(".ps-team").first()).toContainText("号码未知 存档球员（后卫）");
  await expect(sheet.locator(".ps-team").nth(1)).toContainText("0号");
  await expect(sheet.locator(".ps-team").nth(1)).toContainText("号码未知");
  await expect(sheet).not.toContainText("null号");
  await expect(sheet.locator(".ps-pitch image")).toHaveCount(0);
  await expect(sheet.locator(".ps-num").first()).toHaveText("—");
  await page.emulateMedia({ media: "print" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCSS("display", "block");
  await mkdir("test-results/visual-review", { recursive: true });
  await sheet.screenshot({ path: "test-results/visual-review/print-current-club-archived-players.png" });
});
