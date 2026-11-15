<template>
  <div class="club-heading">
    <div>
      <span class="club-eyebrow">账号与权限</span>
      <h1>管理员设置</h1>
      <p class="club-muted">管理本球队账号，系统管理员不在此处调整。</p>
    </div>
    <button :disabled="busy || loading" @click="load">刷新账号</button>
  </div>
  <p v-if="error" class="club-error" role="alert">{{ error }}</p>
  <p v-if="notice" class="club-muted" role="status">{{ notice }}</p>
  <form class="club-card accounts-create" @submit.prevent="create">
    <h2>创建管理员</h2>
    <div class="club-fields">
      <label>
        用户名
        <input v-model="username" autocomplete="off" maxlength="100" required :disabled="busy || uncertain" />
      </label>
      <label>
        临时密码
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          minlength="10"
          maxlength="200"
          required
          :disabled="busy || uncertain"
        />
      </label>
    </div>
    <p class="club-muted">首次登录必须修改密码。请通过可信渠道交付临时密码。</p>
    <button class="primary" :disabled="busy || uncertain || loading">{{ busy ? "正在处理…" : "创建管理员" }}</button>
    <button v-if="uncertain" type="button" :disabled="loading || busy" @click="load">核对创建结果</button>
  </form>
  <section class="club-card" :aria-busy="loading">
    <h2>球队账号</h2>
    <p v-if="loading" role="status">正在加载账号…</p>
    <p v-else-if="!accounts.length" class="club-muted">暂无账号</p>
    <ul class="accounts-list">
      <li v-for="account in accounts" :key="account.id">
        <div>
          <strong>{{ account.username }}</strong>
          <p class="club-muted">
            {{ account.systemAdmin ? "系统管理员" : account.role === "admin" ? "管理员" : "球员" }} ·
            {{ account.enabled ? "已启用" : "已停用" }}
            <span v-if="account.mustChangePassword">· 待修改密码</span>
          </p>
        </div>
        <div v-if="!account.systemAdmin" class="accounts-actions">
          <button
            v-if="account.role === 'player'"
            :disabled="busy || loading"
            @click="update(account, { role: 'admin' }, '设为管理员')"
          >
            设为管理员
          </button>
          <button
            v-if="account.role === 'admin' && account.playerId"
            :disabled="busy || loading"
            @click="update(account, { role: 'player' }, '撤销管理员')"
          >
            撤销管理员
          </button>
          <button
            :disabled="busy || loading"
            @click="update(account, { enabled: !account.enabled }, account.enabled ? '停用账号' : '启用账号')"
          >
            {{ account.enabled ? "停用" : "启用" }}
          </button>
        </div>
        <span v-else class="club-muted">受保护</span>
      </li>
    </ul>
  </section>
</template>
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { clubApi, ClubApiError, currentAuthEpoch, type SystemAccount } from "@/services/clubApi";
import { confirmAction } from "@/components/ui/confirmAction";
const accounts = ref<SystemAccount[]>([]);
const username = ref("");
const password = ref("");
const loading = ref(false);
const busy = ref(false);
const uncertain = ref(false);
const error = ref("");
const notice = ref("");
let alive = true;
onBeforeUnmount(() => {
  alive = false;
  password.value = "";
});
async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = "";
  const epoch = currentAuthEpoch();
  try {
    const result = await clubApi<SystemAccount[]>("/system/accounts");
    if (!alive || epoch !== currentAuthEpoch()) return;
    accounts.value = result;
    if (uncertain.value) {
      const exists = result.some((a) => a.username.toLowerCase() === username.value.trim().toLowerCase());
      notice.value = exists
        ? "该用户名已存在。无法确认上次创建使用的密码，请勿重复创建。"
        : "暂未找到该用户名。请求可能仍在处理，请稍后再次核对；本页不会自动重试。";
    }
  } catch (e) {
    if (alive) error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
async function create() {
  if (busy.value || uncertain.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  const epoch = currentAuthEpoch();
  try {
    await clubApi("/system/accounts", "POST", { username: username.value.trim(), password: password.value });
    if (!alive || epoch !== currentAuthEpoch()) return;
    username.value = "";
    notice.value = "管理员已创建，首次登录需修改密码。";
    await load();
  } catch (e) {
    if (!alive || epoch !== currentAuthEpoch()) return;
    error.value = (e as Error).message;
    if (!(e instanceof ClubApiError) || e.status >= 500) {
      uncertain.value = true;
      notice.value = "创建结果尚未确认，请刷新核对。不要重复提交。";
    }
  } finally {
    password.value = "";
    busy.value = false;
  }
}
async function update(account: SystemAccount, patch: { role?: "admin" | "player"; enabled?: boolean }, label: string) {
  if (busy.value || loading.value) return;
  busy.value = true;
  const epoch = currentAuthEpoch();
  try {
    const confirmed = await confirmAction(`${label}「${account.username}」？修改后该账号需要重新登录。`, {
      title: label,
      confirmText: "确认修改",
      danger: patch.enabled === false || patch.role === "player",
    });
    if (!confirmed || !alive || epoch !== currentAuthEpoch()) return;
    error.value = "";
    notice.value = "";
    await clubApi(`/system/accounts/${account.id}`, "PUT", { revision: account.revision, ...patch });
    if (alive && epoch === currentAuthEpoch()) {
      notice.value = "账号权限已更新";
      await load();
    }
  } catch (e) {
    if (alive && epoch === currentAuthEpoch()) {
      error.value = `${(e as Error).message}。请刷新核对后再操作。`;
      accounts.value = [];
    }
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<style scoped>
.accounts-create {
  margin-bottom: 24px;
}
.accounts-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.accounts-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 0;
  border-bottom: 1px solid var(--club-border, #e9e5ef);
}
.accounts-list strong {
  overflow-wrap: anywhere;
}
.accounts-list p {
  margin: 6px 0 0;
  font-size: 13px;
}
.accounts-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 600px) {
  .accounts-list li {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
