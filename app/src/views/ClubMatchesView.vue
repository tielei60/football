<template>
  <div class="club-heading">
    <div>
      <h1>球队比赛</h1>
      <p class="club-muted">发布比赛、报名与赛后记录，都在这里。</p>
    </div>
    <button v-if="auth.isAdmin" class="primary" @click="creating = !creating">
      {{ creating ? "收起" : "新建比赛" }}
    </button>
  </div>
  <p v-if="error" role="alert" class="club-error">{{ error }}</p>
  <form v-if="creating" class="club-card" @submit.prevent="create">
    <h2>安排一场比赛</h2>
    <div class="club-fields">
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
    <button class="primary" :disabled="busy">创建草稿</button>
    <p class="club-muted" style="margin-top: 12px">草稿仅管理员可见，发布后球员即可报名。</p>
  </form>
  <div class="club-actions" style="margin-bottom: 20px">
    <label>
      筛选状态
      <select v-model="filter">
        <option value="">全部比赛</option>
        <option v-for="(name, key) in matchStatuses" :key="key" :value="key">{{ name }}</option>
      </select>
    </label>
  </div>
  <p v-if="loading" role="status">正在载入比赛…</p>
  <div v-else class="club-grid">
    <article v-for="m in filtered" :key="m.id" class="club-card">
      <div class="club-heading" style="margin-bottom: 16px">
        <span class="club-tag">{{ matchStatuses[m.status] }}</span>
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
import { clubApi, unknown, matchStatuses, type ClubMatch } from "@/services/clubApi";

const auth = useAuthStore();
const router = useRouter();
const matches = ref<ClubMatch[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const creating = ref(false);
const opponent = ref("");
const date = ref("");
const kickoff = ref("");
const location = ref("");
const filter = ref("");
const filtered = computed(() =>
  matches.value.filter((m) => !filter.value || m.status === filter.value).sort((a, b) => b.date.localeCompare(a.date))
);
async function create() {
  busy.value = true;
  error.value = "";
  try {
    const m = await clubApi<ClubMatch>("/matches", "POST", {
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
onMounted(async () => {
  try {
    matches.value = await clubApi<ClubMatch[]>("/matches");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>
