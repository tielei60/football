<!-- 打印训练单：屏幕上隐藏，window.print 时只输出本区。
  由 BoardView 按 tacticsStore.printSource 渲染，打印后自动清空。 -->
<template>
  <section v-if="tactic" class="print-sheet">
    <header class="ps-head">
      <img v-if="badgeOk" :src="teamBadge" class="ps-badge" :alt="`${teamName}队徽`" @error="badgeOk = false" />
      <div class="ps-titles">
        <h1>{{ teamName }} · {{ tactic.title }}</h1>
        <p>
          {{ dateStr }} ｜ {{ (tactic.tags || []).join(" / ") || "无标签" }} ｜
          {{ tactic.snapshot.playerCount ?? 8 }}人制
        </p>
        <p v-if="matchLine" class="ps-match">{{ matchLine }}</p>
      </div>
    </header>

    <svg viewBox="0 0 1250 826" class="ps-pitch" xmlns="http://www.w3.org/2000/svg">
      <EightField>
        <g>
          <Drawing v-for="d in drawings" :key="d.id" :drawing="d" />
        </g>
        <g v-for="p in players" :key="p.id">
          <circle
            :cx="p.x"
            :cy="p.y"
            :r="24"
            :fill="p.color || (p.team === 'away' ? 'var(--pitch-player-away)' : 'var(--pitch-player-home)')"
            stroke="var(--color-surface)"
            stroke-width="3"
          />
          <circle :cx="p.x" :cy="p.y" :r="24" fill="none" :stroke="p.color" stroke-width="3" />
          <text :x="p.x" :y="p.y - 32" text-anchor="middle" class="ps-name">{{ p.text }}</text>
          <text :x="p.x" :y="p.y + 40" text-anchor="middle" class="ps-pos">{{ positionOf(p) }}</text>
          <circle
            :cx="p.x + 17"
            :cy="p.y + 17"
            r="11"
            fill="var(--color-text)"
            stroke="var(--color-surface)"
            stroke-width="2"
          />
          <text :x="p.x + 17" :y="p.y + 17" text-anchor="middle" dominant-baseline="central" class="ps-num">
            {{ p.number ?? "—" }}
          </text>
        </g>
      </EightField>
    </svg>

    <div class="ps-lineups">
      <div class="ps-team">
        <h2>主队 · {{ teamName }}</h2>
        <ol>
          <li v-for="p in homeLineup" :key="p.id">{{ numberLabel(p) }} {{ p.text }}（{{ positionOf(p) }}）</li>
        </ol>
      </div>
      <div class="ps-team" v-if="awayLineup.length">
        <h2>对手</h2>
        <ol>
          <li v-for="p in awayLineup" :key="p.id">{{ numberLabel(p) }}（{{ posLabel(p.playerPosition) }}）</li>
        </ol>
      </div>
    </div>

    <section class="ps-training" v-if="tactic.snapshot.coaching?.objective || tactic.snapshot.coaching?.instructions">
      <h2>训练计划 · {{ tactic.snapshot.coaching.durationMinutes }} 分钟</h2>
      <p v-if="tactic.snapshot.coaching.objective">
        <strong>训练目标：</strong>
        {{ tactic.snapshot.coaching.objective }}
      </p>
      <p v-if="tactic.snapshot.coaching.instructions" class="ps-instructions">
        <strong>执教要点：</strong>
        {{ tactic.snapshot.coaching.instructions }}
      </p>
    </section>
    <footer class="ps-foot" v-if="note">备注：{{ note }}</footer>
    <p class="ps-snapshot-note">姓名、号码及位置以此战术存档为准。存档未保存球员头像与伤停状态，不使用当前档案补填。</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import EightField from "@/components/fields/EightField.vue";
import Drawing from "@/components/drawings/Drawing.vue";
import { Drawing as DrawingModel } from "@/types/drawing";
import { posLabel } from "@/data/berlinGarden";
import type { TacticRecord } from "@/db";
import { useTeamIdentity } from "@/composables/useTeamIdentity";

const props = defineProps<{ tactic: TacticRecord | null; note?: string }>();

const { teamName, teamBadge } = useTeamIdentity();
const badgeOk = ref(true);
watch(teamBadge, () => {
  badgeOk.value = true;
});

interface SnapPlayer {
  id: string | number;
  x: number;
  y: number;
  color: string;
  number?: number | null;
  text?: string;
  playerPosition?: string;
  team?: string;
  elementType?: string;
  rosterId?: string | null;
}

const snapshot = computed(() => props.tactic?.snapshot ?? { items: [], drawings: [] });
const players = computed(() =>
  (snapshot.value.items as unknown as SnapPlayer[]).filter((p) => p.elementType === "player")
);
const drawings = computed(() =>
  (snapshot.value.drawings as unknown as Record<string, unknown>[]).map((d) => new DrawingModel(d as never))
);
const homeLineup = computed(() => players.value.filter((p) => p.team !== "away"));
const awayLineup = computed(() => players.value.filter((p) => p.team === "away"));

// Print only the position serialized in the archived board, not a later player profile.
const positionOf = (player: SnapPlayer) => (player.playerPosition ? posLabel(player.playerPosition) : "位置未知");
const numberLabel = (player: SnapPlayer) => (player.number == null ? "号码未知" : `${player.number}号`);

const dateStr = computed(() => (props.tactic ? new Date(props.tactic.updatedAt).toLocaleDateString("zh-CN") : ""));

const matchLine = computed(() => {
  const m = props.tactic?.match;
  if (!m) return "";
  return [m.opponent ? `对手 ${m.opponent}` : "", m.date || "", m.score ? `比分 ${m.score}` : ""]
    .filter(Boolean)
    .join(" ｜ ");
});
</script>

<style scoped>
.print-sheet {
  display: none;
}
.ps-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.ps-badge {
  width: 52px;
  height: 52px;
  object-fit: contain;
}
.ps-titles h1 {
  font-size: 20px;
  margin: 0;
  color: var(--color-text);
}
.ps-titles p {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 2px 0 0;
}

.ps-match {
  font-weight: 700;
  color: var(--color-text) !important;
}
.ps-pitch {
  width: 100%;
  height: auto;
  border: 1px solid var(--color-border-strong);
}
.ps-name {
  font-size: 20px;
  font-weight: 700;
  fill: var(--color-text);
}
.ps-pos {
  font-size: 16px;
  fill: var(--color-text);
}
.ps-num {
  font-size: 13px;
  font-weight: 800;
  fill: var(--color-on-brand);
}
.ps-lineups {
  display: flex;
  gap: 24px;
  margin-top: 8px;
}
.ps-team h2 {
  font-size: 15px;
  margin: 0 0 4px;
  color: var(--color-text);
}
.ps-team ol {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.7;
}
.ps-foot {
  margin-top: 8px;
  font-size: 13px;
  border-top: 1px solid var(--color-border-strong);
  padding-top: 6px;
}

.ps-snapshot-note {
  margin-top: 6px;
  font-size: 13px;
  color: var(--color-danger);
}
.ps-training {
  border-top: 1px solid var(--color-border-strong);
  margin-top: 12px;
  padding-top: 8px;
  break-inside: avoid;
}
.ps-training h2 {
  font-size: 15px;
  margin: 0 0 8px;
}
.ps-training p {
  font-size: 13px;
  line-height: 1.7;
  margin: 4px 0;
  overflow-wrap: anywhere;
}
.ps-instructions {
  white-space: pre-wrap;
}
</style>

<style>
@media print {
  body.coach {
    background: var(--color-surface) !important;
  }
  body * {
    visibility: hidden;
  }
  .print-sheet,
  .print-sheet * {
    visibility: visible;
  }
  .print-sheet {
    display: block !important;
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    padding: 12px;
  }
}
</style>
