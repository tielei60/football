import type { ElementType } from "@/types/fieldElement";

export const GAME_CONSTANTS = {
  showWatermark: true, // 是否显示水印
  showWatermarkText: "柏林花园FC · 8人制战术板", // 水印文本
};

export const ELEMENT_RADIUS_OBJECT: Record<ElementType, number> = {
  player: 24, // 球员
  ball: 13, // 足球
};

// 图标渐变色
export const gradientColor = {
  startColor: "#95e3e1",
  endColor: "#3ca49f",
};

export const DEFAULT_TOOL_CONFIG = {
  SHAPES: { strokeColor: "#1e1e1e", backgroundColor: "transparent", size: 2, shape: "pen", dashed: false },
};

// 跑位线（虚线箭头）与传球线（实线箭头）预设
export const RUN_LINE_CONFIG = { shape: "arrow", dashed: true, strokeColor: "#cf423b" };
export const PASS_LINE_CONFIG = { shape: "arrow", dashed: false, strokeColor: "#1e1e1e" };
