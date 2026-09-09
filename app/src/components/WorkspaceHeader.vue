<script setup lang="ts">
import { computed } from "vue";
import { Users, LibraryBig, Save, Presentation, FlipHorizontal2, Play, Shield, ClipboardList } from "lucide-vue-next";
import { useGlobalStore } from "@/stores/globalStore";
import { useAnimationStore } from "@/stores/animationStore";
import { MATCH_FORMATIONS, MATCH_PLAYER_COUNTS, type MatchPlayerCount } from "@/data/matchFormats";
import { TEAM } from "@/data/berlinGarden";
import CoachingSaveStatus from "./CoachingSaveStatus.vue";

const props = defineProps<{
  playerCount: MatchPlayerCount;
  rosterOpen: boolean;
  tacticsOpen: boolean;
  coachingOpen: boolean;
  saving: boolean;
  activeFormation: string | null;
  awayFormation: string | null;
}>();
const emit = defineEmits<{
  roster: [];
  tactics: [];
  coaching: [];
  save: [];
  present: [];
  demo: [];
  flip: [];
  formation: [id: string];
  opponent: [id: string];
  playerCount: [count: MatchPlayerCount];
}>();
const global = useGlobalStore();
const animation = useAnimationStore();
const regular = computed(() => MATCH_FORMATIONS[props.playerCount].filter((f) => f.category === "常规"));
const setpieces = computed(() => MATCH_FORMATIONS[props.playerCount].filter((f) => f.category === "定位球"));
</script>

<template>
  <header class="workspace-header">
    <div class="workspace-topline">
      <div class="club-identity">
        <img :src="TEAM.badge" alt="柏林花园 FC 队徽" class="club-badge" />
        <div>
          <h1>
            柏林花园
            <span>FC</span>
          </h1>
          <p>
            教练工作台
            <span class="identity-dot">·</span>
            {{ playerCount }} 人制足球
          </p>
        </div>
      </div>
      <nav class="workspace-nav" aria-label="工作区">
        <button :class="{ selected: rosterOpen }" :aria-pressed="rosterOpen" @click="emit('roster')">
          <Users :size="17" aria-hidden="true" />
          球队名单
        </button>
        <button :class="{ selected: tacticsOpen }" :aria-pressed="tacticsOpen" @click="emit('tactics')">
          <LibraryBig :size="17" aria-hidden="true" />
          战术库
        </button>
        <button :class="{ selected: coachingOpen }" :aria-pressed="coachingOpen" @click="emit('coaching')">
          <ClipboardList :size="17" aria-hidden="true" />
          训练计划
        </button>
      </nav>
      <div class="workspace-actions">
        <button class="workspace-command present-command" @click="emit('present')">
          <Presentation :size="17" aria-hidden="true" />
          演示
        </button>
        <button class="workspace-command save-command" :disabled="saving" @click="emit('save')">
          <Save :size="17" aria-hidden="true" />
          {{ saving ? "保存中" : "保存战术" }}
        </button>
      </div>
    </div>
    <CoachingSaveStatus />
    <div class="workspace-config">
      <div class="formation-settings">
        <label class="opponent-select">
          <span class="config-label">比赛人数</span>
          <select
            aria-label="比赛人数"
            :value="playerCount"
            :disabled="animation.isAnimationMode"
            @change="emit('playerCount', Number(($event.target as HTMLSelectElement).value) as MatchPlayerCount)"
          >
            <option v-for="count in MATCH_PLAYER_COUNTS" :key="count" :value="count">{{ count }} 人制</option>
          </select>
        </label>
        <span class="config-label">
          <Shield :size="15" aria-hidden="true" />
          主队阵型
        </span>
        <div class="formation-segment" aria-label="主队阵型">
          <button
            v-for="f in regular"
            :key="f.id"
            :class="{ selected: activeFormation === f.id }"
            :aria-pressed="activeFormation === f.id"
            :disabled="animation.isAnimationMode"
            @click="emit('formation', f.id)"
          >
            {{ f.name }}
          </button>
        </div>
        <select
          v-if="setpieces.length"
          aria-label="定位球阵型"
          :value="setpieces.some((f) => f.id === activeFormation) ? activeFormation : ''"
          :disabled="animation.isAnimationMode"
          @change="emit('formation', ($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>定位球</option>
          <option v-for="f in setpieces" :key="f.id" :value="f.id">{{ f.name }}</option>
        </select>
        <label class="opponent-select">
          <span class="config-label">对手</span>
          <select
            aria-label="对手阵型"
            :value="awayFormation || ''"
            :disabled="animation.isAnimationMode"
            @change="emit('opponent', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">不显示</option>
            <option v-if="awayFormation === 'custom'" value="custom" disabled>当前站位</option>
            <option v-for="f in regular" :key="f.id" :value="f.id">{{ f.name }}</option>
          </select>
        </label>
      </div>
      <div class="display-settings">
        <label>
          <input v-model="global.showNames" type="checkbox" />
          姓名
        </label>
        <label>
          <input v-model="global.showPositions" type="checkbox" />
          位置
        </label>
        <label>
          <input v-model="global.snap" type="checkbox" />
          吸附
        </label>
        <span class="config-divider"></span>
        <button
          class="workspace-icon"
          aria-label="攻防翻转"
          title="攻防翻转"
          :disabled="animation.isAnimationMode"
          @click="emit('flip')"
        >
          <FlipHorizontal2 :size="18" />
        </button>
        <button class="workspace-icon" aria-label="动态演示" title="动态演示" @click="emit('demo')">
          <Play :size="18" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.workspace-header {
  flex-shrink: 0;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  z-index: 3;
}
.workspace-topline {
  min-height: 88px;
  display: flex;
  align-items: center;
  padding: 16px 28px;
  gap: 40px;
}
.club-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.club-badge {
  width: 46px;
  height: 50px;
  object-fit: contain;
}
h1 {
  font-size: 23px;
  line-height: 1.2;
  margin: 0 0 7px;
  font-weight: 750;
  color: var(--ink);
}
h1 span {
  font-family: var(--font-num);
  font-weight: 700;
  color: var(--muted);
  font-size: 19px;
}
p {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}
.identity-dot {
  padding: 0 5px;
}
.workspace-nav {
  display: flex;
  gap: 8px;
  align-self: stretch;
  align-items: center;
}
.workspace-nav button {
  display: flex;
  align-items: center;
  gap: 8px;
  background: transparent;
  color: var(--muted);
  border: 0;
  border-radius: 6px;
  min-height: 40px;
  padding: 0 14px;
  font-size: 14px;
  white-space: nowrap;
}
.workspace-nav button.selected {
  background: var(--green-soft);
  color: var(--pitch-700);
  font-weight: 650;
}
.workspace-actions {
  display: flex;
  gap: 10px;
  margin-left: auto;
}
.workspace-command {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px;
  min-height: 40px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  white-space: nowrap;
  font-size: 13px;
}
.save-command {
  background: var(--pitch-700);
  border-color: var(--pitch-700);
  color: white;
}
.workspace-config {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 20px;
  padding: 12px 28px;
  border-top: 1px solid var(--line);
}
.formation-settings,
.display-settings {
  display: flex;
  align-items: center;
  gap: 12px;
}
.formation-settings {
  flex-wrap: wrap;
}
.config-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.formation-segment {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  background: var(--canvas);
  border-radius: 6px;
  padding: 3px;
  gap: 2px;
}
.formation-segment button {
  background: transparent;
  border: 1px solid transparent;
  color: var(--muted);
  border-radius: 4px;
  padding: 6px 12px;
  font: 600 13px var(--font-num);
}
.formation-segment button.selected {
  background: var(--surface);
  border-color: var(--line);
  color: var(--pitch-700);
  box-shadow: 0 1px 2px #1827230a;
}
select {
  max-width: 140px;
  min-height: 34px;
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--ink);
  border-radius: 5px;
  padding: 5px 8px;
  font-size: 12px;
}
.opponent-select {
  display: flex;
  align-items: center;
  gap: 8px;
  border-left: 1px solid var(--line);
  padding-left: 14px;
}
.display-settings {
  gap: 14px;
}
.display-settings label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: var(--pitch-700);
  margin: 0;
}
.config-divider {
  height: 18px;
  width: 1px;
  background: var(--line);
}
.workspace-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 5px;
  color: var(--muted);
  background: transparent;
}
button:hover:not(:disabled) {
  filter: brightness(0.96);
  background-color: var(--green-soft);
  color: var(--pitch-700);
}
button.save-command:hover:not(:disabled) {
  background: var(--pitch-900);
  color: white;
}
@media (max-width: 1100px) {
  .workspace-topline {
    gap: 20px;
    padding: 16px 20px;
  }
  .workspace-config {
    padding: 10px 20px;
  }
}
@media (max-width: 960px) {
  .workspace-topline {
    flex-wrap: wrap;
    gap: 12px;
  }
  .workspace-nav {
    order: 2;
    width: 100%;
  }
  .workspace-nav button {
    flex: 1;
    justify-content: center;
  }
}
@media (max-width: 700px) {
  .workspace-topline {
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px 16px 0;
  }
  .club-badge {
    width: 36px;
    height: 40px;
  }
  h1 {
    font-size: 19px;
  }
  h1 span {
    font-size: 16px;
  }
  .workspace-actions {
    order: 1;
    gap: 6px;
  }
  .workspace-command {
    padding: 0 10px;
    min-height: 44px;
  }
  .present-command {
    display: none;
  }
  .workspace-nav {
    order: 2;
    width: 100%;
    gap: 4px;
  }
  .workspace-nav button {
    flex: 1;
    justify-content: center;
    border-radius: 0;
    min-height: 44px;
    border-bottom: 2px solid transparent;
    padding: 0 8px;
    font-size: 13px;
  }
  .workspace-nav button.selected {
    background: transparent;
    border-bottom-color: var(--pitch-700);
  }
  .workspace-config {
    padding: 12px 16px;
    gap: 12px;
  }
  .formation-settings {
    width: 100%;
    flex-wrap: wrap;
    gap: 10px;
  }
  .formation-settings > .config-label {
    width: 100%;
  }
  .formation-segment {
    flex: 1;
    flex-basis: 100%;
  }
  .formation-segment button {
    flex: 1 0 70px;
    min-height: 36px;
    padding: 6px 9px;
    white-space: nowrap;
  }
  .opponent-select {
    border: 0;
    padding: 0;
  }
  select {
    min-height: 40px;
  }
  .display-settings {
    flex-wrap: wrap;
    gap: 12px;
  }
  .display-settings label {
    min-height: 40px;
  }
  .workspace-icon {
    width: 40px;
    height: 40px;
  }
}
</style>
