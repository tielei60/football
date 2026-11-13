import { onScopeDispose } from "vue";
import { storeToRefs } from "pinia";
import { useDrawStore } from "../stores/drawStore";
import { useGlobalStore } from "../stores/globalStore";
import { useBoardStore } from "../stores/boardStore";
import { useHistory } from "./useHistory";
import { isEraserIntersectDrawing } from "@/utils/collision";
import type { Drawing } from "@/types/drawing";

export function useEraser() {
  const drawStore = useDrawStore();
  const globalStore = useGlobalStore();
  const boardStore = useBoardStore();
  const { pushHistory } = useHistory();
  const { currentTool } = storeToRefs(globalStore);
  const { svgElement } = storeToRefs(boardStore);
  const { getSvgPosition } = boardStore;
  const { drawings } = storeToRefs(drawStore);
  const { removeDrawing } = drawStore;

  let activeSvg: SVGSVGElement | null = null;
  let pointerId: number | null = null;
  const cleanup = () => {
    activeSvg?.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", end, true);
    document.removeEventListener("pointercancel", end, true);
    window.removeEventListener("blur", cleanup);
    activeSvg = null;
    pointerId = null;
  };
  onScopeDispose(cleanup);

  const beginErasing = (e: PointerEvent) => {
    if (!svgElement.value || currentTool.value !== "eraser" || e.button !== 0) return;
    cleanup();
    e.preventDefault();
    e.stopPropagation();
    activeSvg = svgElement.value;
    pointerId = e.pointerId;
    const point = getSvgPosition(e);
    handleEraserCollision(point.x, point.y);
    activeSvg.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end, true);
    document.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", cleanup);
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (!svgElement.value || e.buttons % 2 !== 1 || currentTool.value !== "eraser") {
      cleanup();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const point = getSvgPosition(e);
    handleEraserCollision(point.x, point.y);
  };

  const end = (event: PointerEvent) => {
    if (event.pointerId === pointerId) cleanup();
  };

  const handleEraserCollision = (eraserX: number, eraserY: number) => {
    const eraserRadius = 16;
    const drawingsToRemove: Drawing[] = [];

    // 遍历所有绘图对象，检查与橡皮擦的碰撞
    drawings.value.getDrawings().forEach((drawing) => {
      if (isEraserIntersectDrawing(eraserX, eraserY, eraserRadius, drawing)) {
        drawingsToRemove.push(drawing);
      }
    });

    // 删除相交的图形
    if (drawingsToRemove.length > 0) {
      pushHistory();
      drawingsToRemove.forEach((drawing) => {
        removeDrawing(drawing);
      });
    }
  };
  return {
    beginErasing,
    move,
    end,
  };
}
