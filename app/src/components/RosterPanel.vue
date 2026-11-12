<template>
  <aside class="roster-panel" :class="{ expanded }" v-if="open" aria-label="球队名单">
    <div class="roster-head">
      <div class="roster-heading">
        <h2>球队名单</h2>
        <div class="roster-heading-actions">
          <span>{{ players.length }} 人</span>
          <button
            class="roster-expand"
            :aria-label="expanded ? '收起名单' : '展开名单'"
            :title="expanded ? '收起名单' : '展开名单'"
            :aria-pressed="expanded"
            @click="expanded = !expanded"
          >
            <component :is="expanded ? Minimize2 : Maximize2" :size="16" />
          </button>
        </div>
      </div>
      <span class="roster-count">主教练 · {{ teamCoach }}</span>
    </div>
    <div class="squad-summary">
      <div>
        <strong>
          {{ onCount }}
          <small>/ {{ match.playerCount }}</small>
        </strong>
        <span>场上队员</span>
      </div>
      <div>
        <strong>{{ offCount }}</strong>
        <span>可用替补</span>
      </div>
      <div>
        <strong :class="{ warning: unfitCount }">{{ unfitCount }}</strong>
        <span>伤停队员</span>
      </div>
    </div>
    <div class="roster-add-row">
      <input
        class="roster-search roster-add-input"
        v-model="newName"
        placeholder="新队员姓名"
        aria-label="新队员姓名"
        maxlength="8"
        @keyup.enter="onAdd"
      />
      <button class="roster-add-btn" @click="onAdd" :disabled="!newName.trim()" title="新增队员" aria-label="新增队员">
        <UserPlus :size="17" />
      </button>
    </div>
    <div class="roster-search-wrap">
      <Search :size="15" aria-hidden="true" />
      <input class="roster-search" type="search" v-model="keyword" placeholder="搜索姓名或号码" aria-label="搜索队员" />
    </div>
    <div class="roster-filters" aria-label="名单筛选">
      <button
        v-for="filter in filters"
        :key="filter.value"
        :class="{ active: availability === filter.value }"
        :aria-pressed="availability === filter.value"
        @click="availability = filter.value"
      >
        {{ filter.label }}
      </button>
    </div>
    <ul ref="listRef" class="roster-list" aria-label="队员列表" tabindex="0">
      <li
        v-for="p in filtered"
        :key="p.id"
        :data-player-id="p.id"
        class="roster-item"
        :class="{ on: onPitch(p), editing: detailId === p.id }"
      >
        <div class="roster-row">
          <button
            class="player-detail-trigger"
            @click="toggleDetail(p.id)"
            :aria-label="`${p.name} 队员详情`"
            :aria-expanded="detailId === p.id"
          >
            <span class="avatar-wrap">
              <span class="avatar-fallback">{{ p.name[0] }}</span>
              <img v-if="p.avatar" :src="p.avatar" class="avatar-photo" alt="" @error="hideAvatar" />
            </span>
            <span class="roster-number">{{ p.number ?? "—" }}</span>
            <span class="roster-name">{{ p.name }}</span>
            <span
              v-if="p.status && p.status !== 'ok'"
              class="status-badge"
              :style="{ background: statusColor(p.status) }"
            >
              {{ statusLabel(p.status) }}
            </span>
            <span class="roster-pos" :title="p.positions.join('、')">{{ p.positions.join("、") }}</span>
          </button>
          <button
            class="roster-btn"
            :class="{ off: onPitch(p) }"
            :disabled="!onPitch(p) && !!p.status && p.status !== 'ok'"
            :title="!onPitch(p) && p.status && p.status !== 'ok' ? '伤停中，恢复健康后可上场' : ''"
            @click.stop="onPitch(p) ? roster.playerOff(p.id) : roster.playerOn(p.id)"
          >
            {{ onPitch(p) ? "下场" : "上场" }}
          </button>
        </div>
        <!-- 人员详情：点击整行展开，可编辑号码/位置/备注 -->
        <div v-if="detailId === p.id" class="roster-detail">
          <span class="detail-avatar-wrap">
            <span class="avatar-fallback big">{{ p.name[0] }}</span>
            <img v-if="p.avatar" :src="p.avatar" class="avatar-photo" alt="" @error="hideAvatar" />
          </span>
          <div class="detail-fields">
            <label>
              姓名
              <input type="text" :value="p.name" maxlength="8" @change="onName(p.id, $event)" />
            </label>
            <label>
              号码
              <input
                type="number"
                :value="p.number"
                min="0"
                max="999"
                placeholder="未知"
                @change="onNumber(p.id, $event)"
              />
            </label>
            <fieldset class="position-field">
              <legend>位置</legend>
              <label v-for="opt in positionOptions" :key="opt.value" class="position-option">
                <input
                  type="checkbox"
                  :checked="p.positions.includes(opt.value)"
                  @change="onPosition(p.id, p.positions, opt.value, $event)"
                />
                {{ opt.label }}
              </label>
            </fieldset>
            <label>
              备注
              <input type="text" :value="p.note" placeholder="如：主教练 / 左脚" @change="onNote(p.id, $event)" />
            </label>
            <label>
              状态
              <select :value="p.status || 'ok'" @change="onStatus(p.id, $event)">
                <option value="ok">健康</option>
                <option value="injured">伤</option>
                <option value="suspended">停</option>
              </select>
            </label>
            <div class="detail-status">{{ onPitch(p) ? "状态：在场上" : "状态：替补席" }}</div>
            <SubstitutionControl v-if="!onPitch(p) && (!p.status || p.status === 'ok')" :incoming-id="p.id" />
            <button class="detail-delete" @click="onRemove(p.id, p.name)">归档该队员</button>
          </div>
        </div>
      </li>
    </ul>
    <div v-if="filtered.length === 0" class="roster-empty">
      <SearchX :size="26" />
      <p>未找到匹配的队员</p>
      <button
        @click="
          keyword = '';
          availability = 'all';
        "
      >
        重置筛选
      </button>
    </div>
    <div class="roster-bottom">
      <span>{{ filtered.length }} / {{ players.length }} 名队员</span>
      <span>{{ teamName }}</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, nextTick, watch } from "vue";
import { Search, SearchX, UserPlus, Maximize2, Minimize2 } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { useRosterStore } from "@/stores/rosterStore";
import SubstitutionControl from "./SubstitutionControl.vue";
import {
  PLAYER_POSITION_OPTIONS,
  normalizePlayerPositions,
  STATUS_META,
  statusLabel,
  type PlayerPosition,
  type PlayerStatus,
} from "@/data/berlinGarden";

import { useMatchStore } from "@/stores/matchStore";
import { useTeamIdentity } from "@/composables/useTeamIdentity";

const { teamName } = useTeamIdentity();

defineProps<{ open: boolean }>();
const match = useMatchStore();

const roster = useRosterStore();
const { players } = storeToRefs(roster);
const keyword = ref("");
const expanded = ref(false);
const listRef = ref<HTMLUListElement | null>(null);
const availability = ref("all");
const filters = [
  { value: "all", label: "全部" },
  { value: "on", label: "在场" },
  { value: "off", label: "替补" },
  { value: "unfit", label: "伤停" },
];
const detailId = ref<string | null>(null);
const newName = ref("");
const positionOptions = PLAYER_POSITION_OPTIONS;
const revealPlayer = async (id: string) => {
  await nextTick();
  const row = Array.from(listRef.value?.children ?? []).find(
    (element) => (element as HTMLElement).dataset.playerId === id
  );
  row?.scrollIntoView({ block: "nearest" });
};
watch([keyword, availability], () => {
  if (listRef.value) listRef.value.scrollTop = 0;
});

const onAdd = () => {
  const id = roster.addPlayer(newName.value);
  if (id) {
    keyword.value = "";
    availability.value = "all";
    newName.value = "";
    detailId.value = id;
    void revealPlayer(id);
  }
};

const onRemove = (id: string, name: string) => {
  if (
    confirm(`归档队员 ${name}？场上棋子将移除，球员账号将停用，历史比赛记录保留。可在俱乐部球员管理中重新设为在队。`)
  ) {
    roster.removePlayer(id);
    if (detailId.value === id) detailId.value = null;
  }
};

const onName = (id: string, e: Event) => {
  const value = (e.target as HTMLInputElement).value.trim();
  if (value) roster.updatePlayer(id, { name: value });
};

const toggleDetail = (id: string) => {
  detailId.value = detailId.value === id ? null : id;
  if (detailId.value) void revealPlayer(id);
};
const focusPlayer = (id: string) => {
  keyword.value = "";
  availability.value = "all";
  detailId.value = id;
  void revealPlayer(id);
};
defineExpose({ focusPlayer });

const onNumber = (id: string, e: Event) => {
  const raw = (e.target as HTMLInputElement).value;
  const value = raw === "" ? null : Number(raw);
  if (value === null || (Number.isInteger(value) && value >= 0 && value <= 999))
    roster.updatePlayer(id, { number: value });
};

const onPosition = (id: string, positions: PlayerPosition[], position: PlayerPosition, event: Event) => {
  const checked = (event.target as HTMLInputElement).checked;
  const next = checked
    ? position === "待定"
      ? [position]
      : [...positions.filter((value) => value !== "待定"), position]
    : positions.filter((value) => value !== position);
  roster.updatePlayer(id, { positions: normalizePlayerPositions(next) });
};

const onNote = (id: string, e: Event) => {
  roster.updatePlayer(id, { note: (e.target as HTMLInputElement).value.trim() });
};

const onStatus = (id: string, e: Event) => {
  roster.setStatus(id, (e.target as HTMLSelectElement).value as PlayerStatus);
};

const teamCoach = "待设置";
const onPitch = (p: { fieldId: unknown }) => p.fieldId !== null;
const onCount = computed(() => players.value.filter((p) => p.fieldId !== null).length);
const offCount = computed(
  () => players.value.filter((p) => p.fieldId === null && (!p.status || p.status === "ok")).length
);
const unfitCount = computed(() => players.value.filter((p) => p.status && p.status !== "ok").length);
const statusColor = (s: PlayerStatus) => STATUS_META[s].color;
const filtered = computed(() => {
  const kw = keyword.value.trim().toLocaleLowerCase();
  return players.value.filter((p) => {
    const unfit = !!p.status && p.status !== "ok";
    if (availability.value === "on" && !onPitch(p)) return false;
    if (availability.value === "off" && (onPitch(p) || unfit)) return false;
    if (availability.value === "unfit" && !unfit) return false;
    return !kw || p.name.toLocaleLowerCase().includes(kw) || String(p.number) === kw;
  });
});

// 头像文件缺失时隐藏 img，露出底下的首字兜底
const hideAvatar = (e: Event) => {
  (e.target as HTMLImageElement).style.display = "none";
};
</script>

<style scoped>
.roster-panel {
  width: 320px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  gap: 8px;
  min-height: 0;
  overflow: hidden;
}
.roster-panel > :not(.roster-list) {
  flex-shrink: 0;
}
.roster-panel.expanded {
  width: min(640px, 50vw);
}
.roster-heading-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 12px;
}
.roster-expand {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--surface);
  color: var(--pitch-700);
}
.roster-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.roster-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.roster-heading h2 {
  font-size: 17px;
  font-weight: 650;
  margin: 0;
}
.roster-heading > span {
  font-size: 12px;
  color: var(--muted);
}
.roster-count {
  font-size: 12px;
  color: var(--muted);
}
.squad-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 4px 0 8px;
  border-bottom: 1px solid var(--line);
}
.squad-summary > div {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 4px;
}
.squad-summary strong {
  font: 600 18px var(--font-num);
  color: var(--ink);
}
.squad-summary small {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
  margin-left: 4px;
}
.squad-summary span {
  font-size: 11px;
  color: var(--muted);
}
.squad-summary .warning {
  color: #b34d40;
}
.roster-add-row {
  display: flex;
  gap: 8px;
  order: 7;
}
.roster-search {
  min-height: 38px;
  width: 100%;
  background: #f7f8f9;
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 8px 10px;
  font: 12px var(--font-stack);
  color: var(--ink);
  min-width: 0;
}
.roster-add-input {
  flex: 1;
  background: white;
}
.roster-add-btn {
  display: grid;
  place-items: center;
  width: 38px;
  flex-shrink: 0;
  color: var(--pitch-700);
  background: var(--green-soft);
  border: 1px solid #c7dfd4;
  border-radius: 5px;
}
.roster-search-wrap {
  display: flex;
  align-items: center;
  position: relative;
}
.roster-search-wrap > svg {
  position: absolute;
  left: 11px;
  color: var(--muted);
}
.roster-search-wrap input {
  padding-left: 34px;
}
.roster-filters {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 4px;
}
.roster-filters button {
  flex: 1;
  height: 32px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  font-size: 12px;
  color: var(--muted);
}
.roster-filters button.active {
  color: var(--pitch-700);
  background: var(--green-soft);
  font-weight: 650;
}
.roster-list {
  flex: 1;
  min-height: 0;
  list-style: none;
  padding: 0;
  margin: 0 -6px;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #aabbb4 transparent;
  scroll-padding-block: 6px;
}
.expanded .roster-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  column-gap: 10px;
}
.roster-list:focus-visible {
  outline: 2px solid #287fbc;
  outline-offset: -2px;
}
.expanded .roster-item.editing {
  grid-column: 1 / -1;
}
.roster-item {
  padding: 4px 6px;
  border-bottom: 1px solid #f0f2f3;
}
.roster-item:hover {
  background: #f7f9f8;
}
.roster-item.on {
  background: transparent;
}
.roster-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
}
.player-detail-trigger {
  display: grid;
  grid-template-columns: 34px 22px minmax(0, 1fr) auto;
  grid-template-rows: 20px 18px;
  align-items: center;
  gap: 0 6px;
  flex: 1;
  min-width: 0;
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--ink);
  text-align: left;
}
.player-detail-trigger .avatar-wrap {
  grid-row: 1 / 3;
}
.player-detail-trigger .roster-number {
  grid-row: 1 / 3;
}
.player-detail-trigger .roster-name {
  grid-column: 3;
  grid-row: 1;
}
.player-detail-trigger .status-badge {
  grid-column: 4;
  grid-row: 1;
}
.player-detail-trigger .roster-pos {
  grid-column: 3 / -1;
  grid-row: 2;
  max-width: none;
}
.avatar-wrap {
  width: 34px;
  height: 34px;
  position: relative;
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
  background: var(--pitch-700);
  border: 1px solid var(--line);
}
.avatar-fallback {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: white;
  font-size: 14px;
}
.avatar-photo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.roster-number {
  font: 500 12px var(--font-num);
  color: var(--muted);
  width: 17px;
  text-align: center;
  flex-shrink: 0;
}
.roster-name {
  font-size: 13px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.roster-pos {
  font-size: 11px;
  color: var(--muted);
  max-width: 86px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-badge {
  color: white;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
  flex-shrink: 0;
}
.roster-btn {
  min-height: 36px;
  min-width: 44px;
  padding: 3px 5px;
  border: 1px solid var(--line);
  background: white;
  color: var(--muted);
  border-radius: 4px;
  font-size: 11px;
  flex-shrink: 0;
}
.roster-btn.off {
  background: var(--green-soft);
  color: var(--pitch-700);
  border-color: transparent;
}
.roster-btn:hover:not(:disabled) {
  border-color: var(--pitch-700);
  color: var(--pitch-700);
}
.roster-detail {
  padding: 14px 0 8px;
  border-top: 1px solid var(--line);
  margin-top: 10px;
}
.detail-avatar-wrap {
  display: none;
}
.detail-fields {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.detail-fields label {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}
.detail-fields input,
.detail-fields select {
  min-width: 0;
  flex: 1;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 6px 8px;
  min-height: 34px;
  font-size: 12px;
  color: var(--ink);
  background: white;
}
.position-field {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 8px;
  min-width: 0;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 4px;
}
.position-field legend {
  padding: 0 4px;
  font-size: 12px;
  color: var(--muted);
}
.detail-fields .position-option {
  gap: 5px;
  color: var(--ink);
}
.detail-fields .position-option input {
  flex: 0 0 auto;
  min-height: auto;
  width: 14px;
  height: 14px;
  padding: 0;
}
.detail-status {
  font-size: 12px;
  color: var(--pitch-700);
}
.detail-delete {
  border: 1px solid #ead0d1;
  background: #fff7f7;
  color: #b43d43;
  min-height: 34px;
  border-radius: 4px;
  font-size: 12px;
}
.roster-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 0;
  color: var(--muted);
  font-size: 12px;
}
.roster-empty button {
  padding: 7px 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: white;
  color: var(--pitch-700);
}
.roster-bottom {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: var(--muted);
  order: 8;
}
@media (min-width: 701px) and (max-width: 1100px) {
  .roster-panel {
    width: 292px;
    padding: 12px;
  }
}
@media (max-width: 700px) {
  .roster-panel,
  .roster-panel.expanded {
    width: 100%;
    border: 0;
    border-top: 1px solid var(--line);
    padding: 14px 18px max(18px, env(safe-area-inset-bottom));
    min-height: 0;
    max-height: none;
    overflow: visible;
  }
  .roster-list,
  .expanded .roster-list {
    display: block;
    flex: none;
    overflow: visible;
    scrollbar-gutter: auto;
  }
  .roster-expand {
    display: none;
  }
  .roster-btn {
    min-width: 44px;
    min-height: 44px;
  }
  .player-detail-trigger {
    min-height: 44px;
  }
  .roster-filters button {
    height: 40px;
  }
  .roster-search {
    min-height: 44px;
  }
  .roster-add-btn {
    width: 44px;
  }
  .roster-name {
    font-size: 14px;
  }
}
</style>
