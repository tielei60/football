import { test, expect } from "./tactical-fixtures";
test("light historical colors get display-only outlines preserved in SVG export", async ({ page }) => {
  await page.goto("/board");
  await expect(page.locator("#field")).toBeVisible();
  const result = await page.evaluate(async () => {
    // Runtime modules exercise the same code as the rendered workbench.
    const modulePath = "/src/utils/displayContrast.ts";
    const exportPath = "/src/utils/boardExport.ts";
    const { contrastingInk, needsDrawingOutline, protectDrawingContrast, textContrastStyle } = await import(modulePath);
    const { prepareBoardExport } = await import(exportPath);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const area = document.createElementNS(svg.namespaceURI, "g") as SVGGElement;
    const path = document.createElementNS(svg.namespaceURI, "path") as SVGPathElement;
    path.setAttribute("d", "M10 10L100 100");
    path.setAttribute("stroke", "#ffffff");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("fill", "none");
    const saved = path.outerHTML;
    area.append(protectDrawingContrast(path, "#ffffff"));
    svg.append(area);
    document.body.append(svg);
    const exported = prepareBoardExport(area).content;
    const result = {
      away: contrastingInk("var(--pitch-player-away)"),
      home: contrastingInk("var(--pitch-player-home)"),
      white: needsDrawingOutline("#ffffff"),
      dark: needsDrawingOutline("#111111"),
      text: textContrastStyle("#ffffff"),
      unchanged: saved === path.outerHTML,
      outline: exported.querySelector("[aria-hidden]")?.getAttribute("stroke"),
      width: exported.querySelector("[aria-hidden]")?.getAttribute("stroke-width"),
      foreground: exported.querySelector("[data-display-contrast] > path:last-child")?.getAttribute("stroke"),
    };
    svg.remove();
    return result;
  });
  expect(result.away).toBe("#000000");
  expect(result.home).toBe("#ffffff");
  expect(result.white).toBe(true);
  expect(result.dark).toBe(false);
  expect(result.text.paintOrder).toBe("stroke fill");
  expect(result.unchanged).toBe(true);
  expect(result.outline).toMatch(/^(#000000|rgb\(0, 0, 0\))$/);
  expect(result.width).toMatch(/^4(px)?$/);
  expect(result.foreground).toMatch(/^(#ffffff|rgb\(255, 255, 255\))$/);
});
