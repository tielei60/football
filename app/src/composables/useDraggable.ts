/* eslint-disable no-param-reassign */
import { storeToRefs } from "pinia";
import { onScopeDispose } from "vue";
import { useItemStore } from "../stores/itemStore";
import { useAnimationStore } from "../stores/animationStore";
import { useGlobalStore } from "../stores/globalStore";
import { FieldElement } from "../types/fieldElement";
import { useBoardStore } from "../stores/boardStore";

export const SNAP_GRID = 10;

export function useDraggable() {
  const itemStore = useItemStore();
  const animationStore = useAnimationStore();
  const boardStore = useBoardStore();
  const globalStore = useGlobalStore();
  let hasDragged = false; // 内部状态，用于判断是否发生了真实拖动
  let cancelDrag: (() => void) | undefined;
  onScopeDispose(() => cancelDrag?.());

  const { isAnimationMode, currentAnimation } = storeToRefs(animationStore);
  const { moveElement } = itemStore;
  const { svgElement } = storeToRefs(boardStore);

  const startDrag = (
    item: FieldElement,
    startEvent: PointerEvent,
    callbacks: {
      onDragMove?: (x: number, y: number) => void;
      onDragEnd?: () => void;
      onClick?: () => void;
      onDragStart?: () => void;
    }
  ) => {
    const svg = svgElement.value;
    if (!svg || startEvent.button !== 0) return;
    cancelDrag?.();

    hasDragged = false;
    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    const dragThreshold = 4; // 拖动阈值

    let frame: number | undefined;
    let pending: PointerEvent | undefined;
    const applyMove = (moveEvent: PointerEvent) => {
      if (!item.id) return;
      if (!hasDragged) {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= dragThreshold) return;

        hasDragged = true;

        // 触发拖动开始回调，只在确认拖动后触发一次
        if (callbacks.onDragStart) {
          callbacks.onDragStart();
        }

        if (isAnimationMode.value) {
          // 动画模式下更新共享元素池中的 isDragging
          const animation = currentAnimation.value;
          if (animation) {
            const sharedElement = animation.getSharedElement(item.id);
            if (sharedElement) {
              sharedElement.isDragging = true;
            }
          }
        } else {
          // 非动画模式下直接修改 item.isDragging
          item.isDragging = true;
        }
      }

      const svgPoint = boardStore.getSvgPosition(moveEvent);
      const clamped = boardStore.clampPosition(svgPoint.x, svgPoint.y, item.elementType);
      // 网格吸附（教练栏开关，默认开启）
      const snappedX = globalStore.snap ? Math.round(clamped.x / SNAP_GRID) * SNAP_GRID : clamped.x;
      const snappedY = globalStore.snap ? Math.round(clamped.y / SNAP_GRID) * SNAP_GRID : clamped.y;

      // Snapping must never move an already-clamped center beyond the board edge.
      const { x, y } = boardStore.clampPosition(snappedX, snappedY, item.elementType);

      if (isAnimationMode.value) {
        animationStore.updateElementPosition(item.id, x, y);
      } else {
        moveElement(item.id, x, y);
      }

      if (callbacks.onDragMove) {
        callbacks.onDragMove(x, y);
      }
    };

    const flushMove = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      const event = pending;
      pending = undefined;
      if (event) applyMove(event);
    };
    const handleMoveItem = (event: PointerEvent) => {
      if (event.pointerId !== eventPointerId) return;
      if (event.buttons % 2 !== 1) {
        cancelDrag?.();
        return;
      }
      pending = event;
      if (frame === undefined) frame = requestAnimationFrame(flushMove);
    };
    const eventPointerId = startEvent.pointerId;
    const cleanup = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      pending = undefined;
      document.removeEventListener("pointermove", handleMoveItem);
      document.removeEventListener("pointerup", stopDrag);
      document.removeEventListener("pointercancel", stopDrag);
      window.removeEventListener("blur", handleBlur);
      cancelDrag = undefined;
    };
    const stopDrag = (event: PointerEvent) => {
      if (event.pointerId !== eventPointerId) return;
      // Commit the queued sample before ending the gesture, even between frames.
      flushMove();
      cleanup();
      if (!item.id) return;
      if (isAnimationMode.value) {
        // 动画模式下更新共享元素池中的 isDragging
        const animation = currentAnimation.value;
        if (animation) {
          const sharedElement = animation.getSharedElement(item.id);
          if (sharedElement) {
            sharedElement.isDragging = false;
          }
        }
      } else {
        // 非动画模式下直接修改 item.isDragging
        item.isDragging = false;
      }

      // 触发拖动结束回调
      if (hasDragged && callbacks.onDragEnd) {
        callbacks.onDragEnd();
      }

      // 触发点击回调
      if (!hasDragged && event.type !== "pointercancel" && callbacks.onClick) {
        callbacks.onClick();
      }
    };

    const handleBlur = () => cancelDrag?.();

    // 监听整个window的事件
    document.addEventListener("pointermove", handleMoveItem);
    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("pointercancel", stopDrag);
    window.addEventListener("blur", handleBlur);
    cancelDrag = () => {
      cleanup();
      item.isDragging = false;
      if (isAnimationMode.value && item.id) {
        const shared = currentAnimation.value?.getSharedElement(item.id);
        if (shared) shared.isDragging = false;
      }
    };
  };
  return {
    startDrag,
  };
}
