import { onScopeDispose } from "vue";
import { storeToRefs } from "pinia";
import { useAnimationStore } from "../stores/animationStore";
import { FieldElement } from "../types/fieldElement";
import { getCatmullRomPath } from "../utils/path";
import { getDefaultControlPoint } from "../utils";
import { useBoardStore } from "../stores/boardStore";

export function usePath() {
  const boardStore = useBoardStore();
  const animationStore = useAnimationStore();
  const { currentAnimation, currentFrameIndex } = storeToRefs(animationStore);

  const showPath = (item: FieldElement) => {
    if (!currentAnimation.value) return false;
    const actions = currentAnimation.value.actions;
    if (!actions) return false;
    return actions.some((a) => a.animationElementId === item.id && a.startFrame === currentFrameIndex.value - 1);
  };

  const elementAction = (item: FieldElement) => {
    const currentFrameActions = currentAnimation.value?.actions;
    if (!currentFrameActions) return null;
    return currentFrameActions.find(
      (a) => a.animationElementId === item.id && a.startFrame === currentFrameIndex.value - 1
    );
  };

  const pathData = (item: FieldElement) => {
    const element = animationStore.prevFrameElement(item);
    if (!element) return "";
    const action = elementAction(item);
    if (!action) return "";
    const points = [{ x: element.x, y: element.y }, action.controlPoint, { x: item.x, y: item.y }];
    return getCatmullRomPath(points);
  };

  const pathControlPoint = (item: FieldElement) => {
    const currentFrameActions = currentAnimation.value?.actions;
    const element = animationStore.prevFrameElement(item);
    if (!element) return null;

    if (!currentFrameActions) {
      return getDefaultControlPoint(element.x, element.y, item.x, item.y);
    }
    const action = elementAction(item);
    return action ? action.controlPoint : getDefaultControlPoint(element.x, element.y, item.x, item.y);
  };

  let cancelDrag: (() => void) | undefined;
  onScopeDispose(() => cancelDrag?.());

  const startDragControlPoint = (item: FieldElement, event: PointerEvent) => {
    if (event.button !== 0 || !animationStore.canEdit) return;
    cancelDrag?.();
    const pointerId = event.pointerId;
    const svg = (event.currentTarget as SVGElement).closest("svg");
    if (!svg) return;
    const action = elementAction(item);
    if (!action) return;

    const moveControlPoint = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (moveEvent.buttons % 2 !== 1 || !animationStore.canEdit) {
        stopDrag();
        return;
      }
      const svgPoint = boardStore.getSvgPosition(moveEvent);
      action.controlPoint = {
        x: svgPoint.x,
        y: svgPoint.y,
      };
    };

    const stopDrag = () => {
      svg.removeEventListener("pointermove", moveControlPoint);
      document.removeEventListener("pointerup", end, true);
      document.removeEventListener("pointercancel", end, true);
      window.removeEventListener("blur", stopDrag);
      cancelDrag = undefined;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId === pointerId) stopDrag();
    };
    svg.addEventListener("pointermove", moveControlPoint);
    document.addEventListener("pointerup", end, true);
    document.addEventListener("pointercancel", end, true);
    window.addEventListener("blur", stopDrag);
    cancelDrag = stopDrag;
  };

  return {
    showPath,
    pathData,
    pathControlPoint,
    startDragControlPoint,
  };
}
