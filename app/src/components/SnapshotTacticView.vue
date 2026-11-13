<template>
  <details class="snapshot-tactic">
    <summary>查看已保存战术：{{ tactic.title }}</summary>
    <p class="club-muted">
      {{ tactic.board.playerCount ?? 8 }} 人制 · {{ tactic.formationName || "自定义阵型" }} · 只读快照
    </p>
    <label v-if="stages.length" style="max-width: 320px; margin-bottom: 14px">
      战术演示步骤
      <UiSelect v-model.number="stageIndex">
        <option :value="-1">初始战术画布</option>
        <option v-for="(stage, index) in stages" :key="index" :value="index">
          {{ index + 1 }} · {{ stage.title || "未命名步骤" }}
        </option>
      </UiSelect>
    </label>
    <p v-if="stageIndex >= 0" style="white-space: pre-wrap">{{ stages[stageIndex]?.note }}</p>
    <div class="club-actions" style="margin-bottom: 10px">
      <button type="button" :aria-pressed="zoomed" @click="zoomed = !zoomed">
        {{ zoomed ? "适应宽度" : "放大画布" }}
      </button>
      <span class="club-muted">
        {{ zoomed ? "已放大，可左右滑动或使用方向键查看。" : "小屏可放大查看球员姓名与站位。" }}
      </span>
    </div>
    <div
      class="snapshot-canvas"
      :class="{ 'snapshot-canvas--zoomed': zoomed }"
      role="region"
      :aria-label="`${tactic.title}画布滚动区域`"
      :tabindex="zoomed ? 0 : undefined"
    >
      <svg
        viewBox="0 0 1250 826"
        role="img"
        :aria-label="`${tactic.title}已保存战术画布`"
        style="display: block; background: var(--pitch-apron); border-radius: 8px"
      >
        <rect
          x="68"
          y="62"
          width="1115"
          height="701"
          fill="var(--pitch-bg)"
          stroke="var(--pitch-line)"
          stroke-width="3"
        />
        <path
          d="M625 62V763 M68 230H245V595H68 M1183 230H1006V595H1183"
          fill="none"
          stroke="var(--pitch-line)"
          stroke-width="3"
        />
        <circle cx="625" cy="412" r="90" fill="none" stroke="var(--pitch-line)" stroke-width="3" />
        <g ref="markings" v-show="stageIndex < 0" />
        <g
          v-for="piece in pieces"
          :key="piece.pieceId"
          :data-piece-id="piece.pieceId"
          :transform="`translate(${piece.x} ${piece.y})`"
        >
          <circle
            :r="piece.kind === 'ball' ? 12 : piece.radius || 24"
            :fill="
              piece.kind === 'ball'
                ? 'var(--color-surface)'
                : piece.color || (piece.team === 'away' ? 'var(--pitch-player-away)' : 'var(--pitch-player-home)')
            "
            :stroke="
              contrastingInk(
                piece.kind === 'ball'
                  ? 'var(--color-surface)'
                  : piece.color || (piece.team === 'away' ? 'var(--pitch-player-away)' : 'var(--pitch-player-home)')
              )
            "
            stroke-width="3"
          />
          <text
            v-if="piece.kind !== 'ball'"
            text-anchor="middle"
            dominant-baseline="central"
            :fill="
              contrastingInk(
                piece.color || (piece.team === 'away' ? 'var(--pitch-player-away)' : 'var(--pitch-player-home)')
              )
            "
            font-size="21"
            font-weight="700"
          >
            {{ piece.shirtNumber ?? "?" }}
          </text>
          <text
            v-if="piece.label"
            y="-34"
            text-anchor="middle"
            fill="var(--pitch-label)"
            font-size="22"
            font-weight="700"
          >
            {{ piece.label }}
          </text>
          <text v-if="piece.position" y="48" text-anchor="middle" fill="var(--pitch-label)" font-size="18">
            {{ piece.position }}
          </text>
        </g>
      </svg>
    </div>
    <p v-if="tactic.board.trainingPlan?.objective" style="white-space: pre-wrap">
      {{ tactic.board.trainingPlan.objective }}
    </p>
    <p v-if="tactic.board.trainingPlan?.instructions" style="white-space: pre-wrap">
      {{ tactic.board.trainingPlan.instructions }}
    </p>
    <p class="club-muted">球员、号码、站位、标注和演示步骤均来自本场保存内容。</p>
  </details>
</template>
<script setup lang="ts">
import { contrastingInk } from "@/utils/displayContrast";
import { computed, onMounted, ref, watch } from "vue";
import rough from "roughjs";
import type { Tactic } from "@/services/tacticLanguage";
import { renderShape } from "@/utils/drawing";

const props = defineProps<{ tactic: Tactic }>();
const stageIndex = ref(-1);
const zoomed = ref(false);
const markings = ref<SVGGElement | null>(null);
const stages = computed(() => props.tactic.board.demonstration?.stages ?? []);
const pieces = computed(() => {
  const board = props.tactic.board;
  if (stageIndex.value < 0) return board.pieces;
  const stage = stages.value[stageIndex.value];
  return (board.demonstration?.participants ?? []).flatMap((piece) => {
    const position = stage?.positions.find((p) => p.pieceId === piece.pieceId);
    return position ? [{ ...piece, x: position.x, y: position.y }] : [];
  });
});
function draw() {
  const target = markings.value;
  if (!target) return;
  target.replaceChildren();
  if (!target.ownerSVGElement) return;
  const rc = rough.svg(target.ownerSVGElement);
  props.tactic.board.markings.forEach((m) => {
    const shape = renderShape(
      rc,
      m.kind,
      { startX: m.startX, startY: m.startY, endX: m.endX, endY: m.endY, pathPoints: m.path },
      {
        strokeColor: m.strokeColor || m.color || "white",
        backgroundColor: m.backgroundColor || "transparent",
        size: m.width || 2,
        dashed: m.dashed,
        text: m.label,
      }
    );
    if (shape) target.appendChild(shape);
  });
}
onMounted(draw);
watch(
  () => props.tactic,
  () => {
    stageIndex.value = -1;
    draw();
  },
  { deep: true }
);
</script>
<style scoped>
.snapshot-canvas {
  max-width: 100%;
  overflow: auto;
}
.snapshot-canvas svg {
  width: 100%;
}
.snapshot-canvas--zoomed svg {
  min-width: 920px;
  width: 150%;
}
.snapshot-canvas:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}

summary {
  cursor: pointer;
  font-size: 18px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
summary:focus-visible {
  outline: 3px solid var(--color-focus);
  outline-offset: 3px;
}
</style>
