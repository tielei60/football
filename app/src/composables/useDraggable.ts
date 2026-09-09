/* eslint-disable no-param-reassign */
import { storeToRefs } from "pinia";
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

  const { isAnimationMode, currentAnimation } = storeToRefs(animationStore);
  const { moveElement } = itemStore;
  const { svgElement } = storeToRefs(boardStore);

  const startDrag = (
    item: FieldElement,
    event: PointerEvent,
    callbacks: {
      onDragMove?: (x: number, y: number) => void;
      onDragEnd?: () => void;
      onClick?: () => void;
      onDragStart?: () => void;
    }
  ) => {
    const svg = svgElement.value;
    if (!svg) return;

    hasDragged = false;
    const startX = event.clientX;
    const startY = event.clientY;
    const dragThreshold = 4; // 拖动阈值

    const handleMoveItem = (moveEvent: PointerEvent) => {
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
      const x = globalStore.snap ? Math.round(clamped.x / SNAP_GRID) * SNAP_GRID : clamped.x;
      const y = globalStore.snap ? Math.round(clamped.y / SNAP_GRID) * SNAP_GRID : clamped.y;

      if (isAnimationMode.value) {
        animationStore.updateElementPosition(item.id, x, y);
      } else {
        moveElement(item.id, x, y);
      }

      if (callbacks.onDragMove) {
        callbacks.onDragMove(x, y);
      }
    };

    const stopDrag = () => {
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
      if (!hasDragged && callbacks.onClick) {
        callbacks.onClick();
      }

      document.removeEventListener("pointermove", handleMoveItem);
      document.removeEventListener("pointerup", stopDrag);
      document.removeEventListener("pointercancel", stopDrag);
    };

    // 监听整个window的事件
    document.addEventListener("pointermove", handleMoveItem);
    document.addEventListener("pointerup", stopDrag);
    document.addEventListener("pointercancel", stopDrag);
  };
  return {
    startDrag,
  };
}
