<template>
  <!-- 取色板：场地底部边线下方空地，不遮挡名单面板 -->
  <g class="palette">
    <g
      v-for="(item, index) in toolItems"
      :key="index"
      :transform="portrait ? `rotate(90 ${item.x} ${item.y})` : undefined"
      class="palette-option"
      role="button"
      :tabindex="canPlace ? 0 : -1"
      :aria-disabled="!canPlace"
      :aria-label="`添加${paletteNames[index]}`"
      @keydown="onPaletteKey(item, index, $event)"
    >
      <title>{{ `拖到球场添加${paletteNames[index]}；聚焦后按 Enter 或空格添加到视野中央` }}</title>
      <g v-if="item.elementType === 'player'">
        <circle
          :cx="item.x"
          :cy="item.y"
          :r="item.r"
          :fill="item.color"
          :key="`tool-item-${item.id}`"
          :stroke="itemStore.numberColor(item)"
          stroke-width="4"
          @pointerdown="startDragNewItem(item, $event, index)"
        />
        <!-- 号码 -->
        <text
          :x="item.x"
          :y="item.y"
          text-anchor="middle"
          dominant-baseline="central"
          class="player-number"
          :style="{ fill: itemStore.numberColor(item) }"
          pointer-events="none"
        >
          {{ item.number }}
        </text>
      </g>
      <g v-else>
        <image
          :x="item.x - ELEMENT_RADIUS_OBJECT.ball"
          :y="item.y - ELEMENT_RADIUS_OBJECT.ball"
          :width="ELEMENT_RADIUS_OBJECT.ball * 2"
          :height="ELEMENT_RADIUS_OBJECT.ball * 2"
          :href="ballSvg"
          @pointerdown="startDragNewItem(item, $event, index)"
        />
      </g>
    </g>
  </g>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref } from "vue";
import { storeToRefs } from "pinia";
import { useItemStore } from "../stores/itemStore";
import { FieldElement } from "../types/fieldElement";
import { useAnimationStore } from "../stores/animationStore";
import { useHistory } from "../composables/useHistory";
import { ELEMENT_RADIUS_OBJECT } from "../constants";
import { useBoardStore } from "../stores/boardStore";
import ballSvg from "@/assets/icons/ball.svg";

const itemStore = useItemStore();
const animationStore = useAnimationStore();
const boardStore = useBoardStore();
const props = defineProps<{ portrait?: boolean }>();
const { pushHistory, pushBoardHistory } = useHistory();

// 方法可以直接解构
const { addElement, removeDraggingNewItem, setDraggingNewItem } = itemStore;

// 使用 storeToRefs 保持响应性
const { newDraggingItem } = storeToRefs(itemStore);
const { isAnimationMode } = storeToRefs(animationStore);

const paletteNames = ["红色棋子", "蓝色棋子", "黄色棋子", "白色棋子", "黑色棋子", "足球"];
const canPlace = computed(() => !isAnimationMode.value || animationStore.canEdit);
const toolItemNumbers = ref([0, 0, 0, 0, 0, 0]);
// 横竖屏统一：底部边线下方空地（y=795），不遮挡左侧名单
const toolItems = computed(() =>
  [
    new FieldElement({ color: "#eb281e", x: 350, y: 795, number: toolItemNumbers.value[0], elementType: "player" }),
    new FieldElement({ color: "#2495ff", x: 420, y: 795, number: toolItemNumbers.value[1], elementType: "player" }),
    new FieldElement({ color: "#fffd55", x: 490, y: 795, number: toolItemNumbers.value[2], elementType: "player" }),
    new FieldElement({ color: "#ffffff", x: 560, y: 795, number: toolItemNumbers.value[3], elementType: "player" }),
    new FieldElement({ color: "#000000", x: 630, y: 795, number: toolItemNumbers.value[4], elementType: "player" }),
    new FieldElement({ x: 705, y: 795, elementType: "ball" }),
  ].map((item, index) => {
    const placed = item;
    if (props.portrait) {
      placed.x = 30;
      placed.y = 230 + index * 70;
    }
    return item;
  })
);

let cancelDrag: (() => void) | undefined;
onScopeDispose(() => cancelDrag?.());

// Keyboard activation is a separate, explicit alternative to the existing drag gesture.
// Keep the palette node stable so repeated additions do not lose keyboard focus.
const onPaletteKey = (item: FieldElement, index: number, event: KeyboardEvent) => {
  if (!["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat || !canPlace.value || !boardStore.boardAreaBBox) return;
  cancelDrag?.();
  const offset = (toolItemNumbers.value[index] % 5) * 24;
  const { view } = boardStore;
  const position = boardStore.clampPosition(view.x + view.w / 2 + offset, view.y + view.h / 2, item.elementType);
  const element = new FieldElement({
    color: item.color,
    ...position,
    number: item.elementType === "player" ? toolItemNumbers.value[index] : undefined,
    elementType: item.elementType,
  });
  if (isAnimationMode.value) pushBoardHistory();
  else pushHistory();
  if (isAnimationMode.value) {
    element.creationMode = "animation";
    animationStore.addElement(element);
  }
  addElement(element);
  toolItemNumbers.value[index]++;
};

const startDragNewItem = (item: FieldElement, event: PointerEvent, index: number) => {
  if (event.button !== 0 || (isAnimationMode.value && !animationStore.canEdit)) return;
  cancelDrag?.();
  event.preventDefault();
  event.stopPropagation();
  const svg = boardStore.svgElement;
  if (!svg) return;
  const pointerId = event.pointerId;
  const animationMode = isAnimationMode.value;

  const svgPoint = boardStore.getSvgPosition(event);
  const elementNumber = toolItemNumbers.value[index];
  setDraggingNewItem(
    new FieldElement({
      color: item.color,
      x: svgPoint.x,
      y: svgPoint.y,
      number: elementNumber,
      isDragging: true,
      state: "temporary",
      elementType: item.elementType,
    })
  );

  const cleanup = () => {
    removeDraggingNewItem();
    document.removeEventListener("pointermove", moveDrag);
    document.removeEventListener("pointerup", stopDrag, true);
    document.removeEventListener("pointercancel", cancelPointer, true);
    window.removeEventListener("blur", cleanup);
    cancelDrag = undefined;
  };
  const editable = () => animationMode === isAnimationMode.value && (!animationMode || animationStore.canEdit);
  const cancelPointer = (e: PointerEvent) => {
    if (e.pointerId === pointerId) cleanup();
  };
  const stopDrag = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if (
      !editable() ||
      !newDraggingItem.value ||
      boardStore.isOutOfBoardArea(moveEvent, ELEMENT_RADIUS_OBJECT[item.elementType])
    ) {
      cleanup();
      return;
    }
    const { x, y } = boardStore.getSvgPosition(moveEvent);
    const element = new FieldElement({
      color: item.color,
      x,
      y,
      number: elementNumber,
      elementType: item.elementType,
    });
    if (isAnimationMode.value) pushBoardHistory();
    else pushHistory();
    if (isAnimationMode.value) {
      element.creationMode = "animation";
      animationStore.addElement(element);
    }
    addElement(element);
    toolItemNumbers.value[index]++;
    cleanup();
  };
  const moveDrag = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if (moveEvent.buttons % 2 !== 1 || !editable()) {
      cleanup();
      return;
    }
    if (newDraggingItem.value) {
      const { x, y } = boardStore.getSvgPosition(moveEvent);
      newDraggingItem.value.x = x;
      newDraggingItem.value.y = y;
    }
  };
  document.addEventListener("pointermove", moveDrag);
  document.addEventListener("pointerup", stopDrag, true);
  document.addEventListener("pointercancel", cancelPointer, true);
  window.addEventListener("blur", cleanup);
  cancelDrag = cleanup;
};
</script>

<style lang="scss" scoped>
.palette-option {
  cursor: grab;
  outline: none;
}
.palette-option:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 6px;
  border-radius: 50%;
}
.palette-option[aria-disabled="true"] {
  opacity: 0.45;
  cursor: not-allowed;
}
.player-number {
  font-size: 20px;
  font-weight: bold;
  cursor: pointer;
}

image {
  cursor: pointer;
}
</style>

<style>
.palette circle {
  cursor: pointer;
  transition: r 0.2s ease;
}
</style>
