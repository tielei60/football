<template>
  <div class="club-heading">
    <div>
      <h1>球队球员</h1>
      <p class="club-muted">
        {{ players.filter((p) => p.status === "active").length }} 位在队球员 · 名单与战术板共享球员身份
      </p>
    </div>
    <button v-if="auth.isAdmin" class="primary" :disabled="busy" @click="edit()">添加球员</button>
  </div>
  <div v-if="error" class="club-error" role="alert">
    <p>{{ error }}</p>
    <button type="button" :disabled="busy" @click="reload">重新载入球员（放弃未保存修改）</button>
  </div>
  <p v-if="success" role="status" class="club-success">{{ success }}</p>
  <form v-if="form" class="club-card" @submit.prevent="save">
    <fieldset :disabled="busy">
      <h2>{{ form.id ? "编辑球员资料" : "添加球员" }}</h2>
      <div class="club-fields">
        <label>
          姓名
          <input v-model="form.name" required maxlength="100" />
        </label>
        <label>
          球衣号码
          <input v-model="form.number" type="number" min="0" max="999" placeholder="未知" />
        </label>
        <label>
          位置（逗号分隔，可多选）
          <input v-model="positions" placeholder="例如：中后卫, 中场" list="club-position-options" />
        </label>
        <datalist id="club-position-options">
          <option v-for="position in positionOptions" :key="position" :value="position" />
        </datalist>
        <label>
          惯用脚
          <select v-model="form.preferredFoot">
            <option value="">未知</option>
            <option>右脚</option>
            <option>左脚</option>
            <option>双脚</option>
          </select>
        </label>
        <label>
          状态
          <select v-model="form.status">
            <option value="active">在队</option>
            <option value="inactive">已归档</option>
          </select>
        </label>
      </div>
      <label>
        备注
        <textarea v-model="form.note" maxlength="2000" />
      </label>
      <div class="club-actions" style="margin-top: 18px">
        <button class="primary" :disabled="busy">保存球员</button>
        <button type="button" @click="form = null">取消</button>
      </div>
    </fieldset>
  </form>
  <form v-if="account" class="club-card" @submit.prevent="saveAccount">
    <fieldset :disabled="busy">
      <h2>{{ account.hasAccount ? "重置密码" : "创建球员账号" }} · {{ account.name }}</h2>
      <p class="club-muted">请通过可信渠道单独告知球员登录信息。重置密码会退出该球员的所有已登录设备。</p>
      <div class="club-fields">
        <label v-if="!account.hasAccount">
          用户名
          <input v-model="username" autocomplete="off" required />
        </label>
        <label>
          新密码（至少 10 位）
          <input v-model="password" type="password" minlength="10" autocomplete="new-password" required />
        </label>
      </div>
      <div class="club-actions">
        <button class="primary" :disabled="busy">{{ account.hasAccount ? "确认重置密码" : "创建账号" }}</button>
        <button
          type="button"
          @click="
            account = null;
            password = '';
          "
        >
          取消
        </button>
      </div>
    </fieldset>
  </form>
  <div class="club-card">
    <label style="max-width: 300px; margin-bottom: 18px">
      查找球员
      <input v-model="search" placeholder="姓名、号码或位置" />
    </label>
    <p v-if="loading" role="status">正在载入球员…</p>
    <div v-else class="club-table-wrap">
      <table>
        <thead>
          <tr>
            <th>球员</th>
            <th>号码</th>
            <th>位置</th>
            <th>惯用脚</th>
            <th>状态</th>
            <th v-if="auth.isAdmin">管理</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in filtered" :key="p.id">
            <td>
              <strong>{{ p.name }}</strong>
              <div v-if="p.note" class="club-muted" style="font-size: 12px; white-space: normal; max-width: 260px">
                {{ p.note }}
              </div>
            </td>
            <td>{{ unknown(p.number) }}</td>
            <td>{{ p.positions.join(" / ") || "未知" }}</td>
            <td>{{ p.preferredFoot || "未知" }}</td>
            <td>
              <span class="club-tag">{{ p.status === "active" ? "在队" : "已归档" }}</span>
            </td>
            <td v-if="auth.isAdmin">
              <div class="club-actions">
                <button :disabled="busy" @click="edit(p)">编辑</button>
                <button
                  :disabled="busy"
                  @click="
                    form = null;
                    account = p;
                    username = '';
                    password = '';
                    success = '';
                  "
                >
                  {{ p.hasAccount ? "重置密码" : "创建账号" }}
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!filtered.length" class="club-empty">暂无符合条件的球员</p>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { clubApi, ClubApiError, unknown, type ClubPlayer } from "@/services/clubApi";

const auth = useAuthStore();
const players = ref<ClubPlayer[]>([]);
const form = ref<ClubPlayer | null>(null);
const positionOptions = [
  "门将",
  "后卫",
  "中后卫",
  "边后卫",
  "后腰",
  "中场",
  "前腰",
  "边前卫",
  "左边前",
  "右边前",
  "中锋",
  "前锋",
  "待定",
];
const positions = ref("待定");
const account = ref<ClubPlayer | null>(null);
const username = ref("");
const password = ref("");
const search = ref("");
const error = ref("");
const success = ref("");
const busy = ref(false);
const loading = ref(true);
const filtered = computed(() =>
  players.value.filter((p) =>
    `${p.name} ${p.number ?? ""} ${p.positions.join(" ")}`.toLowerCase().includes(search.value.toLowerCase())
  )
);
async function load() {
  try {
    players.value = await clubApi<ClubPlayer[]>("/players");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
function edit(p?: ClubPlayer) {
  if (busy.value) return;
  account.value = null;
  password.value = "";
  form.value = p
    ? JSON.parse(JSON.stringify(p))
    : {
        id: "",
        revision: 0,
        name: "",
        number: null,
        positions: [],
        preferredFoot: "",
        status: "active",
        note: "",
        avatar: null,
        hasAccount: false,
      };
  positions.value = p?.positions.join(", ") || "待定";
  success.value = "";
}
async function save() {
  if (busy.value || !form.value) return;
  busy.value = true;
  error.value = "";
  try {
    const p = form.value;
    await clubApi(`/players${p.id ? `/${encodeURIComponent(p.id)}` : ""}`, p.id ? "PUT" : "POST", {
      revision: p.id ? p.revision : undefined,
      name: p.name,
      number: p.number === null || String(p.number) === "" ? null : Number(p.number),
      positions: (positions.value || "待定")
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      preferredFoot: p.preferredFoot,
      status: p.status,
      note: p.note,
    });
    form.value = null;
    success.value = "球员资料已保存";
    await load();
  } catch (e) {
    error.value =
      e instanceof ClubApiError && e.status === 409
        ? "球员资料已被其他操作更新。你的输入已保留，请先复制需要的内容，再重新载入最新资料。"
        : (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function saveAccount() {
  if (busy.value || !account.value) return;
  busy.value = true;
  error.value = "";
  try {
    const p = account.value;
    await clubApi(
      `/players/${encodeURIComponent(p.id)}/${p.hasAccount ? "password" : "account"}`,
      p.hasAccount ? "PUT" : "POST",
      p.hasAccount ? { newPassword: password.value } : { username: username.value, password: password.value }
    );
    success.value = p.hasAccount ? "密码已重置" : "球员账号已创建";
    account.value = null;
    password.value = "";
    await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function reload() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    players.value = await clubApi<ClubPlayer[]>("/players");
    form.value = null;
    account.value = null;
    password.value = "";
    success.value = "";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
    loading.value = false;
  }
}
onMounted(load);
</script>
