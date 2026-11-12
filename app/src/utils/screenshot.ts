// 指定区域截图
import { useTeamIdentity } from "@/composables/useTeamIdentity";
import { inlineImages } from "./inlineImages";
import { prepareBoardExport } from "./boardExport";
import { useMatchStore } from "@/stores/matchStore";

export const captureScreenshot = async (area: SVGElement) => {
  const { teamName, teamFileName } = useTeamIdentity();
  // 获取 area 的边界框
  const { bounds: bbox, content: clonedContent } = prepareBoardExport(area as SVGGraphicsElement);

  // 创建一个新的 SVG 元素
  const newSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  newSvg.setAttribute("width", bbox.width.toString());
  newSvg.setAttribute("height", bbox.height.toString());
  newSvg.setAttribute("viewBox", `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);

  // 克隆 area 内容并添加到新的 SVG 中

  // 内联图片（头像、球图标），否则导出的 PNG 里会丢失
  await inlineImages(clonedContent);

  newSvg.appendChild(clonedContent);

  // 将样式内联到克隆的 SVG 内容中
  const styleSheets = Array.from(document.styleSheets);
  const cssText = styleSheets
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join("");
      } catch (e) {
        return "";
      }
    })
    .join("");
  const style = document.createElement("style");
  style.textContent = cssText;
  newSvg.insertBefore(style, newSvg.firstChild);

  // 将新的 SVG 转换为 base64 编码的图片
  const svgData = new XMLSerializer().serializeToString(newSvg);
  const svgBase64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = svgBase64;
  });

  const canvas = document.createElement("canvas");
  const SCALE = 2; // 投屏 1080p 高清导出
  canvas.width = bbox.width * SCALE;
  canvas.height = bbox.height * SCALE;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, bbox.width, bbox.height, 0, 0, canvas.width, canvas.height);
    // 球队水印
    const date = new Date().toISOString().slice(0, 10);
    ctx.fillStyle = "rgba(11, 42, 29, 0.65)";
    ctx.font = `${20 * SCALE}px sans-serif`;
    ctx.textAlign = "right";
    const playerCount = useMatchStore().playerCount;
    ctx.fillText(
      `${teamName.value} · ${playerCount}人制 · ${date}`,
      canvas.width - 16 * SCALE,
      canvas.height - 12 * SCALE
    );
    const pngUrl = canvas.toDataURL("image/png");

    const link = document.createElement("a");
    link.download = `${teamFileName.value}_${playerCount}人制_${date}.png`;
    link.href = pngUrl;
    link.click();
  }
};
