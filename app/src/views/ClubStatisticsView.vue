<template>
  <div class="club-heading">
    <div>
      <h1>统计与赛季</h1>
      <p class="club-muted">自定义赛季和自然年度分别统计，仅计入已完赛比赛。</p>
    </div>
    <button v-if="auth.isAdmin" @click="editSeason()">新建赛季</button>
  </div>
  <p v-if="error" class="club-error" role="alert">{{ error }}</p>
  <form v-if="seasonForm" class="club-card" @submit.prevent="saveSeason">
    <h2>{{ seasonForm.id ? "编辑赛季" : "新建赛季" }}</h2>
    <div class="club-fields">
      <label>
        赛季名称
        <input v-model="seasonForm.name" placeholder="2026–2027 赛季" required />
      </label>
      <label>
        开始日期
        <input v-model="seasonForm.startDate" type="date" required />
      </label>
      <label>
        结束日期
        <input v-model="seasonForm.endDate" type="date" :min="seasonForm.startDate" required />
      </label>
    </div>
    <div class="club-actions">
      <button class="primary" :disabled="busy">保存赛季</button>
      <button type="button" @click="seasonForm = null">取消</button>
    </div>
  </form>
  <section class="club-card">
    <div class="club-fields">
      <label>
        统计周期
        <select v-model="mode" @change="loadStats">
          <option value="year">自然年度</option>
          <option value="season">自定义赛季</option>
        </select>
      </label>
      <label v-if="mode === 'year'">
        年份
        <input v-model.number="year" type="number" min="1900" max="2200" @change="loadStats" />
      </label>
      <label v-else>
        赛季
        <select v-model="seasonId" @change="loadStats">
          <option value="" disabled>请选择赛季</option>
          <option v-for="s in seasons" :key="s.id" :value="s.id">
            {{ s.name }}（{{ s.startDate }} 至 {{ s.endDate }}）
          </option>
        </select>
      </label>
    </div>
    <p v-if="loading" role="status">正在计算统计…</p>
    <template v-else-if="stats">
      <h2>{{ stats.filter.label }} · {{ stats.matches }} 场已完赛</h2>
      <p class="club-muted">{{ stats.filter.startDate }} 至 {{ stats.filter.endDate }}（含首尾日期）</p>
      <div class="club-table-wrap">
        <table>
          <thead>
            <tr>
              <th>球员</th>
              <th>确认出场</th>
              <th>出场待确认</th>
              <th>已知进球</th>
              <th>进球记录覆盖</th>
              <th>已知助攻</th>
              <th>助攻记录覆盖</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in stats.players" :key="p.playerId">
              <td>{{ p.name }}</td>
              <td>{{ p.appearances }}</td>
              <td>{{ p.unknownAppearances }}</td>
              <td>{{ unknown(p.goals) }}</td>
              <td>{{ p.goalsKnownMatches }} / {{ p.appearances }} 场</td>
              <td>{{ unknown(p.assists) }}</td>
              <td>{{ p.assistsKnownMatches }} / {{ p.appearances }} 场</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="club-muted" style="font-size: 13px; margin-top: 18px">
        报名不等于出场；空白数据记为未知，不按 0 计算。进球和助攻是已记录数据的合计，请结合覆盖场数阅读。
      </p>
    </template>
    <p v-else class="club-empty">{{ mode === "season" ? "请先选择或创建赛季" : "暂无统计数据" }}</p>
  </section>
  <section class="club-card">
    <h2>赛季管理</h2>
    <p v-if="!seasons.length" class="club-muted">暂无赛季。赛季可跨自然年，日期范围可重叠。</p>
    <div v-for="s in seasons" :key="s.id" class="club-heading" style="margin-bottom: 12px">
      <div>
        <strong>{{ s.name }}</strong>
        <div class="club-muted">{{ s.startDate }} 至 {{ s.endDate }}</div>
      </div>
      <button v-if="auth.isAdmin" @click="editSeason(s)">编辑</button>
    </div>
  </section>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { clubApi, unknown, type Season, type Statistics } from "@/services/clubApi";

const auth = useAuthStore();
const seasons = ref<Season[]>([]);
const seasonForm = ref<Season | null>(null);
const stats = ref<Statistics | null>(null);
const mode = ref("year");
const year = ref(new Date().getFullYear());
const seasonId = ref<number | "">("");
const error = ref("");
const loading = ref(false);
const busy = ref(false);
let request = 0;
function editSeason(s?: Season) {
  seasonForm.value = s ? { ...s } : { id: 0, name: "", startDate: "", endDate: "" };
}
async function loadStats() {
  const current = ++request;
  error.value = "";
  stats.value = null;
  if (mode.value === "season" && !seasonId.value) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const result = await clubApi<Statistics>(
      `/statistics?${mode.value === "year" ? `year=${year.value}` : `seasonId=${seasonId.value}`}`
    );
    if (current === request) stats.value = result;
  } catch (e) {
    if (current === request) error.value = (e as Error).message;
  } finally {
    if (current === request) loading.value = false;
  }
}
async function saveSeason() {
  if (!seasonForm.value) return;
  busy.value = true;
  error.value = "";
  try {
    const s = seasonForm.value;
    await clubApi(`/seasons${s.id ? `/${s.id}` : ""}`, s.id ? "PUT" : "POST", {
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
    });
    seasons.value = await clubApi<Season[]>("/seasons");
    seasonForm.value = null;
    await loadStats();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  try {
    seasons.value = await clubApi<Season[]>("/seasons");
    await loadStats();
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>
