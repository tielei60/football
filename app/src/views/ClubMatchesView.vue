<template>
  <div class="club-heading">
    <div>
      <span class="club-eyebrow">MATCHDAY / 比赛日程</span>
      <h1>球队比赛</h1>
      <p class="club-muted">发布比赛、报名与赛后记录，都在这里。</p>
    </div>
    <button v-if="auth.isAdmin" class="primary" :disabled="busy" @click="creating = !creating">
      {{ creating ? "收起" : "新建比赛" }}
    </button>
  </div>
  <div v-if="error" role="alert" class="club-error">
    <p>{{ error }}</p>
    <button type="button" :disabled="busy || loading" @click="load">重试载入比赛</button>
  </div>
  <p v-if="!creating && hasCreateDraft" role="status" class="club-muted">
    新比赛草稿已收起，填写内容仍保留，尚未创建比赛。
  </p>
  <form v-if="creating" class="club-card" @submit.prevent="create">
    <fieldset :disabled="busy">
      <h2>安排一场比赛</h2>
      <div class="club-fields">
        <MatchSuggestionField
          v-model="competition"
          label="赛事名称"
          :options="competitionOptions"
          :maxlength="150"
          placeholder="例如：周末联赛"
        />
        <label>
          比赛人数制
          <UiSelect v-model="format">
            <option :value="null">未知</option>
            <option v-for="count in [5, 6, 7, 8, 9, 11]" :key="count" :value="count">{{ count }} 人制</option>
          </UiSelect>
        </label>
        <label>
          主客场
          <UiSelect v-model="side">
            <option value="unknown">未知</option>
            <option value="home">主场</option>
            <option value="away">客场</option>
            <option value="neutral">中立场</option>
          </UiSelect>
        </label>
        <label>
          归属赛季
          <UiSelect v-model="seasonId">
            <option :value="null">暂未归属赛季</option>
            <option v-for="season in seasons" :key="season.id" :value="season.id">{{ season.name }}</option>
          </UiSelect>
        </label>
        <MatchSuggestionField v-model="opponent" label="对手" :options="opponentOptions" :maxlength="150" required />
        <label>
          球场
          <UiSelect v-model="venueId">
            <option :value="null">未选择 / 临时地点</option>
            <option v-for="venue in activeVenues" :key="venue.id" :value="venue.id">
              {{ venue.name }}{{ venue.address ? ` · ${venue.address}` : "" }}
            </option>
          </UiSelect>
        </label>
        <label v-if="venueId === null">
          地点
          <input v-model="location" maxlength="500" placeholder="未登记球场时可填写临时地点" />
        </label>
      </div>
      <p v-if="!activeVenues.length" class="club-muted">
        可先到
        <RouterLink to="/club/venues">球场管理</RouterLink>
        添加常用球场，也可填写临时地点。
      </p>
      <MatchSchedulePicker
        v-model:date="date"
        v-model:kickoff="kickoff"
        v-model:duration-minutes="durationMinutes"
        :disabled="busy"
      />
      <div class="club-fields">
        <label style="grid-column: 1 / -1">
          比赛须知 / 责任说明（可选）
          <textarea
            v-model="notice"
            maxlength="10000"
            rows="3"
            placeholder="集合安排、装备、天气或场地要求等，请填写实际需要告知球员的内容。"
          />
        </label>
      </div>
      <div class="club-actions">
        <button class="primary" :disabled="busy">{{ busy ? "正在创建…" : "创建草稿" }}</button>
        <button type="button" :disabled="busy" @click="cancelCreate">取消</button>
      </div>
      <p class="club-muted" style="margin-top: 12px">草稿仅管理员可见，发布后球员即可报名。</p>
    </fieldset>
  </form>
  <section v-if="!loading && nextMatch && !creating" class="club-card club-next-match" aria-label="下一场比赛">
    <div>
      <span class="club-eyebrow">NEXT MATCH / 下一场</span>
      <h2>vs {{ nextMatch.opponent }}</h2>
      <p class="club-muted">{{ formatSchedule(nextMatch) }} · {{ nextMatch.location || "地点待定" }}</p>
    </div>
    <RouterLink class="club-button primary" :to="`/club/matches/${nextMatch.id}`">
      {{ auth.isAdmin ? "准备这场比赛" : "查看本场与报名" }} →
    </RouterLink>
  </section>
  <section v-if="auth.session?.user.playerId && !loading" class="club-card" aria-label="我的报名统计">
    <h2>我的报名记录</h2>
    <p class="club-muted">全部已发布和已完赛比赛，按每场最后一次选择计数；重复点击不增加次数，取消比赛不计入。</p>
    <div class="registration-summary">
      <span>
        <strong>{{ registrationCounts.yes }}</strong>
        场报名参加
      </span>
      <span>
        <strong>{{ registrationCounts.no }}</strong>
        场请假 / 不参加
      </span>
      <span>
        <strong>{{ registrationCounts.maybe }}</strong>
        场待定
      </span>
      <span>
        <strong>{{ registrationCounts.unanswered }}</strong>
        场未报名
      </span>
    </div>
    <RouterLink to="/club/statistics">查看按赛季 / 年度统计 →</RouterLink>
  </section>
  <div class="club-filterbar">
    <label>
      筛选状态
      <UiSelect v-model="filter">
        <option value="">全部比赛</option>
        <option v-for="(name, key) in matchStatuses" :key="key" :value="key">{{ name }}</option>
      </UiSelect>
    </label>
    <label v-if="auth.session?.user.playerId">
      我的报名
      <UiSelect v-model="registrationFilter">
        <option value="">全部状态</option>
        <option value="yes">已参加报名</option>
        <option value="no">请假 / 不参加</option>
        <option value="maybe">待定</option>
        <option value="unanswered">未报名</option>
      </UiSelect>
    </label>
    <span class="club-muted">
      {{ filtered.length }} 场比赛 · {{ auth.isAdmin ? "草稿仅管理员可见" : "报名意愿与实际出场分开记录" }}
    </span>
  </div>
  <p v-if="loading" role="status" class="club-loading">正在载入比赛…</p>
  <div v-else class="club-grid">
    <article v-for="m in filtered" :key="m.id" class="club-card club-match-card">
      <img
        v-if="m.coverPhotoUrl"
        :src="m.coverPhotoUrl"
        :alt="`${m.opponent}比赛封面`"
        class="match-cover"
        loading="lazy"
      />
      <div class="club-heading" style="margin-bottom: 16px">
        <span class="club-tag" :data-status="m.status">{{ matchStatuses[m.status] }}</span>
        <span class="club-muted">{{ formatSchedule(m) }}</span>
      </div>
      <h2>vs {{ m.opponent }}</h2>
      <p class="club-muted">{{ m.location || "地点待定" }}</p>
      <p class="club-muted">{{ matchEndLabel(m) }}</p>
      <p v-if="auth.session?.user.playerId" class="club-tag">我的状态：{{ ownResponseLabel(m) }}</p>
      <p v-if="m.status === 'completed'" class="club-score">{{ unknown(m.homeScore) }} : {{ unknown(m.awayScore) }}</p>
      <p v-else class="club-muted">
        {{ m.rsvps.filter((r) => r.response === "yes").length }} 人参加 ·
        {{ m.rsvps.filter((r) => r.response === "no").length }} 人请假 / 不参加 ·
        {{ m.rsvps.filter((r) => r.response === "maybe").length }} 人待定
      </p>
      <RouterLink class="club-button" :to="`/club/matches/${m.id}`">
        {{ auth.isAdmin ? "管理比赛" : "查看与报名" }} →
      </RouterLink>
    </article>
  </div>
  <p v-if="!loading && !filtered.length" class="club-card club-empty">
    暂无比赛{{ filter ? "符合此状态" : "，准备好下一次上场了吗？" }}
  </p>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { confirmAction } from "@/components/ui/confirmAction";
import MatchSchedulePicker from "@/components/club/MatchSchedulePicker.vue";
import MatchSuggestionField from "@/components/club/MatchSuggestionField.vue";
import { formatSchedule, matchEndLabel } from "@/utils/matchSchedule";
import { useAuthStore } from "@/stores/authStore";
import {
  clubApi,
  unknown,
  matchStatuses,
  type Season,
  type ClubMatch,
  type ClubMatchSummary,
  type Venue,
} from "@/services/clubApi";

const auth = useAuthStore();
const router = useRouter();
const matches = ref<ClubMatchSummary[]>([]);
const seasons = ref<Season[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const creating = ref(false);
const opponent = ref("");
const competition = ref("");
const format = ref<ClubMatch["format"]>(null);
const side = ref<ClubMatch["side"]>("unknown");
const seasonId = ref<number | null>(null);
const date = ref("");
const kickoff = ref("");
const location = ref("");
const durationMinutes = ref<number | null>(90);
const venueId = ref<number | null>(null);
const notice = ref("");
const venues = ref<Venue[]>([]);
const activeVenues = computed(() => venues.value.filter((v) => v.status === "active"));
const competitionOptions = computed(() => [...new Set(matches.value.map((m) => m.competition).filter(Boolean))].sort());
const opponentOptions = computed(() => [...new Set(matches.value.map((m) => m.opponent).filter(Boolean))].sort());
const registrationFilter = ref("");
const ownResponse = (m: ClubMatchSummary) =>
  m.rsvps.find((r) => r.playerId === auth.session?.user.playerId)?.response || "unanswered";
const ownResponseLabel = (m: ClubMatchSummary) =>
  ({ yes: "报名参加", no: "请假 / 不参加", maybe: "待定", unanswered: "未报名" })[ownResponse(m)];
const registrationCounts = computed(() => {
  const result = { yes: 0, no: 0, maybe: 0, unanswered: 0 };
  for (const m of matches.value) if (["published", "completed"].includes(m.status)) result[ownResponse(m)]++;
  return result;
});
const filter = ref("");
const createdDestination = ref<string | null>(null);
const hasCreateDraft = computed(() =>
  Boolean(
    opponent.value ||
      competition.value ||
      date.value ||
      kickoff.value ||
      location.value ||
      venueId.value !== null ||
      notice.value ||
      format.value !== null ||
      side.value !== "unknown" ||
      seasonId.value !== null ||
      durationMinutes.value !== 90
  )
);
onBeforeRouteLeave((to) => {
  // A pending create must settle before leaving; only its own success redirect may continue.
  if (busy.value) return createdDestination.value === to.path;
  return (
    !hasCreateDraft.value ||
    confirmAction("新比赛尚未创建，离开会丢失当前填写内容。", {
      title: "离开新比赛草稿？",
      confirmText: "放弃填写并离开",
      cancelText: "继续填写",
    })
  );
});
function clearCreateDraft() {
  opponent.value = "";
  competition.value = "";
  format.value = null;
  side.value = "unknown";
  seasonId.value = null;
  date.value = "";
  kickoff.value = "";
  location.value = "";
  durationMinutes.value = 90;
  venueId.value = null;
  notice.value = "";
  creating.value = false;
}
async function cancelCreate() {
  if (busy.value) return;
  if (
    hasCreateDraft.value &&
    !(await confirmAction("放弃本次尚未创建的比赛？填写内容将清空。", {
      title: "放弃新比赛草稿？",
      confirmText: "放弃填写",
      cancelText: "继续填写",
      danger: true,
    }))
  )
    return;
  if (!busy.value) clearCreateDraft();
}
function warnCreateDraft(event: BeforeUnloadEvent) {
  if (hasCreateDraft.value || busy.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
onMounted(() => window.addEventListener("beforeunload", warnCreateDraft));
onUnmounted(() => window.removeEventListener("beforeunload", warnCreateDraft));
const filtered = computed(() =>
  matches.value
    .filter(
      (m) =>
        (!filter.value || m.status === filter.value) &&
        (!registrationFilter.value || ownResponse(m) === registrationFilter.value)
    )
    .sort((a, b) => `${b.date} ${b.kickoff}`.localeCompare(`${a.date} ${a.kickoff}`))
);
const nextMatch = computed(() => {
  const today = new Date().toLocaleDateString("sv-SE");
  return matches.value
    .filter((m) => m.status === "published" && m.date >= today)
    .sort((a, b) => `${a.date} ${a.kickoff}`.localeCompare(`${b.date} ${b.kickoff}`))[0];
});
async function create() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const m = await clubApi<ClubMatch>("/matches", "POST", {
      competition: competition.value,
      format: format.value,
      side: side.value,
      seasonId: seasonId.value,
      opponent: opponent.value,
      date: date.value,
      kickoff: kickoff.value,
      location: location.value,
      durationMinutes: durationMinutes.value,
      venueId: venueId.value,
      notice: notice.value,
    });
    createdDestination.value = `/club/matches/${m.id}`;
    // The write succeeded: clear the submitted draft even if navigation is interrupted.
    clearCreateDraft();
    matches.value = [m, ...matches.value.filter((existing) => existing.id !== m.id)];
    const navigationFailure = await router.push(createdDestination.value);
    if (navigationFailure) error.value = "比赛已创建，请从下方比赛列表打开。";
  } catch (e) {
    error.value = createdDestination.value
      ? "比赛已创建，但页面跳转未完成，请从下方比赛列表打开。"
      : (e as Error).message;
  } finally {
    createdDestination.value = null;
    busy.value = false;
  }
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    [matches.value, seasons.value, venues.value] = await Promise.all([
      clubApi<ClubMatchSummary[]>("/matches"),
      clubApi<Season[]>("/seasons"),
      clubApi<Venue[]>("/venues"),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>

<style scoped>
.registration-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 24px;
  margin: 14px 0;
}
.registration-summary strong {
  color: var(--color-brand);
  font-size: 24px;
}
.match-cover {
  width: 100%;
  height: 180px;
  object-fit: cover;
  border-radius: var(--radius-md, 8px);
  margin-bottom: 16px;
}
</style>
