<!-- 打印训练单：屏幕上隐藏，window.print 时只输出本区。
  由 BoardView 按 tacticsStore.printSource 渲染，打印后自动清空。 -->
<template>
  <section v-if="tactic" class="print-sheet">
    <header class="ps-head">
      <img v-if="badgeOk" :src="teamBadge" class="ps-badge" alt="" @error="badgeOk = false" />
      <div class="ps-titles">
        <h1>{{ TEAM.name }} · {{ tactic.title }}</h1>
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
          <defs>
            <clipPath :id="`ps-clip-${p.id}`">
              <circle :cx="p.x" :cy="p.y" :r="22" />
            </clipPath>
          </defs>
          <circle :cx="p.x" :cy="p.y" :r="24" :fill="p.color" stroke="#fff" stroke-width="3" />
          <image
            v-if="showAvatar(p)"
            :href="avatarOf(p)"
            :x="p.x - 24"
            :y="p.y - 24"
            :width="48"
            :height="48"
            :clip-path="`url(#ps-clip-${p.id})`"
            preserveAspectRatio="xMidYMid slice"
            @error="onAvatarError(p)"
          />
          <circle :cx="p.x" :cy="p.y" :r="24" fill="none" :stroke="p.color" stroke-width="3" />
          <text :x="p.x" :y="p.y - 32" text-anchor="middle" class="ps-name">{{ p.text }}</text>
          <text :x="p.x" :y="p.y + 40" text-anchor="middle" class="ps-pos">{{ positionOf(p) }}</text>
          <circle :cx="p.x + 17" :cy="p.y + 17" r="11" fill="#101828" stroke="#fff" stroke-width="2" />
          <text :x="p.x + 17" :y="p.y + 17" text-anchor="middle" dominant-baseline="central" class="ps-num">
            {{ p.number }}
          </text>
        </g>
      </EightField>
    </svg>

    <div class="ps-lineups">
      <div class="ps-team">
        <h2>主队 · {{ TEAM.name }}</h2>
        <ol>
          <li v-for="p in homeLineup" :key="p.id">{{ p.number }}号 {{ p.text }}（{{ positionOf(p) }}）</li>
        </ol>
      </div>
      <div class="ps-team" v-if="awayLineup.length">
        <h2>对手</h2>
        <ol>
          <li v-for="p in awayLineup" :key="p.id">{{ p.number }}号（{{ posLabel(p.playerPosition) }}）</li>
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
    <div class="ps-unfit" v-if="unfitList.length">伤停：{{ unfitList }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import EightField from "@/components/fields/EightField.vue";
import Drawing from "@/components/drawings/Drawing.vue";
import { Drawing as DrawingModel } from "@/types/drawing";
import { TEAM } from "@/data/berlinGarden";
import { posLabel, STATUS_META, resolveAvatar, resolveRosterPlayer } from "@/data/berlinGarden";
import type { TacticRecord } from "@/db";
import { useRosterStore } from "@/stores/rosterStore";

const props = defineProps<{ tactic: TacticRecord | null; note?: string }>();

const teamBadge = TEAM.badge;
const rosterStore = useRosterStore();
const badgeOk = ref(true);
const avatarOk = reactive<Record<string, boolean>>({});

interface SnapPlayer {
  id: string | number;
  x: number;
  y: number;
  color: string;
  number?: number;
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

const positionOf = (player: SnapPlayer) => {
  if (player.team !== "away") {
    const entry = resolveRosterPlayer(rosterStore.players, {
      rosterId: player.rosterId,
      text: player.text,
      number: player.number,
      team: player.team,
    });
    if (entry?.positions?.length) return entry.positions.join("、");
  }
  return posLabel(player.playerPosition);
};

const dateStr = computed(() => (props.tactic ? new Date(props.tactic.updatedAt).toLocaleDateString("zh-CN") : ""));

const matchLine = computed(() => {
  const m = props.tactic?.match;
  if (!m) return "";
  return [m.opponent ? `对手 ${m.opponent}` : "", m.date || "", m.score ? `比分 ${m.score}` : ""]
    .filter(Boolean)
    .join(" ｜ ");
});

// 伤停名单读实时 roster（永远最新，不随快照）
const unfitList = computed(() => {
  try {
    const rosterStore = useRosterStore();
    return rosterStore.players
      .filter((r) => r.status && r.status !== "ok")
      .map((r) => `${r.name}(${STATUS_META[r.status ?? "ok"].label})`)
      .join("、");
  } catch {
    return "";
  }
});

// 主队按 id→姓名→号码三级关联头像；对手无头像
const avatarOf = (p: SnapPlayer): string | undefined => {
  if (p.team === "away") return undefined;
  try {
    return resolveAvatar(rosterStore.players, {
      rosterId: p.rosterId,
      text: p.text,
      number: p.number,
      team: p.team,
    });
  } catch {
    return undefined;
  }
};

const avatarKey = (p: SnapPlayer) => String(p.id);
const showAvatar = (p: SnapPlayer) => !!avatarOf(p) && avatarOk[avatarKey(p)] !== false;
const onAvatarError = (p: SnapPlayer) => {
  avatarOk[avatarKey(p)] = false;
};
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
  color: #0b2a1d;
}
.ps-titles p {
  font-size: 12px;
  color: #555;
  margin: 2px 0 0;
}

.ps-match {
  font-weight: 700;
  color: #0b2a1d !important;
}
.ps-pitch {
  width: 100%;
  height: auto;
  border: 1px solid #ccc;
}
.ps-name {
  font-size: 20px;
  font-weight: 700;
  fill: #111;
}
.ps-pos {
  font-size: 16px;
  fill: #333;
}
.ps-num {
  font-size: 13px;
  font-weight: 800;
  fill: #fff;
}
.ps-lineups {
  display: flex;
  gap: 24px;
  margin-top: 8px;
}
.ps-team h2 {
  font-size: 15px;
  margin: 0 0 4px;
  color: #0b2a1d;
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
  border-top: 1px solid #ccc;
  padding-top: 6px;
}

.ps-unfit {
  margin-top: 6px;
  font-size: 13px;
  color: #c0392b;
}
.ps-training {
  border-top: 1px solid #ccc;
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
    background: #fff !important;
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
