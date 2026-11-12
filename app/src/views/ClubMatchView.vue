<template>
  <RouterLink to="/club" style="color: #326143">← 全部比赛</RouterLink>
  <p v-if="error" role="alert" class="club-error" style="margin-top: 16px">{{ error }}</p>
  <p v-if="success" role="status" class="club-success">{{ success }}</p>
  <p v-if="loading" role="status">正在载入比赛…</p>
  <template v-if="match">
    <div class="club-heading" style="margin-top: 24px">
      <div>
        <span class="club-tag">{{ matchStatuses[match.status] }}</span>
        <h1 style="margin-top: 10px">{{ auth.session?.team.name }} vs {{ match.opponent }}</h1>
        <p class="club-muted">{{ match.date }} {{ match.kickoff }} · {{ match.location || "地点待定" }}</p>
      </div>
      <span v-if="match.status === 'completed'" class="club-score">
        {{ unknown(match.homeScore) }} : {{ unknown(match.awayScore) }}
      </span>
    </div>
    <section v-if="auth.session?.user.playerId" class="club-card">
      <h2>我的报名</h2>
      <p class="club-muted">
        当前：{{ ownRsvp ? rsvpLabels[ownRsvp] : "尚未报名" }}。报名只表达参赛意愿，赛后出场由管理员确认。
      </p>
      <div v-if="match.status === 'published'" class="club-actions">
        <button
          v-for="(label, response) in rsvpLabels"
          :key="response"
          :class="{ primary: ownRsvp === response }"
          :disabled="busy"
          @click="rsvp(response)"
        >
          {{ label }}
        </button>
      </div>
      <p v-else class="club-muted">当前比赛状态不开放报名。</p>
    </section>
    <form v-if="auth.isAdmin && form" class="club-card" @submit.prevent="saveMatch">
      <h2>比赛信息与分析</h2>
      <div class="club-fields">
        <label>
          对手
          <input v-model="form.opponent" required />
        </label>
        <label>
          日期
          <input v-model="form.date" type="date" required />
        </label>
        <label>
          开球时间
          <input v-model="form.kickoff" type="time" />
        </label>
        <label>
          地点
          <input v-model="form.location" />
        </label>
        <label>
          发布状态
          <select v-model="form.status">
            <option v-for="(label, value) in matchStatuses" :key="value" :value="value">{{ label }}</option>
          </select>
        </label>
        <label>
          本队比分
          <input v-model="form.homeScore" type="number" min="0" placeholder="未知" />
        </label>
        <label>
          对手比分
          <input v-model="form.awayScore" type="number" min="0" placeholder="未知" />
        </label>
      </div>
      <label>
        赛前计划 / 赛后分析
        <textarea v-model="form.analysis" rows="4" placeholder="阵型安排、比赛观察与下一场的改进点" />
      </label>
      <h3 style="margin-top: 18px">关联战术</h3>
      <div class="club-actions">
        <label v-for="t in tactics" :key="t.id">
          <input v-model="form.tacticIds" type="checkbox" :value="t.id" />
          {{ t.name }}
        </label>
      </div>
      <p v-if="!tactics.length" class="club-muted">暂无战术，请先在战术板保存战术。</p>
      <button style="margin-top: 18px" class="primary" :disabled="busy">保存比赛信息</button>
    </form>
    <section class="club-card">
      <h2>报名情况</h2>
      <div class="club-grid">
        <div v-for="(label, response) in rsvpLabels" :key="response">
          <h3>{{ label }} · {{ match.rsvps.filter((r) => r.response === response).length }}</h3>
          <p class="club-muted">
            {{
              match.rsvps
                .filter((r) => r.response === response)
                .map((r) => playerName(r.playerId))
                .join("、") || "暂无"
            }}
          </p>
        </div>
      </div>
    </section>
    <section class="club-card">
      <div class="club-heading">
        <div>
          <h2>比赛名单与实际出场</h2>
          <p class="club-muted">
            报名与名单独立。出场、进球、助攻未记录时请保留“未知”。如需增加进球或助攻总数，请先更新并保存本队比分。
          </p>
        </div>
      </div>
      <div v-if="auth.isAdmin" class="club-actions" style="margin-bottom: 16px">
        <label>
          添加至名单
          <select v-model="addPlayerId">
            <option value="">选择球员</option>
            <option v-for="p in availablePlayers" :key="p.id" :value="p.id">
              {{ p.name }}{{ p.status === "inactive" ? "（已归档）" : "" }}
            </option>
          </select>
        </label>
        <button :disabled="!addPlayerId" @click="addPlayer">添加球员</button>
        <button @click="addRegistered">加入已报名参加者</button>
      </div>
      <div class="club-table-wrap">
        <table>
          <thead>
            <tr>
              <th>球员</th>
              <th>比赛位置</th>
              <th>实际出场</th>
              <th>进球</th>
              <th>助攻</th>
              <th v-if="auth.isAdmin">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, index) in roster" :key="r.playerId">
              <td>{{ playerName(r.playerId) }}</td>
              <template v-if="auth.isAdmin">
                <td>
                  <input v-model="r.position" :aria-label="`${playerName(r.playerId)}比赛位置`" placeholder="未知" />
                </td>
                <td>
                  <select
                    v-model="r.appeared"
                    :aria-label="`${playerName(r.playerId)}实际出场`"
                    @change="clearUnplayed(r)"
                  >
                    <option :value="null">未知</option>
                    <option :value="true">已出场</option>
                    <option :value="false">未出场</option>
                  </select>
                </td>
                <td>
                  <input
                    v-model="r.goals"
                    type="number"
                    min="0"
                    placeholder="未知"
                    :disabled="r.appeared !== true"
                    :aria-label="`${playerName(r.playerId)}进球`"
                  />
                </td>
                <td>
                  <input
                    v-model="r.assists"
                    type="number"
                    min="0"
                    placeholder="未知"
                    :disabled="r.appeared !== true"
                    :aria-label="`${playerName(r.playerId)}助攻`"
                  />
                </td>
                <td><button @click="roster.splice(index, 1)">移出</button></td>
              </template>
              <template v-else>
                <td>{{ r.position || "未知" }}</td>
                <td>{{ r.appeared === null ? "未知" : r.appeared ? "已出场" : "未出场" }}</td>
                <td>{{ unknown(r.goals) }}</td>
                <td>{{ unknown(r.assists) }}</td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!roster.length" class="club-empty">尚未录入比赛名单</p>
      <button v-if="auth.isAdmin" class="primary" style="margin-top: 18px" :disabled="busy" @click="saveRoster">
        保存名单与出场数据
      </button>
    </section>
    <section v-if="!auth.isAdmin" class="club-card">
      <h2>比赛分析与战术</h2>
      <p style="white-space: pre-wrap">{{ match.analysis || "暂无分析记录" }}</p>
      <article v-for="t in linkedTactics" :key="t.id" style="margin: 18px 0">
        <h3>{{ t.name }}</h3>
        <p v-if="t.description" class="club-muted">{{ t.description }}</p>
        <img
          v-if="t.thumbnail"
          :src="t.thumbnail"
          :alt="`${t.name}战术预览`"
          style="max-width: 100%; max-height: 380px; border-radius: 10px"
        />
        <p v-else class="club-muted">此战术暂无预览图，请向管理员了解具体安排。</p>
      </article>
      <p v-if="!linkedTactics.length" class="club-muted">尚未关联战术</p>
    </section>
  </template>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "@/stores/authStore";
import { clubApi, matchStatuses, unknown, type ClubMatch, type ClubPlayer, type Appearance } from "@/services/clubApi";

const auth = useAuthStore();
const route = useRoute();
const match = ref<ClubMatch | null>(null);
const form = ref<ClubMatch | null>(null);
const players = ref<ClubPlayer[]>([]);
const roster = ref<Appearance[]>([]);
const tactics = ref<{ id: number; name: string; thumbnail?: string; description?: string }[]>([]);
const addPlayerId = ref("");
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const success = ref("");
const rsvpLabels = { yes: "参加", no: "不参加", maybe: "待定" };
const ownRsvp = computed(() => match.value?.rsvps.find((r) => r.playerId === auth.session?.user.playerId)?.response);
const availablePlayers = computed(() => players.value.filter((p) => !roster.value.some((r) => r.playerId === p.id)));
const linkedTactics = computed(() => tactics.value.filter((t) => match.value?.tacticIds.includes(t.id)));
const playerName = (id: string) => players.value.find((p) => p.id === id)?.name || id;
const numberOrNull = (value: unknown) => (value === "" || value == null ? null : Number(value));
function apply(m: ClubMatch) {
  match.value = m;
  form.value = JSON.parse(JSON.stringify(m));
  roster.value = m.roster.map((r) => ({ ...r }));
}
async function action(run: () => Promise<void>, message: string) {
  busy.value = true;
  error.value = "";
  success.value = "";
  try {
    await run();
    success.value = message;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function rsvp(response: "yes" | "no" | "maybe") {
  await action(async () => {
    match.value = await clubApi<ClubMatch>(`/matches/${route.params.id}/rsvp`, "PUT", { response });
  }, "报名意愿已更新");
}
async function saveMatch() {
  await action(async () => {
    const f = form.value!;
    const m = await clubApi<ClubMatch>(`/matches/${route.params.id}`, "PUT", {
      opponent: f.opponent,
      date: f.date,
      kickoff: f.kickoff,
      location: f.location,
      status: f.status,
      homeScore: numberOrNull(f.homeScore),
      awayScore: numberOrNull(f.awayScore),
      analysis: f.analysis,
      tacticIds: f.tacticIds,
    });
    match.value = m;
    form.value = JSON.parse(JSON.stringify(m));
  }, "比赛信息已保存");
}
function addPlayer() {
  if (!addPlayerId.value) return;
  roster.value.push({ playerId: addPlayerId.value, position: "", appeared: null, goals: null, assists: null });
  addPlayerId.value = "";
}
function addRegistered() {
  match.value?.rsvps
    .filter((r) => r.response === "yes")
    .forEach((r) => {
      if (!roster.value.some((p) => p.playerId === r.playerId))
        roster.value.push({ playerId: r.playerId, position: "", appeared: null, goals: null, assists: null });
    });
}
function clearUnplayed(r: Appearance) {
  if (r.appeared !== true) {
    Object.assign(r, { goals: null, assists: null });
  }
}
async function saveRoster() {
  await action(async () => {
    const m = await clubApi<ClubMatch>(`/matches/${route.params.id}/roster`, "PUT", {
      roster: roster.value.map((r) => ({
        ...r,
        goals: r.appeared === true ? numberOrNull(r.goals) : null,
        assists: r.appeared === true ? numberOrNull(r.assists) : null,
      })),
    });
    match.value = m;
    roster.value = m.roster.map((r) => ({ ...r }));
  }, "名单与实际出场已保存");
}
onMounted(async () => {
  try {
    const [m, p, t] = await Promise.all([
      clubApi<ClubMatch>(`/matches/${route.params.id}`),
      clubApi<ClubPlayer[]>("/players"),
      clubApi<{ tacticId: number; title: string; thumbnail?: string }[]>("/tactics"),
    ]);
    apply(m);
    players.value = p;
    tactics.value = t.map((item) => ({ id: item.tacticId, name: item.title, thumbnail: item.thumbnail }));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
});
</script>
