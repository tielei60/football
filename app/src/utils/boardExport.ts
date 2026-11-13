// An exported SVG has no access to the application's stylesheet or theme tokens.
// Capture resolved paint only on the clone, preserving user-authored colors and
// geometry without mutating the live board or its stored historical snapshots.
const EXPORT_PAINT_PROPERTIES = [
  "color",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-opacity",
  "stroke-width",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "opacity",
  "stop-color",
  "stop-opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "paint-order",
  "vector-effect",
  "visibility",
  "display",
  "marker-start",
  "marker-mid",
  "marker-end",
] as const;

function localPaintReferences(value: string, document: Document): string {
  return value.replace(/url\(["']?([^"')]+)["']?\)/g, (original, reference: string) => {
    if (reference.startsWith("#")) return `url(${reference})`;
    try {
      const source = new URL(reference, document.baseURI);
      const page = new URL(document.URL);
      if (source.origin === page.origin && source.pathname === page.pathname && source.search === page.search) {
        return source.hash ? `url(${source.hash})` : original;
      }
    } catch {
      // Leave non-URL paint values untouched. This is not a fetch operation.
    }
    return original;
  });
}

export function inlineBoardPaint(source: SVGElement, clone: SVGElement): void {
  const sourceNodes = [source, ...source.querySelectorAll<SVGElement>("*")];
  const cloneNodes = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  const view = source.ownerDocument.defaultView;
  if (!view) return;
  sourceNodes.forEach((element, index) => {
    const target = cloneNodes[index];
    if (!target?.style) return;
    const computed = view.getComputedStyle(element);
    EXPORT_PAINT_PROPERTIES.forEach((property) => {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, localPaintReferences(value, source.ownerDocument));
    });
  });
}

export function prepareBoardExport(area: SVGGraphicsElement) {
  const bounds = area.getBBox();
  const clone = area.cloneNode(true) as SVGElement;
  inlineBoardPaint(area, clone);
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
