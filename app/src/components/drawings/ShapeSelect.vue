<template>
  <div class="shape-container">
    <div class="shape-group">
      <button
        type="button"
        :aria-label="shapeLabels[shape]"
        :aria-pressed="drawingConfig.type === shape"
        v-for="shape in shapes"
        :key="shape"
        class="shape-item"
        :class="{ active: drawingConfig.type === shape }"
        @click="chooseShape(shape)"
      >
        <SvgIcon :name="shape" class="svg-icon"></SvgIcon>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useDrawStore } from "@/stores/drawStore";
import SvgIcon from "@/components/common/SvgIcon.vue";

const drawStore = useDrawStore();

const { drawingConfig } = storeToRefs(drawStore);

const shapeLabels: Record<string, string> = {
  pen: "自由画笔",
  line: "直线",
  arrow: "箭头",
  rectangle: "矩形",
  ellipse: "椭圆",
};
const shapes = ["pen", "line", "arrow", "rectangle", "ellipse"];

const emit = defineEmits(["changedShape"]);

const chooseShape = (shape: string) => {
  drawingConfig.value.type = shape;
  emit("changedShape", shape);
};
</script>

<style lang="scss" scoped>
.shape-container {
  display: flex;
  flex-wrap: wrap;
  width: 100%;

  .shape-group {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-around;
    width: 100%;
    gap: 0.5rem;
  }

  .shape-item {
    width: 2.1rem;
    height: 2.1rem;
    border-radius: 8px;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    color: var(--text-dark-color);
    background: var(--color-surface);
    box-shadow: var(--shadow-sm);
    border: 1.5px solid var(--pitch-500);

    &:hover {
      background: var(--color-brand-soft);
    }

    .svg-icon {
      width: 1rem;
      height: 1rem;
    }

    &.active {
      background: var(--color-brand-soft);
    }
  }
}
</style>
