import { test, expect } from "./fixtures";

test("standalone board export freezes theme paint without changing user colors or source data", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#board-area")).toBeVisible();
  const result = await page.evaluate(async () => {
    const modulePath = "/src/utils/boardExport.ts";
    const { prepareBoardExport } = await import(/* @vite-ignore */ modulePath);
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("width", "120");
    svg.setAttribute("height", "80");
    const group = document.createElementNS(ns, "g");
    group.innerHTML =
      '<defs><linearGradient id="export-test-gradient"><stop offset="0" stop-color="var(--color-brand)"/><stop offset="1" stop-color="var(--color-info)"/></linearGradient></defs>' +
      '<rect width="120" height="80" fill="var(--pitch-bg)"/>' +
      '<circle cx="35" cy="40" r="15" fill="#ab1234" stroke="#213456" stroke-width="2"/>' +
      '<rect x="70" y="20" width="30" height="40" fill="url(#export-test-gradient)"/>';
    svg.appendChild(group);
    document.body.appendChild(svg);
    const root = document.documentElement;
    const previous = root.style.getPropertyValue("--pitch-bg");
    root.style.setProperty("--pitch-bg", "#d8c7e2");
    try {
      const sourceBefore = group.outerHTML;
      const { content } = prepareBoardExport(group);
      const background = content.querySelector("rect");
      const player = content.querySelector("circle");
      const gradient = content.querySelector("stop");
      // A later theme edit must not affect this already-created export.
      root.style.setProperty("--pitch-bg", "#f8fafc");
      const standalone = document.createElementNS(ns, "svg");
      standalone.setAttribute("width", "120");
      standalone.setAttribute("height", "80");
      standalone.setAttribute("viewBox", "0 0 120 80");
      standalone.appendChild(content);
      const image = new Image();
      image.src = `data:image/svg+xml;base64,${btoa(new XMLSerializer().serializeToString(standalone))}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 120;
      canvas.height = 80;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      return {
        background: background.style.fill,
        player: player.style.fill,
        stroke: player.style.stroke,
        gradient: gradient.style.stopColor,
        localGradient: content.querySelectorAll("rect")[1].style.fill,
        sourceUnchanged: group.outerHTML === sourceBefore,
        backgroundPixel: [...ctx.getImageData(5, 5, 1, 1).data],
        playerPixel: [...ctx.getImageData(35, 40, 1, 1).data],
      };
    } finally {
      if (previous) root.style.setProperty("--pitch-bg", previous);
      else root.style.removeProperty("--pitch-bg");
      svg.remove();
    }
  });
  expect(result.background).toBe("rgb(216, 199, 226)");
  expect(result.player).toBe("rgb(171, 18, 52)");
  expect(result.stroke).toBe("rgb(33, 52, 86)");
  expect(result.gradient).not.toContain("var(");
  expect(result.localGradient).toMatch(/^url\(["']?#export-test-gradient["']?\)$/);
  expect(result.sourceUnchanged).toBe(true);
  expect(result.backgroundPixel).toEqual([216, 199, 226, 255]);
  expect(result.playerPixel).toEqual([171, 18, 52, 255]);
});

test("real pitch export retains resolved theme lines and valid bounds", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#board-area")).toBeVisible();
  const result = await page.evaluate(async () => {
    const modulePath = "/src/utils/boardExport.ts";
    const { prepareBoardExport } = await import(/* @vite-ignore */ modulePath);
    const area = document.getElementById("board-area") as unknown as SVGGraphicsElement;
    const sourceBefore = area.outerHTML;
    const { content, bounds } = prepareBoardExport(area);
    const shapes = [...content.querySelectorAll("path,rect,line,circle,stop")];
    return {
      sourceUnchanged: area.outerHTML === sourceBefore,
      finiteBounds: [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite),
      positiveBounds: bounds.width > 0 && bounds.height > 0,
      paints: shapes.map((shape) => (shape as SVGElement).style.fill),
      strokes: shapes.map((shape) => (shape as SVGElement).style.stroke),
    };
  });
  expect(result.sourceUnchanged).toBe(true);
  expect(result.finiteBounds).toBe(true);
  expect(result.positiveBounds).toBe(true);
  expect(result.paints.length).toBeGreaterThan(5);
  expect(result.paints.every((paint) => paint && !paint.includes("var("))).toBe(true);
  expect(result.strokes.every((paint) => paint && !paint.includes("var("))).toBe(true);
});
