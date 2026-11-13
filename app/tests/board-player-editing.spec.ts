import type { Page } from "@playwright/test";
import { selectUiOption } from "./ui-select";
import { test, expect } from "./tactical-fixtures";

async function openRoster(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  const row = page.locator(".roster-item").first();
  await row.locator(".player-detail-trigger").click();
  return row;
}
async function rosterState(page: Page) {
  return page.evaluate(async () => {
    const { useRosterStore } = await import("../src/stores/rosterStore.ts");
    const { useHistoryStore } = await import("../src/stores/historyStore.ts");
    const player = useRosterStore().players[0];
    return { name: player.name, number: player.number, history: useHistoryStore().undoStack.length };
  });
}

test("invalid roster edits stay local with errors, then corrected values save", async ({ page }) => {
  const row = await openRoster(page);
  const name = row.locator('.detail-fields input[type="text"]').first();
  const number = row.locator('.detail-fields input[type="number"]');
  const before = await rosterState(page);
  await name.fill("   ");
  await name.press("Tab");
  await expect(row.getByRole("alert")).toContainText("请输入 1–200 字的姓名");
  expect(await rosterState(page)).toEqual(before);
  await number.fill("-1");
  await number.press("Tab");
  await expect(number).toHaveValue("-1");
  await expect(number).toHaveAttribute("aria-invalid", "true");
  expect(await rosterState(page)).toEqual(before);
  await number.fill("31");
  await number.press("Tab");
  await expect(number).toHaveAttribute("aria-invalid", "false");
  expect((await rosterState(page)).number).toBe(31);
  const longName = "青".repeat(200);
  await name.fill(longName);
  await name.press("Tab");
  expect((await rosterState(page)).name).toBe(longName);
  await expect(row.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const { useCoachingDeskStore } = await import("../src/stores/coachingDeskStore.ts");
        await useCoachingDeskStore().flush();
        return true;
      })
    )
    .toBe(true);
  await page.reload();
  await expect(page.locator(".roster-item").first()).toBeVisible();
  expect((await rosterState(page)).name).toBe(longName);
  expect((await rosterState(page)).number).toBe(31);
});

([null, 0, 999, 9999] as const).forEach((value) => {
  test(`roster number ${value === null ? "unknown" : value} survives persistence`, async ({ page }) => {
    const row = await openRoster(page);
    const number = row.locator('.detail-fields input[type="number"]');
    await number.fill(value === null ? "" : String(value));
    await number.press("Tab");
    expect((await rosterState(page)).number).toBe(value);
    await page.evaluate(async () => {
      const { useCoachingDeskStore } = await import("../src/stores/coachingDeskStore.ts");
      await useCoachingDeskStore().flush();
    });
    await page.reload();
    await expect(page.locator(".roster-item").first()).toBeVisible();
    expect((await rosterState(page)).number).toBe(value);
  });
});

async function openFreePiece(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.evaluate(async () => {
    const { useItemStore } = await import("../src/stores/itemStore.ts");
    const { FieldElement } = await import("../src/types/fieldElement.ts");
    useItemStore().addElement(new FieldElement({ id: "edit-free-piece", x: 850, y: 350, text: "独立棋子", number: 0 }));
  });
  const piece = page.locator("#item-edit-free-piece");
  await piece.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(piece.getByText("仅修改当前战术棋子，不修改球员档案。名称可留空。", { exact: true })).toBeVisible();
  return piece;
}
async function pieceState(page: Page) {
  return page.evaluate(async () => {
    const { useItemStore } = await import("../src/stores/itemStore.ts");
    const { useHistoryStore } = await import("../src/stores/historyStore.ts");
    const p = useItemStore().items.findById("edit-free-piece")!;
    return { name: p.text, number: p.number, history: useHistoryStore().undoStack.length };
  });
}

test("keyboard piece edits validate numeric data, undo actual changes and leave roster alone", async ({ page }) => {
  const piece = await openFreePiece(page);
  const rosterBefore = await page.evaluate(async () => {
    const { useRosterStore } = await import("../src/stores/rosterStore.ts");
    return JSON.stringify(useRosterStore().players);
  });
  const before = await pieceState(page);
  const number = piece.getByRole("spinbutton", { name: "棋子号码" });
  await number.fill("1.5");
  await number.press("Tab");
  await expect(piece.getByRole("alert")).toContainText("0–9999");
  expect(await pieceState(page)).toEqual(before);
  await number.fill("9999");
  await number.press("Tab");
  expect((await pieceState(page)).number).toBe(9999);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await pieceState(page)).number).toBe(0);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect((await pieceState(page)).number).toBe(9999);
  await piece.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await number.fill("");
  await number.press("Tab");
  expect((await pieceState(page)).number).toBeUndefined();
  const name = piece.getByRole("textbox", { name: "棋子名称" });
  await name.fill(" ");
  await name.press("Tab");
  expect((await pieceState(page)).name).toBe("");
  const longName = "完整名称保留但画布只展示摘要的自由球员";
  await name.fill(longName);
  await name.press("Tab");
  await expect(piece.locator("title")).toContainText(longName);
  await expect(piece.locator(".player-name")).toHaveText("完整名称保留但画…");
  expect(
    await page.evaluate(async () => {
      const { useRosterStore } = await import("../src/stores/rosterStore.ts");
      return JSON.stringify(useRosterStore().players);
    })
  ).toBe(rosterBefore);
  await page.evaluate(async () => {
    const { useCoachingDeskStore } = await import("../src/stores/coachingDeskStore.ts");
    await useCoachingDeskStore().flush();
  });
  await page.reload();
  await expect(page.locator(".roster-item").first()).toBeVisible();
  expect((await pieceState(page)).name).toBe(longName);
  expect((await pieceState(page)).number).toBeUndefined();
});

test("linked piece edits stay tactical and playback blocks profile editing", async ({ page }) => {
  const row = await openRoster(page);
  const original = await page.evaluate(async () => {
    const { useRosterStore } = await import("../src/stores/rosterStore.ts");
    const player = useRosterStore().players.find((p) => p.fieldId !== null)!;
    return { id: player.id, fieldId: player.fieldId, name: player.name, number: player.number };
  });
  const piece = page.locator(`[id="item-${original.fieldId}"]`);
  await piece.getByRole("button").focus();
  await page.keyboard.press("Enter");
  const name = piece.getByRole("textbox", { name: "棋子名称" });
  await name.fill("仅本战术位置代号");
  await name.press("Tab");
  expect(
    await page.evaluate(async (id) => {
      const { useRosterStore } = await import("../src/stores/rosterStore.ts");
      return useRosterStore().players.find((p) => p.id === id)!.name;
    }, original.id)
  ).toBe(original.name);
  await page.getByRole("button", { name: "制作动画", exact: true }).click();
  await page.getByRole("button", { name: "添加帧", exact: true }).click();
  await page.getByRole("checkbox", { name: "循环播放", exact: true }).check();
  await page.getByRole("button", { name: "播放动画", exact: true }).click();
  await expect(row.locator('.detail-fields input[type="number"]')).toBeDisabled();
  await expect(row.locator('.detail-fields input[type="text"]').first()).toBeDisabled();
  await expect(page.getByText("动画播放中，暂停后可编辑队员资料。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "暂停动画", exact: true }).click();
  await expect(row.locator('.detail-fields input[type="number"]')).toBeEnabled();
});

test("adding after number 9999 uses unknown and rapid additions have independent stable IDs", async ({ page }) => {
  const row = await openRoster(page);
  const number = row.locator('.detail-fields input[type="number"]');
  await number.fill("9999");
  await number.press("Tab");
  await page.getByRole("textbox", { name: "新队员姓名", exact: true }).fill("满号后新增队员");
  await page.getByRole("button", { name: "新增队员", exact: true }).click();
  const ids = await page.evaluate(async () => {
    const { useRosterStore } = await import("../src/stores/rosterStore.ts");
    const roster = useRosterStore();
    const added = roster.players.find((p) => p.name === "满号后新增队员")!;
    const realNow = Date.now;
    try {
      Date.now = () => 123456789;
      const first = roster.addPlayer("同毫秒新增甲");
      const second = roster.addPlayer("同毫秒新增乙");
      return { added: added.id, number: added.number, first, second };
    } finally {
      Date.now = realNow;
    }
  });
  expect(ids.number).toBeNull();
  expect(ids.first).not.toBe(ids.second);
  expect(ids.first).toMatch(/^bg-/);
  expect(ids.second).toMatch(/^bg-/);
  await page.evaluate(async () => {
    const { useCoachingDeskStore } = await import("../src/stores/coachingDeskStore.ts");
    await useCoachingDeskStore().flush();
  });
  await page.reload();
  await expect(page.locator(".roster-item").first()).toBeVisible();
  const saved = await page.evaluate(async (expected) => {
    const { useRosterStore } = await import("../src/stores/rosterStore.ts");
    return useRosterStore()
      .players.filter((p) => [expected.added, expected.first, expected.second].includes(p.id))
      .map((p) => ({ id: p.id, number: p.number }));
  }, ids);
  expect(saved).toHaveLength(3);
  expect(new Set(saved.map((p) => p.id)).size).toBe(3);
  expect(saved.every((p) => p.number === null)).toBe(true);
});

test("free piece name can be cleared and reloads as an unnamed numbered marker", async ({ page }) => {
  const piece = await openFreePiece(page);
  const name = piece.getByRole("textbox", { name: "棋子名称" });
  await name.fill("   ");
  await name.press("Tab");
  expect((await pieceState(page)).name).toBe("");
  expect((await pieceState(page)).number).toBe(0);
  await expect(piece.getByRole("alert")).toHaveCount(0);
  await page.evaluate(async () => {
    const { useCoachingDeskStore } = await import("../src/stores/coachingDeskStore.ts");
    await useCoachingDeskStore().flush();
  });
  await page.reload();
  await expect(page.locator("#item-edit-free-piece")).toBeVisible();
  expect((await pieceState(page)).name).toBe("");
  expect((await pieceState(page)).number).toBe(0);
  await page.locator("#item-edit-free-piece").getByRole("button").focus();
  await page.keyboard.press("Enter");
  await name.focus();
  await name.press("Tab");
  await expect(piece.getByRole("alert")).toHaveCount(0);
});

test("football marker opens and deletes by keyboard and undo restores it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  await page.evaluate(async () => {
    const { useItemStore } = await import("../src/stores/itemStore.ts");
    const { FieldElement } = await import("../src/types/fieldElement.ts");
    useItemStore().addElement(new FieldElement({ id: "keyboard-ball", elementType: "ball", x: 850, y: 350 }));
  });
  const ball = page.locator("#item-keyboard-ball");
  await ball.getByRole("button", { name: "足球，打开棋子详情", exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(ball.getByRole("button", { name: "删除", exact: true })).toBeVisible();
  await ball.getByRole("button", { name: "删除", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(ball).toHaveCount(0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(ball).toBeVisible();
  await expect(ball.getByRole("button", { name: "足球，打开棋子详情", exact: true })).toHaveAttribute("tabindex", "0");
});

test("linked player keeps profile positions when its tactical role changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  await expect(page.locator(".roster-item").first()).toBeVisible();
  const profile = await page.evaluate(async () => {
    const { useRosterStore } = await import("../src/stores/rosterStore.ts");
    const player = useRosterStore().players.find((p) => p.name === "虚构战术队员01")!;
    return { id: player.id, fieldId: player.fieldId, positions: [...player.positions] };
  });
  const piece = page.locator(`[id="item-${profile.fieldId}"]`);
  await expect(piece.locator(".player-position")).toHaveText("中后卫、后腰");
  await piece.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await selectUiOption(piece.getByRole("combobox", { name: "战术职责", exact: true }), { label: "前锋" });
  await expect(piece.locator(".player-position")).toHaveText("中后卫、后腰");
  await expect(piece.locator("title")).toContainText("档案位置：中后卫、后腰");
  await expect(piece.locator("title")).toContainText("战术职责：前锋");
  expect(
    await page.evaluate(async (id) => {
      const { useRosterStore } = await import("../src/stores/rosterStore.ts");
      return useRosterStore().players.find((p) => p.id === id)!.positions;
    }, profile.id)
  ).toEqual(profile.positions);
  await page.evaluate(async () => {
    const { useCoachingDeskStore } = await import("../src/stores/coachingDeskStore.ts");
    await useCoachingDeskStore().flush();
  });
  await page.reload();
  await expect(piece.locator(".player-position")).toHaveText("中后卫、后腰");
  await expect(piece.locator("title")).toContainText("战术职责：前锋");
});
