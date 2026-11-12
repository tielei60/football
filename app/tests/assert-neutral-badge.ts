import { readFile } from "node:fs/promises";
import { expect, type Locator } from "@playwright/test";

// Vite may inline this SVG. Verify the actual image, not an implementation-specific asset filename.
export async function assertNeutralBadge(image: Locator) {
  const expected = await readFile(new URL("../src/assets/default-club-badge.svg", import.meta.url), "utf8");
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
      })
    )
    .toBe(true);
  const result = await image.evaluate(async (element, expectedSvg) => {
    const img = element as HTMLImageElement;
    const source = img.currentSrc || img.src;
    const url = new URL(source, window.location.href);
    const allowedSource =
      source.startsWith("data:image/svg+xml") ||
      (url.origin === window.location.origin && url.pathname.includes("default-club-badge"));
    const actual = allowedSource ? await (await fetch(source)).text() : "";
    const normalize = (xml: string) => {
      const document = new DOMParser().parseFromString(xml, "image/svg+xml");
      return Array.from(document.querySelectorAll("*")).map((node) => ({
        tag: node.tagName,
        attributes: Array.from(node.attributes)
          .map((attr) => [attr.name, attr.value])
          .sort(),
        text: node.children.length ? "" : node.textContent?.trim(),
      }));
    };
    return { allowedSource, actual: normalize(actual), expected: normalize(expectedSvg) };
  }, expected);
  expect(result.allowedSource).toBe(true);
  expect(result.actual).toEqual(result.expected);
}
