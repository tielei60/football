<template>
  <div
    class="board"
    :class="{ presenting, 'compact-workspace': stacked, 'workspace-fullscreen': isFullscreen && !presenting }"
  >
    <WorkspaceHeader
      v-if="!presenting"
      :compact="compactLayout"
      :roster-open="rosterOpen"
      :tactics-open="tacticsOpen"
      :coaching-open="coachingOpen"
      :saving="saving"
      :active-formation="activeFormation"
      :away-formation="awayCount ? awayFormation || 'custom' : null"
      :player-count="matchStore.playerCount"
      @player-count="onPlayerCountChange"
      @roster="compactLayout ? selectMobileTab('roster') : (rosterOpen = !rosterOpen)"
      @tactics="
        tacticsOpen = !tacticsOpen;
        coachingOpen = false;
      "
      @coaching="
        coachingOpen = !coachingOpen;
        tacticsOpen = false;
      "
      @save="quickSaveFlow"
      @present="enterPresent"
      @demo="onDemoAnimation"
      @flip="flipBoard"
      @formation="onApplyFormation"
      @opponent="onOpponentChange"
    />
    <div class="board-main" :data-panel="mobileTab">
      <MobileWorkspaceTabs
        v-if="stacked"
        :active="mobileTab"
        :open="mobilePanelOpen"
        @change="toggleMobileTab"
        @close="closeMobilePanel"
      />
      <RosterPanel
        id="mobile-roster-panel"
        ref="rosterPanelRef"
        v-show="!stacked || (mobilePanelOpen && mobileTab === 'roster')"
        :open="rosterOpen && !presenting"
      />
      <section class="pitch-workspace" aria-label="战术画布">
        <div v-if="!presenting" class="pitch-heading">
          <div>
            <span class="section-eyebrow">TACTICS BOARD</span>
            <h2>{{ currentTacticTitle }}</h2>
          </div>
          <span class="board-mode">
            <span></span>
            {{ isAnimationMode ? "动画编排" : "战术编辑" }}
          </span>
        </div>
        <div class="pitch-stage">
          <svg
            ref="svgRef"
            id="field"
            width="1250"
            height="826"
            :viewBox="pitchViewBox"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="xMidYMid meet"
            @pointerdown="handlePointerdown"
            @pointermove="handlePointermove"
            @dblclick.stop
            class="field"
          >
            <g
              id="pitch-coordinate-space"
              :data-portrait="portraitPitch"
              :transform="portraitPitch ? 'translate(0 1250) rotate(-90)' : undefined"
            >
              <!-- 球场区域 -->
              <!-- 动态引入球场组件 -->

              <component
                :is="currentFieldComponent"
                @touchmove.prevent.stop
                :style="{ cursor: currentTool === 'eraser' ? `url(${eraserPng}) 4 4, auto` : 'default' }"
              >
                <!-- 非动画模式 -->
                <template v-if="!isAnimationMode">
                  <g id="drawings" v-if="drawings">
                    <Drawing
                      v-for="drawing in drawings.getDrawings()"
                      :key="drawing.id"
                      :drawing="drawing"
                      :portrait="portraitPitch"
                    />
                  </g>
                  <!-- 正在创建的新元素层 -->
                  <g id="drawingLayer"></g>
                  <!-- 球员 -->
                  <g id="players" v-if="normalItems">
                    <ItemComponent
                      v-for="item in normalItems"
                      :key="item.id"
                      :item="item"
                      :compact="stacked"
                      :portrait="portraitPitch"
                      @select-player="onSelectPlayer"
                    />
                  </g>
                </template>
                <!-- 动画模式 -->
                <template v-else>
                  <!-- 播放动画时的图层 -->
                  <!-- 播放动画是从上一帧位置移动到当前帧位置，所以一开始需要显示上一帧的元素 -->
                  <g id="trails" v-if="animationStore.showTrails" pointer-events="none">
                    <path
                      v-for="tr in activeTrails"
                      :key="tr.id"
                      :d="tr.d"
                      fill="none"
                      :stroke="tr.ball ? '#287fbc' : tr.away ? '#7c8590' : '#bf5a45'"
                      :stroke-width="tr.ball ? 4 : 2.5"
                      stroke-linecap="round"
                      :stroke-dasharray="tr.ball ? undefined : '8 7'"
                      opacity="0.75"
                    />
                  </g>
                  <template v-if="animationStore.canEdit && animationStore.showTrails">
                    <!-- 创建动画时的图层 -->
                    <!-- 和上一帧之间的曲线路径 -->
                    <g id="paths" v-for="item in animationItems" :key="`path-${item.id}`" style="z-index: 1">
                      <path
                        v-if="showPath(item)"
                        :d="pathData(item)"
                        stroke="rgba(0,0,0,0.2)"
                        fill="none"
                        stroke-dasharray="5,5"
                        stroke-width="4"
                      />
                      <!-- 控制点 -->
                      <circle
                        v-if="currentFrameIndex !== 0"
                        :cx="pathControlPoint(item)?.x"
                        :cy="pathControlPoint(item)?.y"
                        r="5"
                        fill="red"
                        @pointerdown="startDragControlPoint(item, $event)"
                      />
                    </g>
                    <!-- 上一帧球员 -->
                  </template>
                  <g id="players">
                    <ItemComponent
                      v-for="item in animationStore.displayElements"
                      :key="item.id"
                      :item="item"
                      :portrait="portraitPitch"
                    />
                  </g>
                </template>
                <!-- 水印 -->
                <template v-if="showWatermark" #watermark>
                  <Watermark
                    :text="`柏林花园FC · ${matchStore.playerCount}人制战术板`"
                    :x="portraitPitch ? 110 : 950"
                    :y="portraitPitch ? 413 : 730"
                    :transform="portraitPitch ? 'rotate(90 110 413)' : undefined"
                  />
                </template>
              </component>

              <!-- 正在移动的新元素 -->
              <g
                v-if="!presenting && (!isAnimationMode || animationStore.canEdit)"
                id="toolbar-drag"
                @touchmove.prevent
              >
                <DragToolsPanel :portrait="portraitPitch" />
              </g>
              <g id="tools-panel">
                <ItemComponent v-if="newDraggingItem" :item="newDraggingItem" :portrait="portraitPitch" />
              </g>
            </g>
            <!--
      <circle
        v-if="eraserCursorPos"
        :cx="eraserCursorPos.x"
        :cy="eraserCursorPos.y"
        r="20"
        fill="rgba(255,0,0,0.3)"
        stroke="red"
        stroke-width="2"
        pointer-events="none"
      /> -->
          </svg>
        </div>
        <div v-if="!presenting" class="pitch-footer">
          <div class="pitch-legend">
            <span>
              <i class="home-dot"></i>
              主队 {{ homeCount }}
            </span>
            <span>
              <i class="away-dot"></i>
              对手 {{ awayCount }}
            </span>
            <span class="pitch-size">{{ matchStore.playerCount }} 人制</span>
          </div>
          <div class="view-controls">
            <button @click="zoomStep(1.25)" :disabled="view.w >= 1250" title="缩小" aria-label="缩小">
              <ZoomOut :size="17" />
            </button>
            <output aria-label="缩放比例">{{ Math.round((1250 / view.w) * 100) }}%</output>
            <button @click="zoomStep(1 / 1.25)" :disabled="view.w <= 420" title="放大" aria-label="放大">
              <ZoomIn :size="17" />
            </button>
            <button @click="resetView" title="适应全场" aria-label="适应全场"><Scan :size="17" /></button>
            <button
              :aria-pressed="half"
              :class="{ active: half }"
              @click="half ? resetView() : setHalfView()"
              title="半场视图"
              aria-label="半场视图"
            >
              <Columns2 :size="17" />
            </button>
            <button
              @click="toggleFullscreen"
              :disabled="fullscreenBusy"
              :aria-pressed="isFullscreen"
              :title="isFullscreen ? '退出全屏' : '全屏'"
              :aria-label="isFullscreen ? '退出全屏' : '全屏'"
              :class="{ active: isFullscreen }"
            >
              <component :is="isFullscreen ? Minimize : Maximize" :size="17" />
            </button>
          </div>
        </div>
        <AnimationTimeline
          v-if="isAnimationMode && !stacked"
          :presenting="presenting"
          :saving="saving"
          @save="quickSaveFlow"
          @scenario="onDemoAnimation"
        />
      </section>
      <BoardTools
        id="mobile-drawing-panel"
        v-if="!presenting"
        :compact="stacked"
        v-show="!stacked || (mobilePanelOpen && mobileTab === 'drawing')"
        :fullscreen="isFullscreen"
        :fullscreen-busy="fullscreenBusy"
        @fullscreen="toggleFullscreen"
      />
      <AnimationTimeline
        id="mobile-animation-panel"
        v-if="stacked && isAnimationMode"
        v-show="mobilePanelOpen && mobileTab === 'animation'"
        :presenting="false"
        :saving="saving"
        @save="quickSaveFlow"
        @scenario="onDemoAnimation"
      />
    </div>
    <!-- 演示模式大标题 -->
    <div v-if="presenting" class="present-overlay">
      <div class="present-title">{{ presentTitle }}</div>
      <div class="present-sub">{{ presentSub }}</div>
      <div class="present-actions">
        <button @click="stepPresent(-1)" aria-label="上一套战术" title="上一套战术"><ChevronLeft :size="20" /></button>
        <button @click="exitPresent">退出演示</button>
        <button @click="stepPresent(1)" aria-label="下一套战术" title="下一套战术"><ChevronRight :size="20" /></button>
      </div>
    </div>
    <TacticsPanel :open="tacticsOpen && !presenting" @close="tacticsOpen = false" />
    <CoachingPanel
      :open="coachingOpen && !presenting"
      :saving="saving"
      @close="coachingOpen = false"
      @save="quickSaveFlow"
    />
    <PrintSheet :tactic="printSource" :note="printNote" />
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import type { Component } from "vue";
import { storeToRefs } from "pinia";
import { GAME_CONSTANTS } from "../constants";
// 组件导入
import ItemComponent from "@/components/Item.vue";
import RosterPanel from "@/components/RosterPanel.vue";
import TacticsPanel from "@/components/TacticsPanel.vue";
import CoachingPanel from "@/components/CoachingPanel.vue";
import AnimationTimeline from "@/components/AnimationTimeline.vue";
import PrintSheet from "@/components/PrintSheet.vue";
import { ZoomIn, ZoomOut, Maximize, Minimize, Scan, Columns2, ChevronLeft, ChevronRight } from "lucide-vue-next";
import { ElMessage } from "element-plus";
import BoardTools from "@/components/BoardTools.vue";
import WorkspaceHeader from "@/components/WorkspaceHeader.vue";
import DragToolsPanel from "@/components/DragToolsPanel.vue";
import FootballField from "@/components/fields/FootballField.vue";
import EightField from "@/components/fields/EightField.vue";
import Watermark from "@/components/common/Watermark.vue";
import Drawing from "@/components/drawings/Drawing.vue";
import eraserPng from "@/assets/icons/eraser.png";

// Store 导入
import { useItemStore } from "../stores/itemStore";
import { useGlobalStore } from "../stores/globalStore";
import { useBoardStore } from "../stores/boardStore";
import { useDrawStore } from "../stores/drawStore";
import { useAnimationStore } from "../stores/animationStore";

// Composables 导入
import { useDrawing } from "../composables/useDrawing";
import { usePath } from "../composables/usePath";
import { useEraser } from "../composables/useEraser";
import { useFormation } from "../composables/useFormation";
import { useHistory } from "../composables/useHistory";
import { useTacticsStore } from "../stores/tacticsStore";
import { RUN_LINE_CONFIG, PASS_LINE_CONFIG } from "../constants";
import { useCoachingDeskStore } from "../stores/coachingDeskStore";
import { useRosterStore } from "../stores/rosterStore";
import { TACTICAL_SCENARIOS } from "@/data/tacticalScenarios";
import { useCoachingStore } from "@/stores/coachingStore";
import { useMatchStore } from "@/stores/matchStore";
import { useWorkspaceFullscreen } from "@/composables/useWorkspaceFullscreen";
import { useMediaQuery } from "@vueuse/core";
import MobileWorkspaceTabs, { type WorkspaceTab } from "@/components/MobileWorkspaceTabs.vue";
import { MATCH_FORMATIONS, type MatchPlayerCount } from "@/data/matchFormats";

// 组合式函数初始化
const { startDrawing } = useDrawing();
const { showPath, pathData, pathControlPoint, startDragControlPoint } = usePath();
const { beginErasing } = useEraser();
const { applyFormation, applyOpponent, changePlayerCount, clearOpponents, flipBoard } = useFormation();
const { handleUndo, handleRedo } = useHistory();

// Store 初始化
const globalStore = useGlobalStore();
const itemStore = useItemStore();
const boardStore = useBoardStore();
const drawStore = useDrawStore();
const animationStore = useAnimationStore();
const tacticsStore = useTacticsStore();
const rosterStore = useRosterStore();
const matchStore = useMatchStore();
const { isFullscreen, fullscreenBusy, toggleFullscreen, exitFullscreen } = useWorkspaceFullscreen();
const compactLayout = useMediaQuery("(max-width: 700px), (max-width: 1100px) and (orientation: portrait)");
const portraitPitch = useMediaQuery("(max-width: 1100px) and (orientation: portrait)");
const pitchViewBox = computed(() => {
  const v = boardStore.view;
  return portraitPitch.value ? `${v.y} ${1250 - v.x - v.w} ${v.h} ${v.w}` : `${v.x} ${v.y} ${v.w} ${v.h}`;
});
const stacked = computed(() => compactLayout.value && !isFullscreen.value && !presenting.value);
const mobileTab = ref<WorkspaceTab>("roster");
const mobilePanelOpen = shallowRef(false);
const closeMobilePanel = () => {
  mobilePanelOpen.value = false;
};
const toggleMobileTab = (tab: WorkspaceTab) => {
  if (mobilePanelOpen.value && mobileTab.value === tab) closeMobilePanel();
  else selectMobileTab(tab);
};
const rosterPanelRef = ref<InstanceType<typeof RosterPanel> | null>(null);
const onSelectPlayer = async (id: string) => {
  selectMobileTab("roster");
  await nextTick();
  rosterPanelRef.value?.focusPlayer(id);
};
const selectMobileTab = (tab: WorkspaceTab) => {
  mobilePanelOpen.value = true;
  mobileTab.value = tab;
  if (tab === "animation") {
    animationStore.openAnimationFromBoard(
      itemStore.items
        .findByCreationMode("normal")
        .filter((el) => el.elementType === "player" || el.elementType === "ball")
    );
  } else {
    if (animationStore.isAnimationMode) animationStore.exitAnimation();
    if (tab === "roster") rosterOpen.value = true;
    globalStore.setCurrentTool("select");
  }
};
watch(
  () => animationStore.isAnimationMode,
  (active) => {
    if (active) mobileTab.value = "animation";
    else if (mobileTab.value === "animation") mobileTab.value = "drawing";
  }
);

// Store 状态和方法解构
const { items, newDraggingItem } = storeToRefs(itemStore);
const { drawings } = storeToRefs(drawStore);
const { isAnimationMode, currentFrameIndex, currentFrameElements, currentAnimation } = storeToRefs(animationStore);
const { currentTool, presenting } = storeToRefs(globalStore);
const { printSource, printNote } = storeToRefs(tacticsStore);
const { view, half } = storeToRefs(boardStore);
const { zoomAt, zoomStep, resetView, setHalfView } = boardStore;

// 播放中的跑位轨迹：本次跳变涉及的行为画虚线
const activeTrails = computed(() => animationStore.transitionPaths);

// 打印：战术库点打印后渲染 PrintSheet，下一帧调起系统打印，打印完清空
watch(printSource, async (v) => {
  if (v) {
    await nextTick();
    window.print();
  }
});

const svgRef = ref<SVGSVGElement | null>(null);
const currentFieldType = ref("eight");
const eraserCursorPos = ref<{ x: number; y: number } | null>(null); // 橡皮擦坐标

// 场地组件注册
const fieldComponents: Record<string, Component> = {
  eight: EightField,
  football: FootballField,
  // 在这里添加更多场地类型
};

// 计算属性
const currentFieldComponent = computed(() => fieldComponents[currentFieldType.value]);

const normalItems = computed(() => items.value.findByCreationMode("normal"));
const homeCount = computed(
  () =>
    (isAnimationMode.value ? currentFrameElements.value : normalItems.value).filter(
      (el) => el.elementType === "player" && el.team !== "away"
    ).length
);
const awayCount = computed(
  () =>
    (isAnimationMode.value ? currentFrameElements.value : normalItems.value).filter(
      (el) => el.elementType === "player" && el.team === "away"
    ).length
);
const currentTacticTitle = computed(
  () => tacticsStore.tactics.find((t) => t.id === tacticsStore.currentId)?.title || "比赛战术板"
);

const animationItems = computed(() => currentFrameElements.value);

const showWatermark = GAME_CONSTANTS.showWatermark;

// 一键阵型
const activeFormation = ref<string | null>(null);
const awayFormation = ref<string | null>(null);
const rosterOpen = ref(true);
const tacticsOpen = ref(false);
const coachingOpen = ref(false);
const onApplyFormation = (id: string) => {
  applyFormation(id);
  activeFormation.value = id;
};

const onApplyOpponent = (id: string) => {
  applyOpponent(id);
  awayFormation.value = id;
};

const onClearOpponents = () => {
  clearOpponents();
  awayFormation.value = null;
};
const onOpponentChange = (id: string) => (id ? onApplyOpponent(id) : onClearOpponents());
const onPlayerCountChange = (count: MatchPlayerCount) => {
  changePlayerCount(count);
  activeFormation.value = MATCH_FORMATIONS[count][0].id;
  awayFormation.value = awayCount.value ? MATCH_FORMATIONS[count][0].id : null;
};
watch(
  () => matchStore.playerCount,
  () => {
    activeFormation.value = null;
    awayFormation.value = null;
  },
  { flush: "sync" }
);

// 一键动态演示：名单前 8 人真名，边路套路自动播放
const onDemoAnimation = (id = "cross") => {
  if (currentAnimation.value && !confirm("载入场景将替换当前动画和训练计划，是否继续？")) return;
  if (matchStore.playerCount !== 8) {
    ElMessage({ message: "预置动态演示适用于 8 人制，请先切换比赛人数。", type: "info" });
    return;
  }
  const healthy = rosterStore.players.filter((p) => !p.status || p.status === "ok");
  const selected = healthy.filter((p) => p.fieldId !== null);
  const squad = [...selected, ...healthy.filter((p) => p.fieldId === null)].slice(0, 8);
  animationStore.loadDemoAnimation(squad, id);
  const scenario = TACTICAL_SCENARIOS.find((s) => s.id === id) ?? TACTICAL_SCENARIOS[0];
  useCoachingStore().plan = {
    objective: scenario.objective,
    instructions: scenario.phases.map((p) => `${p.title}：${p.note}`).join("\n"),
    durationMinutes: 20,
  };
  rosterOpen.value = false;
};

// 演示模式：F 进入/退出，空格/→下一套，←上一套，Esc 退出
const presentIndex = ref(0);
const presentTitle = computed(() => {
  return isAnimationMode.value ? currentAnimation.value?.name || "战术动画" : currentTacticTitle.value;
});
const presentSub = computed(() => {
  const list = tacticsStore.tactics;
  if (useCoachingStore().plan.objective) return useCoachingStore().plan.objective;
  if (!list.length) return `柏林花园 FC · ${matchStore.playerCount} 人制`;
  const t = list[presentIndex.value] ?? list[0];
  const match = [t.match?.opponent, t.match?.date, t.match?.score].filter(Boolean).join(" · ");
  const paging = `${presentIndex.value + 1} / ${list.length}`;
  return match ? `${match} ｜ ${paging}` : paging;
});

const enterPresent = async () => {
  await tacticsStore.refresh();
  const idx = tacticsStore.tactics.findIndex((t) => t.id === tacticsStore.currentId);
  presentIndex.value = idx >= 0 ? idx : 0;
  globalStore.setPresenting(true);
  document.documentElement.requestFullscreen?.().catch(() => {});
};

const exitPresent = () => {
  globalStore.setPresenting(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
};

const stepPresent = async (delta: number) => {
  const list = tacticsStore.tactics;
  if (!list.length) return;
  presentIndex.value = (presentIndex.value + delta + list.length) % list.length;
  await tacticsStore.loadTactic(list[presentIndex.value].id!);
  if (animationStore.currentAnimationFrameCount > 1) animationStore.openAnimation();
};

// 快捷键：V选择 / A跑位虚线 / S传球实线 / Z区域 / T文字 / F演示 / Esc回选择 / Ctrl+S保存
const saving = ref(false);
const quickSaveFlow = async () => {
  if (saving.value) return;
  saving.value = true;
  try {
    const msg = await tacticsStore.quickSave();
    await useCoachingDeskStore().flush();
    ElMessage({ message: msg, type: "success", duration: 2000 });
  } catch (error) {
    ElMessage({ message: error instanceof Error ? error.message : "保存失败", type: "error", duration: 3000 });
  } finally {
    saving.value = false;
  }
};

const handleShortcut = (e: KeyboardEvent) => {
  const target = e.target as HTMLElement | null;
  const inInput =
    !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
  const mod = e.ctrlKey || e.metaKey;
  if (inInput) {
    // 输入框里只放行 Esc 失焦与 Ctrl+S 保存，其余单键留给输入法
    if (e.key === "Escape") target.blur();
    else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void quickSaveFlow();
    }
    return;
  }
  if (presenting.value) {
    if (e.key.toLowerCase() === "f" || e.key === "Escape") exitPresent();
    else if (isAnimationMode.value && [" ", "ArrowRight", "ArrowLeft"].includes(e.key)) {
      e.preventDefault();
      if (e.key === " ") animationStore.togglePlayback();
      else animationStore.switchFrame(currentFrameIndex.value + (e.key === "ArrowRight" ? 1 : -1));
    } else if (e.key === " " || e.key === "ArrowRight") {
      e.preventDefault();
      stepPresent(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepPresent(-1);
    }
    return;
  }
  if (mod) {
    if (isAnimationMode.value && ["z", "y"].includes(e.key.toLowerCase())) return;
    if (e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
    } else if (e.key.toLowerCase() === "y") {
      e.preventDefault();
      handleRedo();
    } else if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      void quickSaveFlow();
    }
    return;
  }
  if (e.key === "Escape") {
    closeMobilePanel();
    if (isFullscreen.value) void exitFullscreen();
    tacticsOpen.value = false;
    coachingOpen.value = false;
    globalStore.setCurrentTool("select");
    return;
  }
  if (isAnimationMode.value) {
    if (e.key === " ") {
      e.preventDefault();
      animationStore.togglePlayback();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      animationStore.switchFrame(currentFrameIndex.value + (e.key === "ArrowRight" ? 1 : -1));
    } else if (e.key.toLowerCase() === "f") enterPresent();
    return;
  }
  switch (e.key.toLowerCase()) {
    case "v":
      globalStore.setCurrentTool("select");
      break;
    case "a":
      // 跑位线：红色虚线箭头
      drawStore.drawingConfig.type = RUN_LINE_CONFIG.shape;
      drawStore.drawingConfig.dashed = true;
      drawStore.drawingConfig.strokeColor = RUN_LINE_CONFIG.strokeColor;
      globalStore.setCurrentTool("shape");
      break;
    case "s":
      // 传球线：深色实线箭头
      drawStore.drawingConfig.type = PASS_LINE_CONFIG.shape;
      drawStore.drawingConfig.dashed = false;
      drawStore.drawingConfig.strokeColor = PASS_LINE_CONFIG.strokeColor;
      globalStore.setCurrentTool("shape");
      break;
    case "z":
      drawStore.drawingConfig.type = "rectangle";
      drawStore.drawingConfig.dashed = false;
      globalStore.setCurrentTool("shape");
      break;
    case "t":
      globalStore.setCurrentTool("text");
      break;
    case "f":
      enterPresent();
      break;
    default:
      break;
  }
};

// 滚轮缩放：以光标为中心（竖屏触摸保持页面滚动，不拦截）
const handleWheel = (e: WheelEvent) => {
  e.preventDefault();
  const pt = boardStore.getSvgPosition(e as unknown as PointerEvent);
  zoomAt(pt.x, pt.y, e.deltaY > 0 ? 1.15 : 1 / 1.15);
};

const handlePointerdown = (e: PointerEvent) => {
  if (currentTool.value === "eraser") {
    return beginErasing(e);
  }
  return startDrawing(e);
};

const handlePointermove = (e: PointerEvent) => {
  if (currentTool.value === "eraser") {
    const svg = svgRef.value;
    if (svg) {
      const svgPoint = boardStore.getSvgPosition(e);
      eraserCursorPos.value = { x: svgPoint.x, y: svgPoint.y };
    }
  } else {
    eraserCursorPos.value = null;
  }
};

onMounted(() => {
  if (svgRef.value) {
    boardStore.setBoardArea(svgRef.value.getElementById("board-area") as SVGGraphicsElement);
    boardStore.setSvgElement(svgRef.value);
  }
  // 投屏深绿主题：只在战术板页生效，离开恢复
  document.body.classList.add("coach");
  window.addEventListener("keydown", handleShortcut);
  window.addEventListener("afterprint", tacticsStore.clearPrint);
  svgRef.value?.addEventListener("wheel", handleWheel, { passive: false });
});

onUnmounted(() => {
  animationStore.stopAutoPlay();
  globalStore.setPresenting(false);
  window.removeEventListener("keydown", handleShortcut);
  window.removeEventListener("afterprint", tacticsStore.clearPrint);
  svgRef.value?.removeEventListener("wheel", handleWheel);
  document.body.classList.remove("coach");
});
</script>

<style src="@/assets/styles/workspace.css"></style>
