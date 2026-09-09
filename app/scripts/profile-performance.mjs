import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createFootballServer } from "../../server/index.mjs";

// A disposable in-memory database keeps profiling away from the user's roster.
const server = createFootballServer({ databasePath: ":memory:" });
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
const output = fileURLToPath(new URL("../test-results/performance/", import.meta.url));
await mkdir(output, { recursive: true });
let browser;
const results = [];
try {
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  for (const [name, width, height, cpu] of [
    ["desktop", 1440, 960, 1],
    ["tablet", 768, 1024, 4],
    ["phone", 390, 844, 4],
  ]) {
    const { edition } = await (await fetch(origin + "/api/coaching-desk")).json();
    await fetch(origin + "/api/coaching-desk", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desk: null, edition }),
    });
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: cpu > 1,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const client = await context.newCDPSession(page);
    await client.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await client.send("Performance.enable");
    const started = performance.now();
    await page.goto(origin + "/board");
    await page.locator("#players > g").first().waitFor();
    const readyMs = Math.round(performance.now() - started);
    await page.getByRole("combobox", { name: "比赛人数", exact: true }).selectOption("11");
    if (cpu > 1) await page.getByRole("button", { name: "更多设置", exact: true }).click();
    await page.getByRole("combobox", { name: "对手阵型", exact: true }).selectOption({ index: 1 });
    if (cpu > 1) await page.getByRole("button", { name: "更多设置", exact: true }).click();
    await page.getByRole("button", { name: cpu > 1 ? "动画" : "制作动画", exact: true }).click();
    await page.getByRole("button", { name: "添加帧", exact: true }).click();
    if (cpu > 1) await page.getByRole("button", { name: "收起操作面板", exact: true }).click();
    const ids = await page.locator("#players > g").evaluateAll((groups) => groups.map((group) => group.id));
    assert.equal(ids.length, 22, `${name}: profile a complete 11 versus 11 lineup`);
    // Move every player in the new frame so the rendering load is representative.
    for (const id of ids) {
      const box = await page.locator(`[id="${id}"] > g > g > circle`).first().boundingBox();
      if (!box) continue;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 20, y - 20, { steps: 3 });
      await page.mouse.up();
    }
    if (cpu > 1) await page.getByRole("button", { name: "动画", exact: true }).click();
    await page.getByRole("spinbutton", { name: "当前帧", exact: true }).fill("1");
    await page.getByRole("spinbutton", { name: "当前帧", exact: true }).press("Tab");
    await page.getByRole("checkbox", { name: "循环播放", exact: true }).check();
    await page.getByRole("button", { name: "播放动画", exact: true }).click();
    if (cpu > 1) await page.getByRole("button", { name: "收起操作面板", exact: true }).click();
    const beforeMetrics = await client.send("Performance.getMetrics");
    const timing = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const intervals = [];
          const initial = document.querySelector("#players")?.innerHTML;
          let changed = false;
          const observer = new MutationObserver(() => {
            changed = true;
          });
          observer.observe(document.querySelector("#players"), { subtree: true, attributes: true });
          let previous = performance.now();
          const start = previous;
          const tick = (now) => {
            intervals.push(now - previous);
            previous = now;
            if (now - start < 1500) {
              requestAnimationFrame(tick);
              return;
            }
            observer.disconnect();
            const samples = intervals.slice(1).sort((a, b) => a - b);
            resolve({
              frames: samples.length,
              p95Ms: Math.round(samples[Math.floor(samples.length * 0.95)]),
              maxMs: Math.round(Math.max(...samples)),
              moving: changed && initial !== document.querySelector("#players")?.innerHTML,
            });
          };
          requestAnimationFrame(tick);
        })
    );
    const afterMetrics = await client.send("Performance.getMetrics");
    const durations = Object.fromEntries(
      ["ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration"].map((key) => [
        key,
        Math.round(
          1000 *
            (afterMetrics.metrics.find((metric) => metric.name === key).value -
              beforeMetrics.metrics.find((metric) => metric.name === key).value)
        ),
      ])
    );
    assert.equal(timing.moving, true, `${name}: animation must actually move`);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${name}.png` });
    const result = { device: name, viewport: `${width}x${height}`, cpuSlowdown: cpu, readyMs, ...timing, durations };
    results.push(result);
    console.log(JSON.stringify(result));
    await context.close();
  }
  await writeFile(`${output}/metrics.json`, JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
