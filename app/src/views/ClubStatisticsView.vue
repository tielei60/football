<template>
  <div class="club-heading">
    <div>
      <h1>统计与赛季</h1>
      <p class="club-muted">赛季按比赛归属统计，年度独立按日期统计；未指定赛季的比赛不计入赛季。</p>
    </div>
    <button v-if="auth.isAdmin" :disabled="busy" @click="editSeason()">新建赛季</button>
  </div>
  <div v-if="error" class="club-error" role="alert">
    <p>{{ error }}</p>
    <button type="button" :disabled="busy" @click="reload">重新载入赛季（放弃未保存修改）</button>
  </div>
  <form v-if="seasonForm" class="club-card" @submit.prevent="saveSeason">
    <fieldset :disabled="busy">
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
    </fieldset>
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
        <select v-model="seasonId" aria-label="赛季" @change="loadStats">
          <option value="" disabled>请选择赛季</option>
          <option v-for="s in seasons" :key="s.id" :value="s.id">
            {{ s.name }}（{{ s.startDate }} 至 {{ s.endDate }}）
          </option>
        </select>
      </label>
    </div>
    <p v-if="loading" role="status">正在计算统计…</p>
    <template v-else-if="stats">
      <p v-if="stats.unassignedMatches" class="club-muted">
        球队有 {{ stats.unassignedMatches }} 场未归属赛季的已发布或已完赛比赛，年度仍按日期统计。
      </p>
      <p class="club-muted">
        报名统计包含本周期 {{ stats.registrationMatches }} 场已发布或已完赛比赛，未回复与“不参加”分别统计。
      </p>
      <h2>{{ stats.filter.label }} · {{ stats.matches }} 场已完赛</h2>
      <p class="club-muted">{{ stats.filter.startDate }} 至 {{ stats.filter.endDate }}（含首尾日期）</p>
      <p v-if="stats.matchesWithoutRoster > 0" class="club-error" role="status">
        有 {{ stats.matchesWithoutRoster }} 场已完赛比赛尚未录入名单，当前统计可能不完整。
      </p>
      <section aria-label="球队汇总" class="club-card" style="margin-top: 18px">
        <h3>球队汇总</h3>
        <p>
          已确认出场 {{ stats.team.attendance.confirmedAppearances }} 人次 · 出场待确认
          {{ stats.team.attendance.unknownAppearances }} 人次
        </p>
        <p class="club-muted">
          出勤覆盖：{{ stats.team.attendance.matchesWithoutRoster }} 场已完赛比赛尚未录入名单，未记录不等于未出场。
        </p>
        <p>{{ stats.team.wins }} 胜 · {{ stats.team.draws }} 平 · {{ stats.team.losses }} 负</p>
        <p class="club-muted">
          胜平负覆盖：{{ stats.team.scoredMatches }} / {{ stats.team.matches }} 场（双方比分均已知）
        </p>
        <p>已知进球 {{ unknown(stats.team.goalsFor) }} · 已知失球 {{ unknown(stats.team.goalsAgainst) }}</p>
        <p class="club-muted">
          进球记录覆盖：{{ stats.team.goalsForKnownMatches }} / {{ stats.team.matches }} 场；失球记录覆盖：{{
            stats.team.goalsAgainstKnownMatches
          }}
          / {{ stats.team.matches }} 场
        </p>
        <p v-if="stats.team.scoredMatches < stats.team.matches" class="club-muted">
          有比赛比分未完整记录，胜平负和进失球为已知数据的汇总，不代表全部赛果。
        </p>
      </section>
      <section aria-label="对手交锋" style="margin: 24px 0">
        <h3>对手交锋</h3>
        <p class="club-muted">同一统计周期内的已完赛比赛，按对手名称归组。胜平负只包含双方比分均已知的比赛。</p>
        <ClubTableWrap v-if="stats.opponents.length" label="对手交锋表">
          <table>
            <thead>
              <tr>
                <th>对手</th>
                <th>场次</th>
                <th>胜 / 平 / 负</th>
                <th>赛果覆盖</th>
                <th>已知进球</th>
                <th>进球覆盖</th>
                <th>已知失球</th>
                <th>失球覆盖</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="opponent in stats.opponents" :key="opponent.opponent">
                <td>{{ opponent.opponent }}</td>
                <td>{{ opponent.matches }}</td>
                <td>{{ opponent.wins }} / {{ opponent.draws }} / {{ opponent.losses }}</td>
                <td>{{ opponent.scoredMatches }} / {{ opponent.matches }} 场</td>
                <td>{{ unknown(opponent.goalsFor) }}</td>
                <td>{{ opponent.goalsForKnownMatches }} / {{ opponent.matches }} 场</td>
                <td>{{ unknown(opponent.goalsAgainst) }}</td>
                <td>{{ opponent.goalsAgainstKnownMatches }} / {{ opponent.matches }} 场</td>
              </tr>
            </tbody>
          </table>
        </ClubTableWrap>
        <p v-else class="club-muted">当前周期暂无已完赛的对手交锋记录。</p>
      </section>
      <ClubTableWrap label="球员统计表">
        <table>
          <thead>
            <tr>
              <th>球员</th>
              <th>确认出场</th>
              <th>出场待确认</th>
              <th>未录入个人明细</th>
              <th>已知进球</th>
              <th>进球记录覆盖</th>
              <th>已知助攻</th>
              <th>助攻记录覆盖</th>
              <th>报名参加</th>
              <th>报名不参加</th>
              <th>报名待定</th>
              <th>未回复</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in stats.players" :key="p.playerId">
              <td>{{ p.name }}</td>
              <td>{{ p.appearances }}</td>
              <td>{{ p.unknownAppearances }}</td>
              <td>{{ p.unrecordedMatches }}</td>
              <td>{{ unknown(p.goals) }}</td>
              <td>{{ p.goalsKnownMatches }} / {{ p.appearances }} 场</td>
              <td>{{ unknown(p.assists) }}</td>
              <td>{{ p.assistsKnownMatches }} / {{ p.appearances }} 场</td>
              <td>{{ p.registration.yes }}</td>
              <td>{{ p.registration.no }}</td>
              <td>{{ p.registration.maybe }}</td>
              <td>{{ p.registration.unanswered }}</td>
            </tr>
          </tbody>
        </table>
      </ClubTableWrap>
      <p class="club-muted" style="font-size: 13px; margin-top: 18px">
        报名不等于出场；未录入个人明细不等于确认未出场。确认出场仅计算明确记录的出场次数，出场待确认指已有名单但出场状态未知。空白数据不按
        0 计算。进球和助攻是已记录数据的合计，请结合覆盖场数阅读。
      </p>
    </template>
    <p v-else class="club-empty">{{ mode === "season" ? "请先选择或创建赛季" : "暂无统计数据" }}</p>
  </section>
  <form v-if="seasonRoster" class="club-card" aria-label="赛季名单详情" @submit.prevent="saveSeasonRoster">
    <fieldset :disabled="busy">
      <h2>赛季名单 · {{ seasonRoster.season.name }}</h2>
      <p v-if="rosterSuccess" role="status" class="club-success">{{ rosterSuccess }}</p>
      <p class="club-muted">
        每个赛季单独设置名单和号码。首次加入该赛季的比赛名单会使用这里的号码，已保存的比赛快照不随之后的修改改变。
      </p>
      <div v-if="auth.isAdmin" class="club-actions">
        <label>
          添加赛季球员
          <select v-model="seasonPlayerId">
            <option value="">选择球员</option>
            <option
              v-for="p in seasonPlayers.filter((p) => !seasonRoster?.roster.some((r) => r.playerId === p.id))"
              :key="p.id"
              :value="p.id"
            >
              {{ p.name }}
            </option>
          </select>
        </label>
        <button type="button" :disabled="!seasonPlayerId" @click="addSeasonPlayer">加入赛季名单</button>
      </div>
      <ClubTableWrap label="赛季名单表">
        <table>
          <thead>
            <tr>
              <th>球员</th>
              <th>赛季号码</th>
              <th v-if="auth.isAdmin">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(player, index) in seasonRoster.roster" :key="player.playerId">
              <td>{{ player.name }}</td>
              <td>
                <input
                  v-if="auth.isAdmin"
                  v-model="player.number"
                  type="number"
                  min="0"
                  max="999"
                  :aria-label="`${player.name}赛季号码`"
                  placeholder="未知"
                />
                <span v-else>{{ unknown(player.number) }}</span>
              </td>
              <td v-if="auth.isAdmin">
                <button type="button" @click="seasonRoster.roster.splice(index, 1)">移出赛季</button>
              </td>
            </tr>
          </tbody>
        </table>
      </ClubTableWrap>
      <div class="club-actions" style="margin-top: 16px">
        <button v-if="auth.isAdmin" class="primary">保存赛季名单</button>
        <button type="button" @click="seasonRoster = null">取消</button>
      </div>
    </fieldset>
  </form>
  <section class="club-card">
    <h2>赛季管理</h2>
    <p v-if="!seasons.length" class="club-muted">暂无赛季。赛季可跨自然年，日期范围可重叠。</p>
    <div v-for="s in seasons" :key="s.id" class="club-heading" style="margin-bottom: 12px">
      <div>
        <strong>{{ s.name }}</strong>
        <div class="club-muted">{{ s.startDate }} 至 {{ s.endDate }}</div>
      </div>
      <div class="club-actions">
        <button v-if="auth.isAdmin" :disabled="busy" @click="editSeason(s)">编辑</button>
        <button :disabled="busy" @click="editRoster(s)">赛季名单</button>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { onMounted, ref } from "vue";
import ClubTableWrap from "@/components/ClubTableWrap.vue";
import { useAuthStore } from "@/stores/authStore";
import {
  clubApi,
  ClubApiError,
  unknown,
  type SeasonRoster,
  type ClubPlayer,
  type Season,
  type Statistics,
} from "@/services/clubApi";

const auth = useAuthStore();
const seasons = ref<Season[]>([]);
const seasonForm = ref<Season | null>(null);
const seasonRoster = ref<SeasonRoster | null>(null);
const seasonPlayers = ref<ClubPlayer[]>([]);
const seasonPlayerId = ref("");
const rosterSuccess = ref("");
const stats = ref<Statistics | null>(null);
const mode = ref("year");
const year = ref(new Date().getFullYear());
const seasonId = ref<number | "">("");
const error = ref("");
const loading = ref(false);
const busy = ref(false);
let request = 0;
function editSeason(s?: Season) {
  if (busy.value) return;
  seasonRoster.value = null;
  seasonForm.value = s ? { ...s } : { id: 0, revision: 0, name: "", startDate: "", endDate: "" };
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
  if (busy.value || !seasonForm.value) return;
  busy.value = true;
  error.value = "";
  try {
    const s = seasonForm.value;
    const saved = await clubApi<Season>(`/seasons${s.id ? `/${s.id}` : ""}`, s.id ? "PUT" : "POST", {
      revision: s.id ? s.revision : undefined,
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
    });
    // Reuse the write response; a failed follow-up read must not recreate a season.
    seasons.value = [...seasons.value.filter((entry) => entry.id !== saved.id), saved];
    seasonForm.value = null;
    seasonRoster.value = null;
    await loadStats();
  } catch (e) {
    error.value =
      e instanceof ClubApiError && e.status === 409
        ? "赛季已被其他操作更新。你的输入已保留，请先复制需要的内容，再重新载入最新赛季。"
        : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function reload() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    seasons.value = await clubApi<Season[]>("/seasons");
    seasonForm.value = null;
    seasonRoster.value = null;
    await loadStats();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function editRoster(season: Season) {
  rosterSuccess.value = "";
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const [saved, players] = await Promise.all([
      clubApi<SeasonRoster>(`/seasons/${season.id}/roster`),
      clubApi<ClubPlayer[]>("/players"),
    ]);
    seasonRoster.value = saved;
    seasonPlayers.value = players;
    seasonPlayerId.value = "";
    seasonForm.value = null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function addSeasonPlayer() {
  if (busy.value || !auth.isAdmin || !seasonRoster.value) return;
  const p = seasonPlayers.value.find((player) => player.id === seasonPlayerId.value);
  if (p && !seasonRoster.value.roster.some((r) => r.playerId === p.id))
    seasonRoster.value.roster.push({ playerId: p.id, name: p.name, number: p.number, positions: p.positions });
  seasonPlayerId.value = "";
}
async function saveSeasonRoster() {
  rosterSuccess.value = "";
  if (busy.value || !auth.isAdmin || !seasonRoster.value) return;
  busy.value = true;
  error.value = "";
  try {
    const draft = seasonRoster.value;
    const saved = await clubApi<SeasonRoster>(`/seasons/${draft.season.id}/roster`, "PUT", {
      revision: draft.season.revision,
      roster: draft.roster.map((p) => ({
        playerId: p.playerId,
        number: p.number === null || String(p.number) === "" ? null : Number(p.number),
      })),
    });
    seasons.value = seasons.value.map((s) => (s.id === saved.season.id ? saved.season : s));
    seasonRoster.value = saved;
    rosterSuccess.value = "赛季名单已保存";
  } catch (e) {
    error.value =
      e instanceof ClubApiError && e.status === 409
        ? "赛季名单已被其他操作更新。你的输入已保留，请先复制需要的内容，再重新载入赛季。"
        : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
onMounted(reload);
</script>
