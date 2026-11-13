// Display-only contrast helpers. Never rewrite historical colors or board data.
function resolveColor(color: string): string {
  return color.replace(/var\((--[\w-]+)\)/g, (_, token) =>
    getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  );
}
const luminanceCache = new Map<string, number>();
function luminance(color: string): number {
  const resolved = resolveColor(color);
  const cached = luminanceCache.get(resolved);
  if (cached !== undefined) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
  const channels = [r, g, b].map((c) => {
    const value = (c * (alpha / 255) + 255 - alpha) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const value = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  if (luminanceCache.size > 256) luminanceCache.clear();
  luminanceCache.set(resolved, value);
  return value;
}
export function contrastingInk(color: string): string {
  return luminance(color) > 0.179 ? "#000000" : "#ffffff";
}
export function needsDrawingOutline(color: string): boolean {
  if (!color || color === "transparent" || color === "none") return false;
  const ink = luminance(color);
  return ["--pitch-bg", "--pitch-stripe"].some((token) => {
    const background = luminance(`var(${token})`);
    return (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05) < 3;
  });
}
export function textContrastStyle(color = ""): Record<string, string> {
  return needsDrawingOutline(color)
    ? { stroke: contrastingInk(color), strokeWidth: "2px", paintOrder: "stroke fill", strokeLinejoin: "round" }
    : {};
}
export function protectDrawingContrast(shape: SVGElement, color: string): SVGElement {
  if (!needsDrawingOutline(color)) return shape;
  // A separate wider outline retains the original foreground stroke/fill exactly.
  // Ordinary SVG attributes survive standalone SVG/PNG and print export.
  const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.setAttribute("data-display-contrast", "true");
  const outline = shape.cloneNode(true) as SVGElement;
  outline.setAttribute("aria-hidden", "true");
  for (const node of [
    outline,
    ...outline.querySelectorAll<SVGElement>("path,line,rect,ellipse,text,polyline,polygon"),
  ]) {
    if (node.tagName.toLowerCase() === "g") continue;
    node.setAttribute("stroke", contrastingInk(color));
    node.setAttribute("stroke-width", String((Number(node.getAttribute("stroke-width")) || 1) + 2));
    node.setAttribute("stroke-linejoin", "round");
    node.setAttribute("paint-order", "stroke fill");
  }
  group.append(outline, shape);
  return group;
}
