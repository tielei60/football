export function prepareBoardExport(area: SVGGraphicsElement) {
  const bounds = area.getBBox();
  const clone = area.cloneNode(true) as SVGElement;
  if (area.closest("#pitch-coordinate-space")?.getAttribute("data-portrait") !== "true") {
    return { content: clone, bounds };
  }
  const content = document.createElementNS("http://www.w3.org/2000/svg", "g");
  content.setAttribute("transform", "translate(0 1250) rotate(-90)");
  content.appendChild(clone);
  return {
    content,
    bounds: { x: bounds.y, y: 1250 - bounds.x - bounds.width, width: bounds.height, height: bounds.width },
  };
}
