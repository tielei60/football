import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { test, expect } from "./tactical-fixtures";
import { selectUiOption } from "./ui-select";

test("complex eleven-a-side board downloads real PNG bytes without changing saved content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/board");
  await expect(page.locator(".roster-item").first()).toBeVisible();
  await selectUiOption(page.getByRole("combobox", { name: "比赛人数", exact: true }), "11");
  const avatar = `data:image/png;base64,${(await readFile(new URL("../public/team-badge.png", import.meta.url))).toString("base64")}`;
  await page.evaluate(async (image) => {
    const { useDrawStore } = await import("../src/stores/drawStore.ts");
    const { useItemStore } = await import("../src/stores/itemStore.ts");
    const { useRosterStore } = await import("../src/stores/rosterStore.ts");
    const { FieldElement } = await import("../src/types/fieldElement.ts");
    const roster = useRosterStore();
    roster.players = roster.players.map((p, i) => (i < 5 ? { ...p, avatar: image } : p));
    for (let i = 0; i < 11; i += 1) {
      useItemStore().addElement(
        new FieldElement({
          elementType: "player",
          team: "away",
          x: 700 + (i % 3) * 130,
          y: 140 + Math.floor(i / 3) * 140,
          text: `虚构对手${i + 1}`,
          number: i + 1,
          color: "#8845a0",
        })
      );
    }
    useItemStore().addElement(new FieldElement({ elementType: "ball", x: 620, y: 400 }));
    const draw = useDrawStore();
    draw.createDrawing("text", 420, 100, 420, 100, [], "中文复盘 · 左路推进 → 转移");
    draw.drawingConfig.type = "arrow";
    draw.createDrawing("shape", 450, 300, 650, 450, []);
    draw.drawingConfig.type = "rectangle";
    draw.createDrawing("shape", 800, 250, 1100, 580, []);
  }, avatar);
  const imageCount = await page.locator("#board-area image").count();
  expect(imageCount).toBeGreaterThan(1);
  const before = await page.evaluate(async () => {
    const { useTacticsStore } = await import("../src/stores/tacticsStore.ts");
    return useTacticsStore().snapshotBoard();
  });
  const dimensions = await page.locator("#board-area").evaluate((el) => {
    const box = (el as SVGGraphicsElement).getBBox();
    return { width: Math.trunc(box.width * 2), height: Math.trunc(box.height * 2) };
  });
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG", exact: true }).click();
  const download = await waiting;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/_11人制_\d{4}-\d{2}-\d{2}\.png$/);
  expect(download.url()).toMatch(/^blob:/);
  const bytes = await readFile((await download.path())!);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.length).toBeGreaterThan(10000);
  const metadata = await sharp(bytes).metadata();
  expect(metadata.format).toBe("png");
  expect(metadata.width).toBe(dimensions.width);
  expect(metadata.height).toBe(dimensions.height);
  expect((await sharp(bytes).stats()).channels.some((c) => c.stdev > 10)).toBe(true);
  expect(
    await page.evaluate(async () => {
      const { useTacticsStore } = await import("../src/stores/tacticsStore.ts");
      return useTacticsStore().snapshotBoard();
    })
  ).toEqual(before);
  await expect(page.locator('a[download$=".png"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导出 PNG", exact: true })).toBeEnabled();
});

(["context", "empty-blob", "oversize"] as const).forEach((failure) => {
  test(`PNG ${failure} failure shows feedback and releases the export button`, async ({ page }) => {
    await page.goto("/board");
    await expect(page.locator("#field")).toBeVisible();
    await page.evaluate((mode) => {
      if (mode === "oversize") {
        const area = document.querySelector("#board-area") as SVGGraphicsElement;
        area.getBBox = () => ({ x: 0, y: 0, width: 50000, height: 50000 }) as DOMRect;
      } else if (mode === "context")
        HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
      else HTMLCanvasElement.prototype.toBlob = (callback) => callback(null);
    }, failure);
    await page.getByRole("button", { name: "导出 PNG", exact: true }).click();
    const reason = {
      context: "浏览器无法创建图片画布",
      "empty-blob": "PNG 编码失败",
      oversize: "画布尺寸超出 PNG 导出上限",
    }[failure];
    await expect(page.getByRole("alert").filter({ hasText: reason })).toBeVisible();
    await expect(page.getByRole("button", { name: "导出 PNG", exact: true })).toBeEnabled();
  });
});
