<template>
  <el-popover :placement="placement" popper-class="shape-popover" trigger="click" ref="popoverRef">
    <template #reference>
      <button
        ref="buttonRef"
        class="tbtn shape-btn"
        :class="{ active: currentTool === 'shape' }"
        title="绘制跑位/传球/区域"
        aria-label="绘制跑位/传球/区域"
        :aria-pressed="currentTool === 'shape'"
        @click="handleClick()"
      >
        <Spline :size="19" />
      </button>
    </template>
    <div class="shape-select-container" ref="popoverContainerRef">
      <span>图形类型</span>
      <ShapeSelect></ShapeSelect>
      <span>虚线（跑位线）</span>
      <el-switch v-model="drawingConfig.dashed" />
      <span>描边</span>
      <ColorSelect
        :preset-colors="['#1e1e1e', '#cf423b', '#3472bc']"
        :default-select-color="'#1e1e1e'"
        @change-color="handleChangeStrokeColor"
      ></ColorSelect>
      <span>背景</span>
      <ColorSelect
        :preset-colors="['transparent', '#ffc9c9', '#a5d8ff']"
        :default-select-color="'transparent'"
        @change-color="handleChangeBackgroundColor"
      ></ColorSelect>
      <span>描边宽度</span>
      <SizeSelect></SizeSelect>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ElPopover, ElSwitch } from "element-plus";
import "element-plus/es/components/popover/style/css";
import "element-plus/es/components/switch/style/css";
import { storeToRefs } from "pinia";
import { Spline } from "lucide-vue-next";
import { ref, watch, computed } from "vue";
import { useDrawStore } from "../../stores/drawStore";
import ShapeSelect from "@/components/drawings/ShapeSelect.vue";
import ColorSelect from "@/components/drawings/ColorSelect.vue";
import SizeSelect from "@/components/drawings/SizeSelect.vue";
import { useClickOutside } from "@/composables/useClickOutside";
import { useGlobalStore } from "@/stores/globalStore";

const drawStore = useDrawStore();
const globalStore = useGlobalStore();

const { setCurrentTool } = globalStore;

const { drawingConfig } = storeToRefs(drawStore);
const { orientation, currentTool } = storeToRefs(globalStore);

const popoverVisible = ref(false);

const popoverRef = ref<HTMLElement | null>(null);
const buttonRef = ref<HTMLElement | null>(null);
const popoverContainerRef = ref<HTMLElement | null>(null);
const closePopover = () => {
  // @ts-ignore
  popoverRef.value?.hide();
};

const handleClick = () => {
  setCurrentTool("shape");
  popoverVisible.value = !popoverVisible.value;
};

useClickOutside({
  targetRef: popoverContainerRef,
  excludeRefs: [buttonRef],
  onClickOutside: closePopover,
});

const handleChangeStrokeColor = (color: string) => {
  drawingConfig.value.strokeColor = color;
};

const handleChangeBackgroundColor = (color: string) => {
  drawingConfig.value.backgroundColor = color;
};

const placement = computed(() => (orientation.value === "landscape" ? "left-start" : "bottom"));

watch(currentTool, (newTool) => {
  if (newTool !== "shape") {
    closePopover();
  }
});
</script>

<style lang="scss">
.shape-icon {
  width: 38px !important;
  height: 38px !important;
}
.el-popover.el-popover,
.el-popover {
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  border: 1.5px solid var(--pitch-500, #15803d);
  color: var(--text-dark-color);
  font-weight: 500;
  padding: 20px;
}

.shape-popover {
  width: 12.5rem !important;
}
</style>

<style lang="scss" scoped>
.shape-select-container {
  display: flex;
  gap: 1rem;
  flex-direction: column;
}
</style>
