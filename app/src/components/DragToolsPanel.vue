<template>
  <!-- 取色板：场地底部边线下方空地，不遮挡名单面板 -->
  <g class="palette">
    <g v-for="(item, index) in toolItems" :key="`tool-item-${item.id}`">
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
import { computed, ref } from "vue";
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
const { pushHistory } = useHistory();

// 方法可以直接解构
const { addElement, removeDraggingNewItem, setDraggingNewItem } = itemStore;

// 使用 storeToRefs 保持响应性
const { newDraggingItem } = storeToRefs(itemStore);
const { isAnimationMode } = storeToRefs(animationStore);

const toolItemNumbers = ref([0, 0, 0, 0, 0, 0]);
// 横竖屏统一：底部边线下方空地（y=795），不遮挡左侧名单
const toolItems = computed(() => [
  new FieldElement({ color: "#eb281e", x: 350, y: 795, number: toolItemNumbers.value[0], elementType: "player" }),
  new FieldElement({ color: "#2495ff", x: 420, y: 795, number: toolItemNumbers.value[1], elementType: "player" }),
  new FieldElement({ color: "#fffd55", x: 490, y: 795, number: toolItemNumbers.value[2], elementType: "player" }),
  new FieldElement({ color: "#ffffff", x: 560, y: 795, number: toolItemNumbers.value[3], elementType: "player" }),
  new FieldElement({ color: "#000000", x: 630, y: 795, number: toolItemNumbers.value[4], elementType: "player" }),
  new FieldElement({ x: 705, y: 795, elementType: "ball" }),
]);

const startDragNewItem = (item: FieldElement, event: PointerEvent, index: number) => {
  event.stopPropagation();
  // @ts-ignore
  const svg = document.getElementById("field") as SVGSVGElement;
  if (!svg) return;

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

  const stopDrag = (moveEvent: PointerEvent) => {
    const { x, y } = boardStore.getSvgPosition(moveEvent);
    if (!boardStore.isOutOfBoardArea(moveEvent, ELEMENT_RADIUS_OBJECT[item.elementType])) {
      const element = new FieldElement({
        color: item.color,
        x,
        y,
        number: elementNumber,
        elementType: item.elementType,
      });
      if (isAnimationMode.value) {
        element.creationMode = "animation";
        animationStore.addElement(element);
      }
      pushHistory();
      addElement(element);
      toolItemNumbers.value[index]++;
    }
    removeDraggingNewItem();
    svg.removeEventListener("pointermove", moveDrag);
    svg.removeEventListener("pointerup", stopDrag);
    svg.removeEventListener("pointercancel", stopDrag);
  };

  const moveDrag = (moveEvent: PointerEvent) => {
    if (newDraggingItem.value) {
      const { x, y } = boardStore.getSvgPosition(moveEvent);
      newDraggingItem.value.x = x;
      newDraggingItem.value.y = y;
    }
  };

  svg.addEventListener("pointermove", moveDrag);
  svg.addEventListener("pointerup", stopDrag);
  svg.addEventListener("pointercancel", stopDrag);
};
</script>

<style lang="scss" scoped>
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
