<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { Play, Pause, SkipBack, SkipForward, RotateCcw, Plus, Trash2, Save, Clock3 } from "lucide-vue-next";
import { useMatchStore } from "@/stores/matchStore";
import { useAnimationStore } from "@/stores/animationStore";
import { TACTICAL_SCENARIOS } from "@/data/tacticalScenarios";

defineProps<{ presenting: boolean; saving: boolean }>();
const emit = defineEmits<{ save: []; scenario: [id: string] }>();
const store = useAnimationStore();
const match = useMatchStore();
const {
  currentAnimation,
  currentFrameIndex,
  currentAnimationFrameCount,
  isPlaying,
  frameTime,
  loop,
  showTrails,
  playhead,
  totalDuration,
  canEdit,
} = storeToRefs(store);
const frame = computed(() => currentAnimation.value?.frames[currentFrameIndex.value]);
const scenarioId = computed(() => TACTICAL_SCENARIOS.find((s) => s.title === currentAnimation.value?.name)?.id ?? "");
const inputValue = (event: Event) => (event.target as HTMLInputElement).value;
const selectFrame = (event: Event) =>
  store.switchFrame(
    Math.max(0, Math.min(currentAnimationFrameCount.value - 1, Math.trunc(Number(inputValue(event)) || 1) - 1))
  );
const time = (seconds: number) => `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
</script>

<template>
  <section class="animation-timeline" aria-label="动画编排">
    <div class="timeline-heading">
      <strong class="timeline-title">{{ currentAnimation?.name || "自定义战术" }}</strong>
      <select
        v-if="!presenting"
        aria-label="演示场景"
        :disabled="match.playerCount !== 8"
        :title="match.playerCount === 8 ? '选择预置演示' : '预置演示仅适用于 8 人制；其他赛制可自定义动画'"
        :value="scenarioId"
        @change="emit('scenario', inputValue($event))"
      >
        <option value="" disabled>{{ match.playerCount === 8 ? "选择演示场景" : "预置演示仅限 8 人制" }}</option>
        <option v-for="scenario in TACTICAL_SCENARIOS" :key="scenario.id" :value="scenario.id">
          {{ scenario.title }}
        </option>
      </select>
      <span class="timeline-total">
        <Clock3 :size="14" aria-hidden="true" />
        {{ currentAnimationFrameCount }} 步 · {{ totalDuration.toFixed(1) }} 秒
      </span>
    </div>
    <div class="timeline-transport">
      <div class="transport-buttons">
        <button aria-label="从头开始" title="从头开始" @click="store.seek(0)"><RotateCcw :size="17" /></button>
        <button
          aria-label="上一步"
          title="上一步"
          :disabled="currentFrameIndex === 0"
          @click="store.switchFrame(currentFrameIndex - 1)"
        >
          <SkipBack :size="17" />
        </button>
        <button
          class="play-button"
          :aria-label="isPlaying ? '暂停动画' : '播放动画'"
          :title="isPlaying ? '暂停动画' : '播放动画'"
          :disabled="currentAnimationFrameCount < 2"
          @click="store.togglePlayback()"
        >
          <component :is="isPlaying ? Pause : Play" :size="19" />
        </button>
        <button
          aria-label="下一步"
          title="下一步"
          :disabled="currentFrameIndex >= currentAnimationFrameCount - 1"
          @click="store.switchFrame(currentFrameIndex + 1)"
        >
          <SkipForward :size="17" />
        </button>
      </div>
      <input
        class="time-slider"
        type="range"
        min="0"
        :max="totalDuration"
        step="0.01"
        :value="playhead"
        :disabled="totalDuration === 0"
        aria-label="动画进度"
        @input="store.seek(Number(inputValue($event)))"
      />
      <output class="time-readout">{{ time(playhead) }} / {{ time(totalDuration) }}</output>
      <select v-model.number="frameTime" aria-label="播放速度">
        <option :value="6">0.5x</option>
        <option :value="3">1x</option>
        <option :value="1.5">2x</option>
      </select>
      <label class="toggle">
        <input v-model="loop" type="checkbox" />
        循环播放
      </label>
      <label class="toggle">
        <input v-model="showTrails" type="checkbox" />
        轨迹
      </label>
    </div>
    <div class="timeline-steps" aria-label="战术步骤">
      <button
        v-for="(step, index) in currentAnimation?.frames"
        :key="index"
        class="timeline-step"
        :class="{ selected: index === currentFrameIndex }"
        :aria-pressed="index === currentFrameIndex"
        @click="store.switchFrame(index)"
      >
        <span class="step-number">{{ String(index + 1).padStart(2, "0") }}</span>
        <span class="step-name">{{ step.title || `步骤 ${index + 1}` }}</span>
        <small>{{ index === 0 ? "起点" : `${step.duration ?? 3} 秒` }}</small>
      </button>
    </div>
    <p v-if="presenting" class="step-brief">{{ frame?.note }}</p>
    <div v-else class="step-editor">
      <label class="step-index">
        当前帧
        <input
          type="number"
          aria-label="当前帧"
          min="1"
          :max="currentAnimationFrameCount"
          :value="currentFrameIndex + 1"
          @change="selectFrame"
        />
      </label>
      <label class="step-title">
        步骤名称
        <input
          :value="frame?.title"
          maxlength="60"
          :disabled="!canEdit"
          @input="store.updateFrame({ title: inputValue($event) })"
        />
      </label>
      <label class="step-duration">
        过渡时长（秒）
        <input
          type="number"
          :value="frame?.duration ?? 3"
          min="0.5"
          max="30"
          step="0.5"
          :disabled="!canEdit || currentFrameIndex === 0"
          @change="store.updateFrame({ duration: Number(inputValue($event)) })"
        />
      </label>
      <label class="step-note">
        步骤要点
        <textarea
          :value="frame?.note"
          maxlength="1000"
          rows="2"
          :disabled="!canEdit"
          @input="store.updateFrame({ note: inputValue($event) })"
        />
      </label>
      <div class="step-actions">
        <button
          aria-label="添加帧"
          title="在当前步骤后添加"
          :disabled="!canEdit || currentAnimationFrameCount >= 120"
          @click="store.addFrame()"
        >
          <Plus :size="18" />
        </button>
        <button
          aria-label="删除当前步骤"
          title="删除当前步骤"
          :disabled="!canEdit || currentAnimationFrameCount <= 1"
          @click="store.deleteFrame()"
        >
          <Trash2 :size="17" />
        </button>
        <button aria-label="保存动画" title="保存动画与战术" :disabled="saving" @click="emit('save')">
          <Save :size="18" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.animation-timeline {
  flex-shrink: 0;
  padding: 14px 24px 16px;
  border-top: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
}
.timeline-heading,
.timeline-transport {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.timeline-heading {
  margin-bottom: 10px;
}
.timeline-title {
  font-size: 14px;
  overflow-wrap: anywhere;
}
.timeline-total {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--muted);
  white-space: nowrap;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 34px;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--muted);
  background: white;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: var(--green-soft);
  color: var(--pitch-700);
}
button.play-button {
  color: white;
  background: var(--pitch-700);
  border-color: var(--pitch-700);
}
.transport-buttons {
  display: flex;
  gap: 4px;
}
.time-slider {
  flex: 1;
  min-width: 100px;
  height: 24px;
  accent-color: var(--pitch-700);
  padding: 0;
  cursor: pointer;
}
.time-readout {
  font: 11px var(--font-num);
  min-width: 96px;
  text-align: center;
  white-space: nowrap;
}
select {
  border: 1px solid var(--line);
  border-radius: 4px;
  min-height: 32px;
  padding: 3px 6px;
  color: var(--ink);
  background: white;
  font-size: 12px;
  max-width: 100%;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  font-size: 12px;
  color: var(--muted);
}
.toggle input {
  accent-color: var(--pitch-700);
}
.timeline-steps {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 12px 2px 10px;
}
button.timeline-step {
  height: 48px;
  flex: 1 0 150px;
  max-width: 240px;
  justify-content: flex-start;
  gap: 9px;
  text-align: left;
  border-radius: 5px;
}
.timeline-step.selected {
  background: var(--green-soft);
  border-color: #8bb9a5;
  color: var(--pitch-700);
}
.step-number {
  font: 600 12px var(--font-num);
}
.step-name {
  font-size: 12px;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.timeline-step small {
  font-size: 10px;
  white-space: nowrap;
  color: var(--muted);
}
.step-editor {
  display: grid;
  grid-template-columns: 60px minmax(110px, 1fr) 95px minmax(180px, 2fr) auto;
  gap: 10px;
  align-items: end;
}
.step-editor label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 11px;
  color: var(--muted);
  min-width: 0;
}
.step-editor input,
textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 6px 8px;
  color: var(--ink);
  background: white;
  font: 12px/1.5 var(--font-stack);
}
.step-editor input {
  height: 36px;
}
textarea {
  height: 54px;
  resize: vertical;
}
.step-actions {
  display: flex;
  gap: 4px;
}
.step-brief {
  margin: 5px 0 0;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
}
@media (max-width: 1100px) {
  .step-editor {
    grid-template-columns: 60px minmax(100px, 1fr) 95px auto;
  }
  .step-note {
    grid-column: 1 / -2;
    grid-row: 2;
  }
  .step-actions {
    grid-column: 4;
    grid-row: 2;
  }
}
@media (max-width: 700px) {
  .animation-timeline {
    padding: 12px;
  }
  .timeline-heading {
    gap: 8px;
  }
  .timeline-total {
    width: 100%;
    margin-left: 0;
  }
  .timeline-transport {
    gap: 10px 8px;
  }
  .time-slider {
    order: 1;
    flex-basis: 65%;
  }
  .time-readout {
    order: 2;
  }
  .step-editor {
    grid-template-columns: 52px minmax(90px, 1fr) 90px;
    gap: 8px;
  }
  .step-note {
    grid-column: 1 / -1;
  }
  .step-actions {
    grid-column: 1 / -1;
    grid-row: 3;
    justify-content: flex-end;
  }
  button {
    min-width: 40px;
    height: 40px;
  }
  .timeline-step {
    min-width: 155px;
  }
}
</style>
