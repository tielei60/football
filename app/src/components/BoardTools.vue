<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import {
  MousePointer2,
  Type,
  Eraser,
  Trash2,
  Download,
  Maximize,
  Minimize,
  Film,
  Undo2,
  Redo2,
  ArrowLeft,
  ArrowUpRight,
  Send,
  Square,
} from "lucide-vue-next";
import { ElMessage } from "element-plus";
import { confirmAction } from "@/components/ui/confirmAction";
import { captureScreenshot } from "@/utils/index";
import { useItemStore } from "@/stores/itemStore";
import { useGlobalStore } from "@/stores/globalStore";
import { useBoardStore } from "@/stores/boardStore";
import { useDrawStore } from "@/stores/drawStore";
import { useAnimationStore } from "@/stores/animationStore";
import { useTacticsStore } from "@/stores/tacticsStore";
import { useHistory } from "@/composables/useHistory";
import Shape from "./drawings/Shape.vue";
import { RUN_LINE_CONFIG, PASS_LINE_CONFIG } from "@/constants";

const globalStore = useGlobalStore();
const itemStore = useItemStore();
const boardStore = useBoardStore();
const drawStore = useDrawStore();
const animationStore = useAnimationStore();
const { handleUndo, handleRedo, canUndo, canRedo, pushHistory } = useHistory();
const { currentTool } = storeToRefs(globalStore);
const { isAnimationMode } = storeToRefs(animationStore);
const exporting = ref(false);
const clearing = ref(false);
const drawingSelected = (kind: "run" | "pass" | "zone") => {
  const config = drawStore.drawingConfig;
  if (currentTool.value !== "shape") return false;
  if (kind === "zone") return config.type === "rectangle";
  const preset = kind === "run" ? RUN_LINE_CONFIG : PASS_LINE_CONFIG;
  return config.type === preset.shape && config.dashed === preset.dashed && config.strokeColor === preset.strokeColor;
};
const toolCaption = computed(() => {
  if (isAnimationMode.value) return animationStore.canEdit ? "调整走位" : "动画预览";
  if (currentTool.value === "text") return "文字标注";
  if (currentTool.value === "eraser") return "擦除线条";
  if (currentTool.value === "shape") {
    const names: Record<string, string> = {
      pen: "自由画笔",
      line: "直线",
      arrow: "箭头",
      rectangle: "矩形",
      ellipse: "椭圆",
    };
    return names[drawStore.drawingConfig.type] || "绘图";
  }
  return "选择拖动";
});
defineProps<{ fullscreen: boolean; fullscreenBusy: boolean; compact?: boolean }>();
const emit = defineEmits<{ fullscreen: [] }>();
const chooseDrawing = (kind: "run" | "pass" | "zone") => {
  const config = kind === "run" ? RUN_LINE_CONFIG : PASS_LINE_CONFIG;
  drawStore.drawingConfig.type = kind === "zone" ? "rectangle" : config.shape;
  drawStore.drawingConfig.dashed = kind === "run";
  drawStore.drawingConfig.strokeColor = config.strokeColor;
  globalStore.setCurrentTool("shape");
};

const openAnimation = () => {
  const elements = itemStore.items
    .findByCreationMode("normal")
    .filter((el) => el.elementType === "player" || el.elementType === "ball");
  animationStore.openAnimationFromBoard(elements);
};
const clearBoard = async () => {
  if (clearing.value) return;
  clearing.value = true;
  const tactics = useTacticsStore();
  const owner = tactics.currentId;
  const before = JSON.stringify(tactics.snapshotBoard());
  try {
    if (
      !(await confirmAction("清空当前画布的全部球员与线条？战术库存档和球员档案不受影响，清空后可撤销。", {
        title: "清空当前画布",
        confirmText: "清空画布",
        danger: true,
      }))
    )
      return;
    if (isAnimationMode.value || tactics.currentId !== owner || JSON.stringify(tactics.snapshotBoard()) !== before) {
      ElMessage.info("画布已改变，未执行清空。请在当前画布重新操作。");
      return;
    }
    pushHistory();
    itemStore.clearElements();
    drawStore.clearDrawings();
  } finally {
    clearing.value = false;
  }
};
const exportImage = async () => {
  if (!boardStore.boardArea || exporting.value) return;
  exporting.value = true;
  try {
    await captureScreenshot(boardStore.boardArea);
  } catch (error) {
    ElMessage.error(error instanceof Error ? `图片导出失败：${error.message}` : "图片导出失败，请重试");
  } finally {
    exporting.value = false;
  }
};
</script>

<template>
  <div class="board-tools" role="toolbar" aria-label="战术绘图工具">
    <p class="tool-caption" role="status" :class="{ destructive: currentTool === 'eraser' }">{{ toolCaption }}</p>
    <div class="tool-section">
      <button
        class="tbtn"
        :class="{ active: currentTool === 'select' }"
        :aria-pressed="currentTool === 'select'"
        @click="globalStore.setCurrentTool('select')"
        title="选择 (V)"
        aria-label="选择 (V)"
      >
        <MousePointer2 :size="19" />
      </button>
      <Shape v-if="!isAnimationMode" />
      <template v-if="compact && !isAnimationMode">
        <button
          class="tbtn"
          :class="{ active: drawingSelected('run') }"
          :aria-pressed="drawingSelected('run')"
          title="跑位线"
          aria-label="跑位线"
          @click="chooseDrawing('run')"
        >
          <ArrowUpRight :size="19" />
        </button>
        <button
          class="tbtn"
          :class="{ active: drawingSelected('pass') }"
          :aria-pressed="drawingSelected('pass')"
          title="传球线"
          aria-label="传球线"
          @click="chooseDrawing('pass')"
        >
          <Send :size="19" />
        </button>
        <button
          class="tbtn"
          :class="{ active: drawingSelected('zone') }"
          :aria-pressed="drawingSelected('zone')"
          title="区域"
          aria-label="区域"
          @click="chooseDrawing('zone')"
        >
          <Square :size="19" />
        </button>
      </template>
      <button
        v-if="!isAnimationMode"
        class="tbtn"
        :class="{ active: currentTool === 'text' }"
        :aria-pressed="currentTool === 'text'"
        @click="globalStore.setCurrentTool('text')"
        title="文字标注 (T)"
        aria-label="文字标注 (T)"
      >
        <Type :size="19" />
      </button>
      <button
        v-if="!isAnimationMode"
        class="tbtn"
        :class="{ active: currentTool === 'eraser' }"
        :aria-pressed="currentTool === 'eraser'"
        @click="globalStore.setCurrentTool('eraser')"
        title="橡皮擦"
        aria-label="橡皮擦"
      >
        <Eraser :size="19" />
      </button>
    </div>
    <div v-if="!isAnimationMode" class="tool-section">
      <button class="tbtn" :disabled="!canUndo" @click="handleUndo" title="撤销" aria-label="撤销">
        <Undo2 :size="19" />
      </button>
      <button class="tbtn" :disabled="!canRedo" @click="handleRedo" title="重做" aria-label="重做">
        <Redo2 :size="19" />
      </button>
      <button
        class="tbtn danger"
        :aria-disabled="clearing"
        :aria-busy="clearing"
        @click="clearBoard"
        title="清空画布"
        aria-label="清空画布"
      >
        <Trash2 :size="18" />
      </button>
    </div>
    <div class="tool-section">
      <button v-if="!isAnimationMode" class="tbtn" @click="openAnimation" title="制作动画" aria-label="制作动画">
        <Film :size="19" />
      </button>
      <button v-else class="tbtn" @click="animationStore.exitAnimation()" title="返回战术板" aria-label="返回战术板">
        <ArrowLeft :size="19" />
      </button>
      <button
        v-if="!isAnimationMode"
        class="tbtn"
        :disabled="exporting"
        :aria-busy="exporting"
        @click="exportImage"
        :title="exporting ? '正在导出' : '导出 PNG'"
        aria-label="导出 PNG"
      >
        <Download :size="19" />
      </button>
      <button
        class="tbtn"
        @click="emit('fullscreen')"
        :disabled="fullscreenBusy"
        :aria-pressed="fullscreen"
        :title="fullscreen ? '退出全屏' : '全屏'"
        :aria-label="fullscreen ? '退出全屏' : '全屏'"
      >
        <component :is="fullscreen ? Minimize : Maximize" :size="19" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.tool-caption {
  margin: 0;
  padding: 2px 0;
  text-align: center;
  color: var(--color-brand);
  font-size: 11px;
  line-height: 1.45;
  font-weight: 650;
  max-width: 2.3em;
  grid-column: 1 / -1;
}
.tool-caption.destructive {
  color: var(--color-danger);
}
@media (max-width: 900px) {
  .tool-caption {
    max-width: none;
    width: 100%;
    text-align: left;
  }
}
.board-tools {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  gap: 10px;
  width: 60px;
  flex-shrink: 0;
  background: var(--surface);
  border-left: 1px solid var(--line);
  overflow-y: auto;
}
.tool-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.tool-section:last-child {
  border: 0;
  padding-bottom: 0;
}
.frame-counter {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  color: var(--muted);
  font-size: 12px;
}
.frame-counter input {
  width: 42px;
  min-height: 32px;
  text-align: center;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink);
}
.animation-tools :deep(.ui-select-trigger) {
  width: 44px;
  height: 34px;
  padding: 0;
  font-size: 11px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink);
  background: var(--color-surface);
}
@media (max-width: 700px) {
  .board-tools {
    width: 100%;
    flex-direction: row;
    padding: 8px 12px;
    gap: 8px;
    border-left: 0;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    overflow-y: hidden;
  }
  .tool-section {
    flex-direction: row;
    width: auto;
    border-bottom: 0;
    border-right: 1px solid var(--line);
    padding: 0 8px 0 0;
    gap: 4px;
    flex-shrink: 0;
  }
  .frame-counter {
    flex-direction: row;
  }
  .animation-tools :deep(.ui-select-trigger) {
    height: 42px;
  }
}
</style>
