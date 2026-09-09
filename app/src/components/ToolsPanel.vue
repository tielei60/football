<template>
  <g class="tools-panel">
    <foreignObject
      ref="toolsPanelRef"
      :x="toolsPanelPosition.x"
      :y="toolsPanelPosition.y"
      :width="toolsPanelPosition.width"
      :height="toolsPanelPosition.height"
      overflow="visible"
    >
      <div class="tools-panel-content">
        <button class="tbtn" :class="{ active: currentTool === 'select' }" @click="setCurrentTool('select')" title="选择 (V)">选择</button>
        <Shape v-if="!isAnimationMode"></Shape>
        <button
          v-if="!isAnimationMode"
          class="tbtn"
          :class="{ active: currentTool === 'text' }"
          @click="setCurrentTool('text')"
          title="文字标注 (T)"
        >文字</button>
        <button
          v-if="!isAnimationMode"
          class="tbtn"
          :class="{ active: currentTool === 'eraser' }"
          @click="setCurrentTool('eraser')"
          title="橡皮擦"
        >橡皮</button>
        <button class="tbtn danger" @click="clearBoard" title="清空球员与线条（可撤销）">清空</button>
        <button v-if="boardArea && !isAnimationMode" class="tbtn" @click="captureScreenshot(boardArea)" title="导出 PNG">截图</button>
        <button v-if="!isFullscreen && !globalStore.deviceInfo.isIOS" class="tbtn" @click="fullscreen" title="全屏">全屏</button>
        <button v-if="isFullscreen && !globalStore.deviceInfo.isIOS" class="tbtn" @click="exitFullscreen" title="退出全屏">退出</button>
        <div class="animation-controls" v-if="isAnimationMode">
          <div class="frame-counter">
            <input type="number" v-model="frameInput" @change="switchFrameIndex" class="frame-input" />
            <span class="frame-counter-slash">/</span>
            <span>{{ currentAnimationFrameCount }}</span>
          </div>
          <div class="speed-group" title="播放速度">
            <button
              v-for="s in speedOptions"
              :key="s.label"
              class="speed-btn"
              :class="{ active: frameTime === s.value }"
              @click="setSpeed(s.value)"
            >
              {{ s.label }}
            </button>
          </div>
          <button class="tbtn" @click="addFrame" title="添加帧">加帧</button>
          <button class="tbtn" @click="deleteLastFrame" title="删除最后一帧">删帧</button>
          <button v-show="!isPlaying" class="tbtn accent" @click="togglePlayback" title="播放">播放</button>
          <button v-show="isPlaying" class="tbtn accent" @click="togglePlayback" title="停止">停止</button>
        </div>
        <button v-if="!isAnimationMode" class="tbtn accent" @click="openAnimationFromBoard" title="动画（载入当前阵型）">动画</button>
        <button v-else class="tbtn" @click="exitAnimation" title="退出动画模式">返回</button>
        <button v-if="!isAnimationMode" class="tbtn" :class="{ disabled: !canUndo }" @click="handleUndo" title="撤销">撤销</button>
        <button v-if="!isAnimationMode" class="tbtn" :class="{ disabled: !canRedo }" @click="handleRedo" title="重做">重做</button>
      </div>
    </foreignObject>
  </g>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";
import { onBeforeUnmount, ref, watch, computed } from "vue";
import { captureScreenshot } from "../utils/index";
import { useItemStore } from "../stores/itemStore";
import { useGlobalStore } from "../stores/globalStore";
import { useBoardStore } from "../stores/boardStore";
import { useDrawStore } from "../stores/drawStore";
import Shape from "./drawings/Shape.vue";
import { useAnimationStore } from "../stores/animationStore";
import { useHistory } from "../composables/useHistory";

const globalStore = useGlobalStore();
const itemStore = useItemStore();
const boardStore = useBoardStore();
const drawStore = useDrawStore();
const animationStore = useAnimationStore();
const { handleUndo, handleRedo, canUndo, canRedo, pushHistory } = useHistory();
// 方法可以直接解构
const { toggleFullscreen, setCurrentTool } = globalStore;
const { clearElements } = itemStore;
const { clearDrawings } = drawStore;
const { isAnimationMode, currentFrameIndex, isPlaying, currentAnimationFrameCount } = storeToRefs(animationStore);
const { exitAnimation, switchFrame, togglePlayback } = animationStore;
const { frameTime } = storeToRefs(animationStore);

// 变速：改 frameTime，SMIL 位移动画与循环器同源
const speedOptions = [
  { label: "0.5x", value: 6 },
  { label: "1x", value: 3 },
  { label: "2x", value: 1.5 },
];
const setSpeed = (v: number) => {
  animationStore.frameTime = v;
};

// 动画：把当前场上球员 + 球载入第 0 帧，加帧摆位即播
const openAnimationFromBoard = () => {
  const elements = itemStore.items
    .findByCreationMode("normal")
    .filter((el) => el.elementType === "player" || el.elementType === "ball");
  animationStore.openAnimationFromBoard(elements);
};

// 使用 storeToRefs 保持响应性
const { isFullscreen, currentTool } = storeToRefs(globalStore);
const { boardArea } = storeToRefs(boardStore);

const frameInput = ref(1);
frameInput.value = currentFrameIndex.value + 1;

const toolsPanelPosition = computed(() => {
  if (globalStore.orientation === "landscape") {
    return { x: 1250, y: 0, width: 115, height: 800 };
  }
  // 竖屏：球场下方横条（居中），不再压住顶部教练栏
  return { x: 0, y: 832, width: 1370, height: 100 };
});

const fullscreen = () => {
  const de = document.documentElement;
  if (de.requestFullscreen) {
    de.requestFullscreen();
    // @ts-ignore
  } else if (de.mozRequestFullScreen) {
    // @ts-ignore
    de.mozRequestFullScreen();
    // @ts-ignore
  } else if (de.webkitRequestFullScreen) {
    // @ts-ignore
    de.webkitRequestFullScreen();
  }
  toggleFullscreen(true);
};

const exitFullscreen = () => {
  const de = document;
  if (de.exitFullscreen) {
    de.exitFullscreen();
    // @ts-ignore
  } else if (de.mozCancelFullScreen) {
    // @ts-ignore
    de.mozCancelFullScreen();
    // @ts-ignore
  } else if (de.webkitCancelFullScreen) {
    // @ts-ignore
    de.webkitCancelFullScreen();
  }
  toggleFullscreen(false);
};

const switchFrameIndex = () => {
  if (frameInput.value < 1) {
    frameInput.value = 1;
  }
  if (frameInput.value >= currentAnimationFrameCount.value + 1) {
    frameInput.value = currentAnimationFrameCount.value;
  }
  switchFrame(frameInput.value - 1);
};

const addFrame = () => {
  animationStore.addFrame();
  frameInput.value = currentFrameIndex.value + 1;
};

const deleteLastFrame = () => {
  animationStore.deleteLastFrame();
  if (frameInput.value >= currentAnimationFrameCount.value + 1) {
    frameInput.value = currentAnimationFrameCount.value;
  }
};

const clearBoard = () => {
  if (!confirm("清空场上全部球员与线条？（可撤销）")) return;
  pushHistory();
  clearElements();
  clearDrawings();
};

watch(currentFrameIndex, () => {
  if (isPlaying.value) {
    frameInput.value = currentFrameIndex.value + 1;
  }
});

// 添加组件卸载时的清理逻辑
onBeforeUnmount(() => {
  if (isPlaying.value) {
    animationStore.stopAutoPlay();
  }
});
</script>

<style lang="scss" scoped>
.tools-panel-content {
  height: 100%;
  width: 100%;
  display: flex;
  gap: 8px;
  align-items: stretch;
  justify-content: flex-start;
  padding-top: 10px;

  .tbtn {
    flex-shrink: 0;
  }
}

.animation-controls {
  display: flex;
  align-items: stretch;
  gap: 8px;

  .speed-group {
    display: flex;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 9px;
    padding: 3px;
    gap: 3px;
  }

  .speed-btn {
    border: none;
    background: transparent;
    border-radius: 6px;
    padding: 4px 6px;
    font-size: 12px;
    font-weight: 700;
    color: rgba(248, 250, 245, 0.65);
    cursor: pointer;
    white-space: nowrap;
  }

  .speed-btn.active {
    background: rgba(180, 255, 57, 0.2);
    color: var(--accent, #b4ff39);
  }

  .frame-counter {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 9px;
    padding: 4px 6px;
    color: var(--paper, #f8faf5);
    font-size: 13px;
    font-weight: 700;
  }

  .frame-input {
    width: 30px;
    border: none;
    outline: none;
    text-align: center;
    font-size: 14px;
    font-weight: 700;
    color: var(--paper, #f8faf5);
    background: transparent;
    padding: 2px;
    border-radius: 4px;

    &::-webkit-inner-spin-button,
    &::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
  }

  .frame-counter-slash {
    opacity: 0.6;
    font-size: 13px;
  }
}
</style>
<style lang="scss">
.orientation-landscape {
  .tools-panel-content,
  .animation-controls {
    flex-direction: column;
  }

  .tools-panel-content {
    gap: 20px;
  }

  .tools-panel-content .tbtn {
    width: 100%;
  }
}

.icon-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  cursor: pointer;
  transition: color 0.3s;
  border-radius: 50%;
  background: #ffffff;
  box-shadow:
    18px 26px 13px rgba(0, 0, 0, 0.01),
    10px 15px 11px rgba(0, 0, 0, 0.05),
    5px 7px 8px rgba(0, 0, 0, 0.09),
    1px 2px 4px rgba(0, 0, 0, 0.1);

  &.is-active,
  &:hover {
    background: #c2f4f2;
  }

  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    &:hover {
      background: #ffffff;
    }
  }
}
</style>
