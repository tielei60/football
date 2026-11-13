/* eslint-disable no-use-before-define */
import { onScopeDispose } from "vue";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";
import { useDrawStore } from "../stores/drawStore";
import { useGlobalStore } from "../stores/globalStore";
import { useBoardStore } from "../stores/boardStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useHistory } from "./useHistory";
import { renderShape } from "@/utils/drawing";

export function useDrawing() {
  const drawStore = useDrawStore();
  const globalStore = useGlobalStore();
  const boardStore = useBoardStore();
  const animationStore = useAnimationStore();
  const { pushHistory } = useHistory();

  const { svgElement, roughSvg, drawingLayer } = storeToRefs(boardStore);
  const { isDrawing, currentTool } = storeToRefs(globalStore);
  const { drawingConfig } = storeToRefs(drawStore);
  const { createDrawing } = drawStore;
  const { setDrawStatus, setCurrentTool } = globalStore;
  const { isOutOfBoardArea, getSvgPosition } = boardStore;
  const { isAnimationMode } = storeToRefs(animationStore);

  let animationFrameId: number | null = null;
  let startX = 0;
  let startY = 0;
  let pathPoints: [number, number][] = [];

  let activeSvg: SVGSVGElement | null = null;
  let pointerId: number | null = null;
  const cleanup = () => {
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    activeSvg?.removeEventListener("pointermove", moveDrawing);
    document.removeEventListener("pointerup", endDrawing, true);
    document.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("blur", abandonDrawing);
    activeSvg = null;
    pointerId = null;
  };
  const abandonDrawing = () => {
    cleanup();
    setDrawStatus(false);
    clearDrawingLayer();
    pathPoints = [];
  };
  const onCancel = (e: PointerEvent) => {
    if (e.pointerId === pointerId) abandonDrawing();
  };
  onScopeDispose(abandonDrawing);

  const startDrawing = (e: PointerEvent) => {
    if (isAnimationMode.value || e.button !== 0) return;
    if (!svgElement.value || ["select"].includes(currentTool.value)) return;
    if (isOutOfBoardArea(e, 0)) return;
    e.preventDefault();
    e.stopPropagation();

    const point = getSvgPosition(e);

    // 文字工具：点按即放置，可双击编辑
    if (currentTool.value === "text") {
      pushHistory();
      createDrawing("text", point.x, point.y, point.x, point.y, [], "双击编辑");
      setCurrentTool("select");
      return;
    }

    abandonDrawing();
    activeSvg = svgElement.value;
    pointerId = e.pointerId;
    setDrawStatus(true);

    startX = point.x;
    startY = point.y;

    if (drawingConfig.value.type === "pen") {
      pathPoints = [[startX, startY]];
    }

    createTempDrawing(drawingConfig.value.type, point.x, point.y, pathPoints);

    activeSvg!.addEventListener("pointermove", moveDrawing);
    document.addEventListener("pointerup", endDrawing, true);
    document.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("blur", abandonDrawing);
  };

  const moveDrawing = (e: PointerEvent) => {
    if (e.pointerId !== pointerId || !svgElement.value || !isDrawing.value) return;
    if (e.buttons % 2 !== 1) {
      abandonDrawing();
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    // 检查鼠标是否移出了战术区域
    if (isOutOfBoardArea(e, 0)) {
      // 如果移出了战术区域，取消绘制
      cancelDrawing();
      return;
    }

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }
    animationFrameId = requestAnimationFrame(() => {
      const point = getSvgPosition(e);
      if (drawingConfig.value.type === "pen") {
        pathPoints.push([point.x, point.y]);
      }
      updateDrawing(point.x, point.y);
    });
  };

  const endDrawing = (event: PointerEvent) => {
    if (event.pointerId !== pointerId || !svgElement.value || !isDrawing.value) return;
    event.preventDefault();
    event.stopPropagation();

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    setDrawStatus(false);

    if (isOutOfBoardArea(event, 0)) {
      abandonDrawing();
      return;
    }

    const svgPoint = getSvgPosition(event);
    // pointerup is the authoritative last sample, even if the RAF was cancelled.
    if (drawingConfig.value.type === "pen") {
      const last = pathPoints[pathPoints.length - 1];
      if (!last || last[0] !== svgPoint.x || last[1] !== svgPoint.y) pathPoints.push([svgPoint.x, svgPoint.y]);
    }
    pushHistory();
    createDrawing(currentTool.value, startX, startY, svgPoint.x, svgPoint.y, pathPoints);
    clearDrawingLayer();
    pathPoints = [];

    cleanup();
  };

  // 取消绘制
  const cancelDrawing = () => {
    if (!svgElement.value || !isDrawing.value) return;

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    setDrawStatus(false);
    clearDrawingLayer();
    pathPoints = [];

    // 移除事件监听器
    cleanup();

    // 显示提示信息
    ElMessage({
      message: "请在战术区域内进行绘制",
      type: "warning",
      duration: 2000,
    });
  };

  // 创建临时图形
  // eslint-disable-next-line no-shadow
  const createTempDrawing = (type: string, endX: number, endY: number, pathPoints: [number, number][]) => {
    if (!drawingLayer.value || !roughSvg.value) return;

    const renderRoughDrawingVriable = {
      startX,
      startY,
      endX,
      endY,
      pathPoints,
    };
    const styleConfig = {
      strokeColor: drawingConfig.value.strokeColor,
      backgroundColor: drawingConfig.value.backgroundColor,
      size: drawingConfig.value.size,
      dashed: drawingConfig.value.dashed,
    };

    const roughElement = renderShape(roughSvg.value, type, renderRoughDrawingVriable, styleConfig);

    if (roughElement) {
      drawingLayer.value.appendChild(roughElement);
    }
  };

  const updateDrawing = (endX: number, endY: number) => {
    if (!roughSvg.value) return;
    clearDrawingLayer();
    createTempDrawing(drawingConfig.value.type, endX, endY, pathPoints);
  };

  const clearDrawingLayer = () => {
    if (!drawingLayer.value) return;
    while (drawingLayer.value.firstChild) {
      drawingLayer.value.removeChild(drawingLayer.value.firstChild);
    }
  };

  return {
    startDrawing,
    moveDrawing,
    endDrawing,
    cancelDrawing,
    getSvgPosition,
  };
}
