<template>
  <div class="match-schedule-picker">
    <div class="match-schedule-start">
      <span :id="`${id}-label`" class="schedule-label">开始日期时间</span>
      <button
        type="button"
        class="schedule-trigger ui-button"
        :aria-labelledby="`${id}-label ${id}-value`"
        aria-haspopup="dialog"
        :aria-expanded="open"
        :aria-required="required"
        :aria-invalid="invalid || undefined"
        :disabled="disabled"
        @click="openPicker"
      >
        <span :id="`${id}-value`">{{ date ? formatSchedule(date, kickoff) : "选择日期和开始时间" }}</span>
        <CalendarDays :size="18" aria-hidden="true" />
      </button>
      <input
        class="schedule-validity-bridge"
        type="text"
        tabindex="-1"
        aria-hidden="true"
        :value="parseMatchDate(date) ? date : ''"
        :required="required"
        :disabled="disabled"
        @invalid.prevent="onInvalid"
      />
    </div>
    <label class="match-schedule-duration">
      比赛时长
      <UiSelect :model-value="durationChoice" :disabled="disabled" @update:model-value="chooseDuration">
        <option value="unknown">时长待定</option>
        <option v-for="minutes in presets" :key="minutes" :value="String(minutes)">{{ minutes }} 分钟</option>
        <option value="custom">自定义时长</option>
      </UiSelect>
    </label>
    <label v-if="customDuration" class="match-schedule-custom">
      时长（分钟）
      <input
        type="number"
        min="1"
        max="1440"
        step="1"
        required
        :value="durationMinutes ?? ''"
        :disabled="disabled"
        @input="setDuration"
      />
    </label>
    <p class="schedule-summary" aria-live="polite">
      {{ matchEndLabel(date, kickoff, durationMinutes) }} · 按球场当地时间
    </p>
    <p v-if="invalid" class="schedule-error" role="alert">请选择有效的比赛开始日期。</p>
    <UiDialog v-model="open" title="设置开始日期时间" description="选择日期和开球时间。取消不会改变已选时间。">
      <div class="schedule-panel">
        <div class="calendar-toolbar">
          <button
            type="button"
            class="ui-button"
            aria-label="上个月"
            :disabled="year === 0 && month === 1"
            @click="shiftMonth(-1)"
          >
            ‹
          </button>
          <label>
            年份
            <UiSelect v-model.number="year">
              <option v-for="y in years" :key="y" :value="y">{{ y }} 年</option>
            </UiSelect>
          </label>
          <label>
            月份
            <UiSelect v-model.number="month">
              <option v-for="m in 12" :key="m" :value="m">{{ m }} 月</option>
            </UiSelect>
          </label>
          <button
            type="button"
            class="ui-button"
            aria-label="下个月"
            :disabled="year === 9999 && month === 12"
            @click="shiftMonth(1)"
          >
            ›
          </button>
        </div>
        <div ref="calendar" class="calendar-grid" role="group" :aria-label="`${year} 年 ${month} 月日历`">
          <span v-for="day in weekdays" :key="day" class="calendar-weekday" aria-hidden="true">{{ day }}</span>
          <template v-for="(day, index) in days" :key="day || index">
            <button
              v-if="day"
              type="button"
              :data-date="day"
              :aria-label="formatMatchDate(day)"
              :aria-pressed="draftDate === day"
              :aria-current="day === today ? 'date' : undefined"
              :tabindex="day === focusDate ? 0 : -1"
              :class="{ selected: draftDate === day, outside: Number(day.slice(5, 7)) !== month, today: day === today }"
              @focus="focusDate = day"
              @click="selectDate(day)"
              @keydown="calendarKey($event, day)"
            >
              {{ Number(day.slice(8)) }}
            </button>
            <span v-else />
          </template>
        </div>
        <div class="calendar-shortcuts">
          <button type="button" class="ui-button" @click="selectDate(today)">今天</button>
          <span>{{ formatMatchDate(draftDate) }}</span>
        </div>
        <div class="schedule-time-fields">
          <label>
            开球小时
            <UiSelect v-model="hour">
              <option value="">时间待定</option>
              <option v-for="h in 24" :key="h" :value="pad(h - 1)">{{ pad(h - 1) }} 时</option>
            </UiSelect>
          </label>
          <label>
            开球分钟
            <UiSelect v-model="minute" :disabled="hour === ''">
              <option v-for="m in minutes" :key="m" :value="m">{{ m }} 分</option>
            </UiSelect>
          </label>
        </div>
        <details class="schedule-manual">
          <summary>手动输入日期</summary>
          <label>
            日期（YYYY-MM-DD）
            <input
              v-model="draftDate"
              type="text"
              inputmode="numeric"
              maxlength="10"
              placeholder="2027-02-07"
              @change="syncMonth"
            />
          </label>
        </details>
        <p class="schedule-summary">{{ matchEndLabel(draftDate, draftTime, durationMinutes) }}</p>
        <p v-if="error" role="alert" class="schedule-error">{{ error }}</p>
      </div>
      <template #footer>
        <button type="button" class="ui-button" @click="open = false">取消</button>
        <button type="button" class="ui-button ui-button-primary" @click="confirm">确定时间</button>
      </template>
    </UiDialog>
  </div>
</template>
<script lang="ts">
let scheduleId = 0;
</script>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { CalendarDays } from "lucide-vue-next";
import UiDialog from "@/components/ui/UiDialog.vue";
import UiSelect from "@/components/ui/UiSelect.vue";
import {
  calendarDays,
  formatMatchDate,
  formatSchedule,
  matchEndLabel,
  parseMatchDate,
  validKickoff,
} from "@/utils/matchSchedule";
const props = withDefaults(
  defineProps<{
    date: string;
    kickoff: string;
    durationMinutes: number | null;
    disabled?: boolean;
    required?: boolean;
  }>(),
  { disabled: false, required: true }
);
const emit = defineEmits<{
  "update:date": [value: string];
  "update:kickoff": [value: string];
  "update:durationMinutes": [value: number | null];
}>();
const id = `match-schedule-${++scheduleId}`;
const pad = (value: number) => String(value).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const open = ref(false);
const invalid = ref(false);
const error = ref("");
const draftDate = ref("");
const hour = ref("");
const minute = ref("00");
const year = ref(now.getFullYear());
const month = ref(now.getMonth() + 1);
const focusDate = ref(today);
const calendar = ref<HTMLElement>();
const presets = [60, 90, 120, 150];
const customDuration = ref(props.durationMinutes !== null && !presets.includes(props.durationMinutes));
let pendingDurationInput: { value: number | null } | undefined;
const durationChoice = computed(() =>
  customDuration.value ? "custom" : props.durationMinutes === null ? "unknown" : String(props.durationMinutes)
);
watch(
  () => props.durationMinutes,
  (value) => {
    const fromCurrentInput = pendingDurationInput && Object.is(pendingDurationInput.value, value);
    pendingDurationInput = undefined;
    // An external reset must restore unknown/preset mode. A local text edit may
    // temporarily be empty or equal a preset without closing the focused input.
    if (!fromCurrentInput) customDuration.value = value !== null && !presets.includes(value);
  }
);
watch(
  () => props.date,
  (value) => {
    if (parseMatchDate(value)) invalid.value = false;
  }
);
watch(
  () => props.disabled,
  (value) => {
    if (value) open.value = false;
  }
);
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const days = computed(() => calendarDays(year.value, month.value));
const years = computed(() =>
  Array.from(new Set([...Array.from({ length: 151 }, (_, index) => now.getFullYear() - 100 + index), year.value])).sort(
    (a, b) => a - b
  )
);
const minutes = Array.from({ length: 60 }, (_, index) => pad(index));
const draftTime = computed(() => (hour.value ? `${hour.value}:${minute.value}` : ""));
watch([year, month], () => {
  if (!days.value.includes(focusDate.value))
    focusDate.value = `${String(year.value).padStart(4, "0")}-${pad(month.value)}-01`;
});
function syncMonth() {
  if (!parseMatchDate(draftDate.value)) return;
  year.value = Number(draftDate.value.slice(0, 4));
  month.value = Number(draftDate.value.slice(5, 7));
  focusDate.value = draftDate.value;
}
function openPicker() {
  if (props.disabled) return;
  draftDate.value = parseMatchDate(props.date) ? props.date : today;
  hour.value = validKickoff(props.kickoff) ? props.kickoff.slice(0, 2) : "";
  minute.value = validKickoff(props.kickoff) ? props.kickoff.slice(3, 5) : "00";
  error.value = "";
  syncMonth();
  open.value = true;
}
function onInvalid() {
  invalid.value = true;
  openPicker();
  error.value = "请选择有效的比赛开始日期。";
}
function selectDate(value: string) {
  draftDate.value = value;
  error.value = "";
  syncMonth();
}
function shiftMonth(delta: number) {
  const next = year.value * 12 + month.value - 1 + delta;
  if (next < 0 || next >= 10000 * 12) return;
  year.value = Math.floor(next / 12);
  month.value = (next % 12) + 1;
}
async function calendarKey(event: KeyboardEvent, day: string) {
  const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  const parsed = parseMatchDate(day);
  if (!parsed) return;
  if (event.key in delta) parsed.setUTCDate(parsed.getUTCDate() + delta[event.key]);
  else if (event.key === "Home") parsed.setUTCDate(parsed.getUTCDate() - ((parsed.getUTCDay() + 6) % 7));
  else if (event.key === "End") parsed.setUTCDate(parsed.getUTCDate() + 6 - ((parsed.getUTCDay() + 6) % 7));
  else if (event.key === "PageUp" || event.key === "PageDown") {
    const date = parsed.getUTCDate();
    parsed.setUTCDate(1);
    parsed.setUTCMonth(parsed.getUTCMonth() + (event.key === "PageUp" ? -1 : 1));
    const last = new Date(parsed);
    last.setUTCMonth(last.getUTCMonth() + 1);
    last.setUTCDate(0);
    parsed.setUTCDate(Math.min(date, last.getUTCDate()));
  } else return;
  event.preventDefault();
  if (parsed.getUTCFullYear() < 0 || parsed.getUTCFullYear() > 9999) return;
  focusDate.value = parsed.toISOString().slice(0, 10);
  year.value = parsed.getUTCFullYear();
  month.value = parsed.getUTCMonth() + 1;
  await nextTick();
  calendar.value?.querySelector<HTMLButtonElement>(`[data-date="${focusDate.value}"]`)?.focus();
}
function confirm() {
  if (!parseMatchDate(draftDate.value)) {
    error.value = "请输入有效日期，格式为 YYYY-MM-DD。";
    return;
  }
  if (draftTime.value && !validKickoff(draftTime.value)) {
    error.value = "请选择有效的开始时间。";
    return;
  }
  emit("update:date", draftDate.value);
  emit("update:kickoff", draftTime.value);
  invalid.value = false;
  open.value = false;
}
function chooseDuration(value: unknown) {
  pendingDurationInput = undefined;
  customDuration.value = value === "custom";
  if (value === "unknown") emit("update:durationMinutes", null);
  else if (value !== "custom") emit("update:durationMinutes", Number(value));
}
function setDuration(event: Event) {
  const input = event.target as HTMLInputElement;
  const update = { value: input.value === "" ? null : input.valueAsNumber };
  pendingDurationInput = update;
  emit("update:durationMinutes", update.value);
  // Equal-value assignments do not run the watcher. Do not let that marker
  // accidentally classify a later external reset as this old input event.
  void nextTick(() => {
    if (pendingDurationInput === update) pendingDurationInput = undefined;
  });
}
</script>
<style scoped>
.match-schedule-picker {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(140px, 1fr);
  gap: 10px 18px;
  min-width: 0;
  position: relative;
}
.schedule-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}
.schedule-trigger {
  width: 100%;
  justify-content: space-between;
  text-align: left;
  white-space: normal;
  min-height: 43px;
}
.schedule-trigger span {
  overflow-wrap: anywhere;
}
.schedule-trigger svg {
  flex-shrink: 0;
}
.match-schedule-duration,
.match-schedule-custom {
  display: flex;
  flex-direction: column;
}
.schedule-summary,
.schedule-error {
  grid-column: 1 / -1;
  font-size: 12px;
  margin: 0;
}
.schedule-summary {
  color: var(--color-text-muted);
}
.schedule-error {
  color: var(--color-danger);
}
.schedule-validity-bridge {
  position: absolute;
  width: 1px !important;
  height: 1px;
  min-height: 0 !important;
  padding: 0 !important;
  opacity: 0;
  pointer-events: none;
}
.schedule-panel {
  max-width: 420px;
  margin: auto;
}
.calendar-toolbar {
  display: grid;
  grid-template-columns: 38px minmax(0, 1.2fr) minmax(0, 1fr) 38px;
  gap: 8px;
  align-items: end;
}
.calendar-toolbar label,
.schedule-time-fields label,
.schedule-manual label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}
.calendar-toolbar > button {
  padding: 5px;
  min-height: 40px;
  font-size: 24px;
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  margin-top: 18px;
}
.calendar-weekday {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 5px 0;
}
.calendar-grid button {
  min-width: 0;
  min-height: 38px;
  padding: 4px;
  background: var(--color-surface);
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--color-text);
  cursor: pointer;
  font: inherit;
}
.calendar-grid button.outside {
  color: var(--color-text-muted);
  background: var(--color-bg);
}
.calendar-grid button.today {
  border-color: var(--color-brand);
}
.calendar-grid button:hover,
.calendar-grid button:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 0;
}
.calendar-grid button.selected {
  background: var(--color-brand);
  color: var(--color-on-brand);
  font-weight: 700;
}
.calendar-shortcuts {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 12px 0;
  font-size: 12px;
  color: var(--color-text-muted);
}
.schedule-time-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 15px 0;
}
.schedule-manual {
  margin-bottom: 16px;
  font-size: 12px;
}
.schedule-manual summary {
  cursor: pointer;
  color: var(--color-brand);
  margin-bottom: 8px;
}
.schedule-manual input {
  width: 100%;
  border: 1px solid var(--color-border-strong);
  background: var(--color-surface);
  color: var(--color-text);
  border-radius: 4px;
  padding: 10px 12px;
  font: inherit;
}
@media (max-width: 500px) {
  .match-schedule-picker {
    grid-template-columns: 1fr;
  }
  .calendar-toolbar {
    gap: 5px;
    grid-template-columns: 32px minmax(0, 1.2fr) minmax(0, 1fr) 32px;
  }
}
</style>
