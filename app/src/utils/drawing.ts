import { protectDrawingContrast } from "./displayContrast";
import type { renderRoughDrawingvaVriable, renderRoughDrawingConfig } from "@/types/drawing";

// 获取矩形的基本参数
export function getRectangleParams(vriable: renderRoughDrawingvaVriable) {
  const width = Math.abs(vriable.endX! - vriable.startX!);
  const height = Math.abs(vriable.endY! - vriable.startY!);
  const x = Math.min(vriable.startX!, vriable.endX!);
  const y = Math.min(vriable.startY!, vriable.endY!);
  return { x, y, width, height };
}

// 获取椭圆的基本参数
export function getEllipseParams(vriable: renderRoughDrawingvaVriable) {
  const width = vriable.endX! - vriable.startX!;
  const height = vriable.endY! - vriable.startY!;
  const centerX = vriable.startX! + width / 2;
  const centerY = vriable.startY! + height / 2;
  return { centerX, centerY, width, height };
}

// 获取通用的图形样式配置（手绘笔/框保留质感，只降抖）
export function getShapeStyle(cfg: renderRoughDrawingConfig) {
  return {
    roughness: 1,
    stroke: cfg.strokeColor,
    fill: cfg.backgroundColor,
    strokeWidth: cfg.size,
    fillWeight: 2,
    hachureGap: 8,
    seed: 1,
    strokeLineDash: cfg.dashed ? [12, 8] : undefined,
    strokeLineDashOffset: 0,
  };
}

// 文字字号：随描边宽度放大，保证投屏可读
export function textFontSize(cfg: renderRoughDrawingConfig) {
  return 14 + (cfg.size || 2) * 4;
}

export function renderText(vriable: renderRoughDrawingvaVriable, styleConfig: renderRoughDrawingConfig) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
  el.setAttribute("x", String(vriable.startX));
  el.setAttribute("y", String(vriable.startY));
  el.setAttribute("fill", styleConfig.strokeColor);
  el.setAttribute("font-size", String(textFontSize(styleConfig)));
  el.setAttribute("font-weight", "700");
  el.textContent = styleConfig.text || "";
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

// 干净矢量箭头：圆头线轴 + 实心三角箭头 + 投影；虚线只打在线轴上
export function renderArrow(rc: any, vriable: renderRoughDrawingvaVriable, styleConfig: renderRoughDrawingConfig) {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("style", "filter: drop-shadow(0 2px 3px rgba(0,0,0,0.3))");

  const dx = vriable.endX - vriable.startX;
  const dy = vriable.endY - vriable.startY;
  const len = Math.hypot(dx, dy);
  if (len === 0) return group;
  const ux = dx / len;
  const uy = dy / len;
  const size = Math.max(styleConfig.size, 2);
  const headLen = Math.max(size * 4.5, 15);
  const headHalf = headLen * 0.55;

  const shaft = document.createElementNS(SVG_NS, "line");
  shaft.setAttribute("x1", String(vriable.startX));
  shaft.setAttribute("y1", String(vriable.startY));
  shaft.setAttribute("x2", String(vriable.endX));
  shaft.setAttribute("y2", String(vriable.endY));
  shaft.setAttribute("stroke", styleConfig.strokeColor);
  shaft.setAttribute("stroke-width", String(size));
  shaft.setAttribute("stroke-linecap", "round");
  if (styleConfig.dashed) {
    shaft.setAttribute("stroke-dasharray", "12 8");
  }
  group.appendChild(shaft);

  // 实心三角：顶点在终点，底边中点后退 headLen
  const bx = vriable.endX - ux * headLen;
  const by = vriable.endY - uy * headLen;
  const c1x = bx - uy * headHalf;
  const c1y = by + ux * headHalf;
  const c2x = bx + uy * headHalf;
  const c2y = by - ux * headHalf;
  const head = document.createElementNS(SVG_NS, "path");
  head.setAttribute("d", `M${vriable.endX},${vriable.endY} L${c1x},${c1y} L${c2x},${c2y} Z`);
  head.setAttribute("fill", styleConfig.strokeColor);
  group.appendChild(head);

  return group;
}

// 干净矢量直线：圆头 + 投影，支持虚线
export function renderCleanLine(vriable: renderRoughDrawingvaVriable, styleConfig: renderRoughDrawingConfig) {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("style", "filter: drop-shadow(0 2px 3px rgba(0,0,0,0.3))");
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(vriable.startX));
  line.setAttribute("y1", String(vriable.startY));
  line.setAttribute("x2", String(vriable.endX));
  line.setAttribute("y2", String(vriable.endY));
  line.setAttribute("stroke", styleConfig.strokeColor);
  line.setAttribute("stroke-width", String(Math.max(styleConfig.size, 2)));
  line.setAttribute("stroke-linecap", "round");
  if (styleConfig.dashed) {
    line.setAttribute("stroke-dasharray", "12 8");
  }
  group.appendChild(line);
  return group;
}

export function renderShape(
  rc: any, // rough.js 实例
  type: string,
  vriable: renderRoughDrawingvaVriable,
  styleConfig: renderRoughDrawingConfig
) {
  const style = getShapeStyle(styleConfig);

  switch (type) {
    case "rectangle": {
      const { x, y, width, height } = getRectangleParams(vriable);
      return protectDrawingContrast(rc.rectangle(x, y, width, height, style), styleConfig.strokeColor);
    }
    case "ellipse": {
      const { centerX, centerY, width, height } = getEllipseParams(vriable);
      return protectDrawingContrast(
        rc.ellipse(centerX, centerY, Math.abs(width), Math.abs(height), style),
        styleConfig.strokeColor
      );
    }
    case "arrow":
      return renderArrow(rc, vriable, styleConfig);
    case "line":
      return renderCleanLine(vriable, styleConfig);
    case "pen": {
      if (!vriable.pathPoints || vriable.pathPoints.length < 2) return null;
      // 使用 rough.js 的 linearPath 方法连接点
      return protectDrawingContrast(rc.linearPath(vriable.pathPoints, style), styleConfig.strokeColor);
    }
    case "text":
      return protectDrawingContrast(renderText(vriable, styleConfig), styleConfig.strokeColor);
    default:
      return null;
  }
}
