<template>
  <RouterLink to="/club" style="color: #326143">← 全部比赛</RouterLink>
  <div v-if="error" role="alert" class="club-error" style="margin-top: 16px">
    <p>{{ error }}</p>
    <button type="button" :disabled="busy || loading" @click="load">重新载入比赛（放弃未保存修改）</button>
  </div>
  <p v-if="success" role="status" class="club-success">{{ success }}</p>
  <p v-if="loading" role="status">正在载入比赛…</p>
  <template v-if="match">
    <div class="club-heading club-match-heading" style="margin-top: 24px">
      <div>
        <span class="club-tag">{{ matchStatuses[match.status] }}</span>
        <h1 style="margin-top: 10px">{{ auth.session?.team.name }} vs {{ match.opponent }}</h1>
        <p class="club-muted">
          {{ match.competition || "赛事未指定" }} · {{ match.format ? `${match.format} 人制` : "人数制未知" }} ·
          {{ sideLabels[match.side] }} · {{ seasons.find((s) => s.id === match?.seasonId)?.name || "暂未归属赛季" }}
        </p>
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
      <fieldset :disabled="busy || loading">
        <h2>比赛信息与分析</h2>
        <div class="club-fields">
          <label>
            赛事名称
            <input v-model="form.competition" maxlength="150" placeholder="例如：周末联赛" />
          </label>
          <label>
            比赛人数制
            <select v-model="form.format">
              <option :value="null">未知</option>
              <option v-for="count in [5, 6, 7, 8, 9, 11]" :key="count" :value="count">{{ count }} 人制</option>
            </select>
          </label>
          <label>
            主客场
            <select v-model="form.side">
              <option value="unknown">未知</option>
              <option value="home">主场</option>
              <option value="away">客场</option>
              <option value="neutral">中立场</option>
            </select>
          </label>
          <label>
            归属赛季
            <select v-model="form.seasonId">
              <option :value="null">暂未归属赛季</option>
              <option v-for="season in seasons" :key="season.id" :value="season.id">{{ season.name }}</option>
            </select>
          </label>
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
        <p class="club-muted">
          选择战术并保存时会保留独立快照，之后模板变化或删除不影响本场历史。需要改用新版时，先移除并保存，再重新加入。
        </p>
        <div class="club-actions">
          <label v-for="t in tacticOptions" :key="t.id">
            <input v-model="form.tacticIds" type="checkbox" :value="t.id" />
            {{ t.name }}
          </label>
        </div>
        <p v-if="!tacticOptions.length" class="club-muted">暂无战术，请先在战术板保存战术。</p>
        <button style="margin-top: 18px" class="primary" :disabled="busy">保存比赛信息</button>
      </fieldset>
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
      <fieldset :disabled="busy || loading">
        <div class="club-heading">
          <div>
            <h2>比赛名单与实际出场</h2>
            <p class="club-muted">
              报名与名单独立，未记录的数据保持“未知”。
              <template v-if="auth.isAdmin">如需增加进球或助攻总数，请先更新并保存本队比分。</template>
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
        <ClubTableWrap label="比赛名单表">
          <table>
            <thead>
              <tr>
                <th>球员</th>
                <th>比赛时号码</th>
                <th>比赛位置</th>
                <th>首发 / 替补</th>
                <th>实际出场</th>
                <th>进球</th>
                <th>助攻</th>
                <th v-if="auth.isAdmin">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, index) in roster" :key="r.playerId">
                <td>
                  {{ rosterName(r) }}
                  <small v-if="r.snapshotSource === 'migration'" class="club-muted" style="display: block">
                    迁移时补录
                  </small>
                </td>
                <td>
                  {{
                    unknown(
                      r.playerSnapshot ? r.playerSnapshot.number : players.find((p) => p.id === r.playerId)?.number
                    )
                  }}
                </td>
                <template v-if="auth.isAdmin">
                  <td>
                    <input v-model="r.position" :aria-label="`${rosterName(r)}比赛位置`" placeholder="未知" />
                  </td>
                  <td>
                    <select v-model="r.selection" :aria-label="`${rosterName(r)}首发替补`">
                      <option value="unknown">未知</option>
                      <option value="starter">首发</option>
                      <option value="bench">替补</option>
                    </select>
                  </td>
                  <td>
                    <select v-model="r.appeared" :aria-label="`${rosterName(r)}实际出场`" @change="clearUnplayed(r)">
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
                      :aria-label="`${rosterName(r)}进球`"
                    />
                  </td>
                  <td>
                    <input
                      v-model="r.assists"
                      type="number"
                      min="0"
                      placeholder="未知"
                      :disabled="r.appeared !== true"
                      :aria-label="`${rosterName(r)}助攻`"
                    />
                  </td>
                  <td><button @click="roster.splice(index, 1)">移出</button></td>
                </template>
                <template v-else>
                  <td>{{ r.position || "未知" }}</td>
                  <td>{{ { starter: "首发", bench: "替补", unknown: "未知" }[r.selection] || "未知" }}</td>
                  <td>{{ r.appeared === null ? "未知" : r.appeared ? "已出场" : "未出场" }}</td>
                  <td>{{ unknown(r.goals) }}</td>
                  <td>{{ unknown(r.assists) }}</td>
                </template>
              </tr>
            </tbody>
          </table>
        </ClubTableWrap>
        <p v-if="!roster.length" class="club-empty">尚未录入比赛名单</p>
        <button v-if="auth.isAdmin" class="primary" style="margin-top: 18px" :disabled="busy" @click="saveRoster">
          保存名单与出场数据
        </button>
      </fieldset>
    </section>
    <section class="club-card" aria-label="已保存比赛战术">
      <h2>比赛分析与战术快照</h2>
      <p v-if="!auth.isAdmin" style="white-space: pre-wrap">{{ match.analysis || "暂无分析记录" }}</p>
      <p class="club-muted">这里查看的是保存到本场比赛的内容，模板和球员资料的后续修改不会改变这些快照。</p>
      <p v-if="hasMigratedSnapshots" class="club-muted">
        部分旧记录的快照是在系统迁移时按当时资料补录的，并非真实赛时资料还原。
      </p>
      <article v-for="snapshot in match.tacticSnapshots" :key="snapshot.sourceTacticId" style="margin: 18px 0">
        <p class="club-muted">
          {{ snapshot.captureSource === "migration" ? "迁移补录" : "关联时保存" }} ·
          {{ new Date(snapshot.capturedAt).toLocaleString() }}
        </p>
        <SnapshotTacticView :tactic="snapshot.tactic" />
      </article>
      <p v-if="!match.tacticSnapshots.length" class="club-muted">尚未关联战术</p>
    </section>
  </template>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import SnapshotTacticView from "@/components/SnapshotTacticView.vue";
import ClubTableWrap from "@/components/ClubTableWrap.vue";
import { useAuthStore } from "@/stores/authStore";
import {
  clubApi,
  ClubApiError,
  matchStatuses,
  unknown,
  type Season,
  type ClubMatch,
  type ClubPlayer,
  type Appearance,
} from "@/services/clubApi";

const auth = useAuthStore();
const route = useRoute();
const match = ref<ClubMatch | null>(null);
const form = ref<ClubMatch | null>(null);
const players = ref<ClubPlayer[]>([]);
const roster = ref<Appearance[]>([]);
const rosterRevision = ref(0);
const tactics = ref<{ id: number; name: string; thumbnail?: string; description?: string }[]>([]);
const addPlayerId = ref("");
const seasons = ref<Season[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref("");
const success = ref("");
const sideLabels = { home: "主场", away: "客场", neutral: "中立场", unknown: "主客场未知" };
const rsvpLabels = { yes: "参加", no: "不参加", maybe: "待定" };
const ownRsvp = computed(() => match.value?.rsvps.find((r) => r.playerId === auth.session?.user.playerId)?.response);
const availablePlayers = computed(() => players.value.filter((p) => !roster.value.some((r) => r.playerId === p.id)));
const tacticOptions = computed(() => {
  const saved = match.value?.tacticSnapshots ?? [];
  return [
    ...saved.map((s) => ({
      id: s.sourceTacticId,
      name: `${s.tactic.title}（比赛快照${tactics.value.some((t) => t.id === s.sourceTacticId) ? "" : "，模板已删除"}）`,
    })),
    ...tactics.value.filter((t) => !saved.some((s) => s.sourceTacticId === t.id)),
  ];
});
const hasMigratedSnapshots = computed(
  () =>
    match.value?.tacticSnapshots.some((s) => s.captureSource === "migration") ||
    roster.value.some((r) => r.snapshotSource === "migration")
);
const playerName = (id: string) => players.value.find((p) => p.id === id)?.name || id;
const rosterName = (r: Appearance) => r.playerSnapshot?.name || playerName(r.playerId);
const numberOrNull = (value: unknown) => (value === "" || value == null ? null : Number(value));
function apply(m: ClubMatch) {
  match.value = m;
  rosterRevision.value = m.revision;
  form.value = JSON.parse(JSON.stringify(m));
  roster.value = m.roster.map((r) => ({ ...r }));
}
async function action(run: () => Promise<void>, message: string) {
  if (busy.value || loading.value) return;
  busy.value = true;
  error.value = "";
  success.value = "";
  try {
    await run();
    success.value = message;
  } catch (e) {
    error.value =
      e instanceof ClubApiError && e.status === 409
        ? "比赛已被其他操作更新。你的输入已保留，请先复制需要的内容，再重新载入最新比赛。"
        : (e as Error).message;
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
      revision: f.revision,
      competition: f.competition,
      format: f.format,
      side: f.side,
      seasonId: f.seasonId,
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
    rosterRevision.value = m.revision;
  }, "比赛信息已保存");
}
function addPlayer() {
  if (!addPlayerId.value) return;
  roster.value.push({
    playerId: addPlayerId.value,
    position: "",
    selection: "unknown",
    appeared: null,
    goals: null,
    assists: null,
  });
  addPlayerId.value = "";
}
function addRegistered() {
  match.value?.rsvps
    .filter((r) => r.response === "yes")
    .forEach((r) => {
      if (!roster.value.some((p) => p.playerId === r.playerId))
        roster.value.push({
          playerId: r.playerId,
          position: "",
          selection: "unknown",
          appeared: null,
          goals: null,
          assists: null,
        });
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
      revision: rosterRevision.value,
      roster: roster.value.map((r) => ({
        playerId: r.playerId,
        position: r.position,
        appeared: r.appeared,
        selection: r.selection,
        goals: r.appeared === true ? numberOrNull(r.goals) : null,
        assists: r.appeared === true ? numberOrNull(r.assists) : null,
      })),
    });
    match.value = m;
    roster.value = m.roster.map((r) => ({ ...r }));
    rosterRevision.value = m.revision;
    if (form.value) form.value.revision = m.revision;
  }, "名单与实际出场已保存");
}
async function load() {
  if (busy.value) return;
  loading.value = true;
  error.value = "";
  success.value = "";
  try {
    const [m, p, t, seasonList] = await Promise.all([
      clubApi<ClubMatch>(`/matches/${route.params.id}`),
      clubApi<ClubPlayer[]>("/players"),
      auth.isAdmin
        ? clubApi<{ tacticId: number; title: string; thumbnail?: string }[]>("/tactics")
        : Promise.resolve([]),
      clubApi<Season[]>("/seasons"),
    ]);
    apply(m);
    seasons.value = seasonList;
    players.value = p;
    tactics.value = t.map((item) => ({ id: item.tacticId, name: item.title, thumbnail: item.thumbnail }));
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);
</script>
