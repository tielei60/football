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
  <form v-if="creating" class="club-card" @submit.prevent="create">
    <fieldset :disabled="busy">
      <h2>安排一场比赛</h2>
      <div class="club-fields">
        <label>
          赛事名称
          <input v-model="competition" maxlength="150" placeholder="例如：周末联赛" />
        </label>
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
        <label>
          对手
          <input v-model="opponent" required maxlength="150" />
        </label>
        <label>
          比赛日期
          <input v-model="date" type="date" required />
        </label>
        <label>
          开球时间
          <input v-model="kickoff" type="time" />
        </label>
        <label>
          地点
          <input v-model="location" maxlength="200" />
        </label>
      </div>
      <div class="club-actions">
        <button class="primary" :disabled="busy">{{ busy ? "正在创建…" : "创建草稿" }}</button>
        <button type="button" :disabled="busy" @click="creating = false">取消</button>
      </div>
      <p class="club-muted" style="margin-top: 12px">草稿仅管理员可见，发布后球员即可报名。</p>
    </fieldset>
  </form>
  <section v-if="!loading && nextMatch && !creating" class="club-card club-next-match" aria-label="下一场比赛">
    <div>
      <span class="club-eyebrow">NEXT MATCH / 下一场</span>
      <h2>vs {{ nextMatch.opponent }}</h2>
      <p class="club-muted">
        {{ nextMatch.date }} {{ nextMatch.kickoff || "时间待定" }} · {{ nextMatch.location || "地点待定" }}
      </p>
    </div>
    <RouterLink class="club-button primary" :to="`/club/matches/${nextMatch.id}`">
      {{ auth.isAdmin ? "准备这场比赛" : "查看本场与报名" }} →
    </RouterLink>
  </section>
  <div class="club-filterbar">
    <label>
      筛选状态
      <UiSelect v-model="filter">
        <option value="">全部比赛</option>
        <option v-for="(name, key) in matchStatuses" :key="key" :value="key">{{ name }}</option>
      </UiSelect>
    </label>
    <span class="club-muted">
      {{ filtered.length }} 场比赛 · {{ auth.isAdmin ? "草稿仅管理员可见" : "报名意愿与实际出场分开记录" }}
    </span>
  </div>
  <p v-if="loading" role="status" class="club-loading">正在载入比赛…</p>
  <div v-else class="club-grid">
    <article v-for="m in filtered" :key="m.id" class="club-card club-match-card">
      <div class="club-heading" style="margin-bottom: 16px">
        <span class="club-tag" :data-status="m.status">{{ matchStatuses[m.status] }}</span>
        <span class="club-muted">{{ m.date }} {{ m.kickoff }}</span>
      </div>
      <h2>vs {{ m.opponent }}</h2>
      <p class="club-muted">{{ m.location || "地点待定" }}</p>
      <p v-if="m.status === 'completed'" class="club-score">{{ unknown(m.homeScore) }} : {{ unknown(m.awayScore) }}</p>
      <p v-else class="club-muted">
        {{ m.rsvps.filter((r) => r.response === "yes").length }} 人参加 ·
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
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/authStore";
import {
  clubApi,
  unknown,
  matchStatuses,
  type Season,
  type ClubMatch,
  type ClubMatchSummary,
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
const filter = ref("");
const filtered = computed(() =>
  matches.value.filter((m) => !filter.value || m.status === filter.value).sort((a, b) => b.date.localeCompare(a.date))
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
    });
    await router.push(`/club/matches/${m.id}`);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function load() {
  loading.value = true;
  error.value = "";
  try {
    [matches.value, seasons.value] = await Promise.all([
      clubApi<ClubMatchSummary[]>("/matches"),
      clubApi<Season[]>("/seasons"),
    ]);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
