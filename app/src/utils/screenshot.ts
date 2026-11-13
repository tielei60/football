// 指定区域截图
import { useTeamIdentity } from "@/composables/useTeamIdentity";
import { inlineImages } from "./inlineImages";
import { prepareBoardExport } from "./boardExport";
import { useMatchStore } from "@/stores/matchStore";

const EXPORT_TIMEOUT_MS = 15000;
const SCALE = 2; // Normal 1250 × 826 boards remain 2500 × 1652 pixels.
const MAX_CANVAS_EDGE = 8192;
const MAX_CANVAS_PIXELS = 32 * 1024 * 1024;

function withExportTimeout<T>(work: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), EXPORT_TIMEOUT_MS);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export const captureScreenshot = async (area: SVGElement) => {
  const { teamName, teamFileName } = useTeamIdentity();
  // 获取 area 的边界框
  const { bounds: bbox, content: clonedContent } = prepareBoardExport(area as SVGGraphicsElement);

  if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0)
    throw new Error("画布尺寸无效，无法导出 PNG");

  const width = Math.floor(bbox.width * SCALE);
  const height = Math.floor(bbox.height * SCALE);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_CANVAS_EDGE ||
    height > MAX_CANVAS_EDGE ||
    width * height > MAX_CANVAS_PIXELS
  )
    throw new Error("画布尺寸超出 PNG 导出上限，请将元素移回场内后重试");

  // 创建一个新的 SVG 元素
  const newSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  newSvg.setAttribute("width", bbox.width.toString());
  newSvg.setAttribute("height", bbox.height.toString());
  newSvg.setAttribute("viewBox", `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);

  // 克隆 area 内容并添加到新的 SVG 中

  // 内联图片（头像、球图标），否则导出的 PNG 里会丢失
  await withExportTimeout(inlineImages(clonedContent), "图片资源读取超时，请重试导出");

  newSvg.appendChild(clonedContent);

  // prepareBoardExport already freezes resolved paint, including theme tokens.
  // Do not copy unrelated application CSS into the downloaded image.

  // 将新的 SVG 转换为 base64 编码的图片
  const svgData = new XMLSerializer().serializeToString(newSvg);
  const svgBase64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
    const timer = setTimeout(() => {
      cleanup();
      img.src = "";
      reject(new Error("战术图片渲染超时，请重试导出"));
    }, EXPORT_TIMEOUT_MS);
    img.onload = () => {
      cleanup();
      resolve();
    };
    img.onerror = () => {
      cleanup();
      reject(new Error("战术图片加载失败，无法导出 PNG"));
    };
    img.src = svgBase64;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法创建图片画布，请重试导出");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, bbox.width, bbox.height, 0, 0, canvas.width, canvas.height);
  // 球队水印
  const date = new Date().toISOString().slice(0, 10);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-text-muted").trim() || "#6f6277";
  ctx.font = `${20 * SCALE}px sans-serif`;
  ctx.textAlign = "right";
  const playerCount = useMatchStore().playerCount;
  ctx.fillText(
    `${teamName.value} · ${playerCount}人制 · ${date}`,
    canvas.width - 16 * SCALE,
    canvas.height - 12 * SCALE
  );
  const blob = await withExportTimeout(
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => {
        if (!result || result.size === 0) reject(new Error("PNG 编码失败，未生成图片"));
        else resolve(result);
      }, "image/png");
    }),
    "PNG 编码超时，请重试导出"
  );
  const pngUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `${teamFileName.value}_${playerCount}人制_${date}.png`;
  link.href = pngUrl;
  link.hidden = true;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser download manager time to consume the URL.
    setTimeout(() => URL.revokeObjectURL(pngUrl), 30000);
  }
};
