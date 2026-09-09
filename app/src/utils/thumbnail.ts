// 战术缩略图：320px JPEG dataURL，失败返回 null（不阻塞保存）
import { inlineImages } from "./inlineImages";
import { prepareBoardExport } from "./boardExport";

export async function captureThumb(maxWidth = 320): Promise<string | null> {
  try {
    const area = document.getElementById("board-area") as unknown as SVGGraphicsElement | null;
    if (!area) return null;
    const { bounds: bbox, content: cloned } = prepareBoardExport(area);
    if (!bbox.width || !bbox.height) return null;

    const newSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    newSvg.setAttribute("width", bbox.width.toString());
    newSvg.setAttribute("height", bbox.height.toString());
    newSvg.setAttribute("viewBox", `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
    await inlineImages(cloned);
    newSvg.appendChild(cloned);

    const svgData = new XMLSerializer().serializeToString(newSvg);
    const svgBase64 = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = svgBase64;
    });

    const scale = Math.min(1, maxWidth / bbox.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bbox.width * scale);
    canvas.height = Math.round(bbox.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}
