import { readFile } from "node:fs/promises";
import { test, expect } from "./tactical-fixtures";

test.use({ hasTouch: true });

test("portrait pitch keeps labels upright, touch dragging aligned and exported images vertical", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/board");
  await expect(page.locator("#field")).toHaveAttribute("viewBox", "0 0 826 1250");
  const area = (await page.locator("#board-area").boundingBox())!;
  expect(area.height).toBeGreaterThan(area.width);
  const orientation = await page
    .locator("#players .player-name")
    .first()
    .evaluate((node) => {
      const matrix = (node as SVGGraphicsElement).getScreenCTM()!;
      return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d };
    });
  expect(orientation.a).toBeGreaterThan(0);
  expect(orientation.d).toBeGreaterThan(0);
  expect(Math.abs(orientation.b) + Math.abs(orientation.c)).toBeLessThan(0.001);
  const id = await page.locator("#players > g").nth(3).getAttribute("id");
  const circle = page.locator(`[id="${id}"] > g > g > circle`).first();
  const client = await page.context().newCDPSession(page);
  const drag = async () => {
    const box = (await circle.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const end = { x: start.x + 24, y: start.y - 28 };
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
    for (let step = 1; step <= 6; step++) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * step) / 6,
            y: start.y + ((end.y - start.y) * step) / 6,
          },
        ],
      });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const after = (await circle.boundingBox())!;
    expect(Math.abs(after.x + after.width / 2 - end.x)).toBeLessThan(4);
    expect(Math.abs(after.y + after.height / 2 - end.y)).toBeLessThan(4);
  };
  await drag();
  await page.getByRole("button", { name: "放大", exact: true }).tap();
  await drag();
  await page.getByRole("button", { name: "适应全场", exact: true }).tap();
  const positions = await circle.evaluate((node) => [node.getAttribute("cx"), node.getAttribute("cy")]);
  await page.screenshot({ path: "test-results/vertical-pitch-phone.png" });
  await page.getByRole("button", { name: "绘图", exact: true }).tap();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PNG", exact: true }).tap();
  const download = await downloadPromise;
  await download.saveAs("test-results/portrait-export.png");
  const png = await readFile("test-results/portrait-export.png");
  expect(png.readUInt32BE(20)).toBeGreaterThan(png.readUInt32BE(16));
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator("#field")).toHaveAttribute("viewBox", "0 0 1250 826");
  expect(await circle.evaluate((node) => [node.getAttribute("cx"), node.getAttribute("cy")])).toEqual(positions);
});
