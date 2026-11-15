<template>
  <main class="club-app club-login-wrap">
    <form class="club-card club-login" @submit.prevent="save">
      <span class="club-eyebrow">账号安全</span>
      <h1>设置新密码</h1>
      <p class="club-muted">首次使用请更换临时密码。完成后需重新登录。</p>
      <p v-if="error" class="club-error" role="alert">{{ error }}</p>
      <label>
        当前密码
        <input v-model="currentPassword" type="password" autocomplete="current-password" :disabled="busy" required />
      </label>
      <label>
        新密码
        <input
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          minlength="10"
          maxlength="200"
          :disabled="busy"
          required
        />
      </label>
      <label>
        确认新密码
        <input
          v-model="confirmation"
          type="password"
          autocomplete="new-password"
          minlength="10"
          maxlength="200"
          :disabled="busy"
          required
        />
      </label>
      <p class="club-muted">使用 10–200 位独立密码。</p>
      <button class="primary" :disabled="busy">{{ busy ? "正在更新…" : "更新并重新登录" }}</button>
      <button type="button" :disabled="busy" @click="leave">退出登录</button>
    </form>
  </main>
</template>
<script setup lang="ts">
import { ref, onBeforeUnmount } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { clubApi, currentAuthEpoch } from "@/services/clubApi";
const auth = useAuthStore();
const currentPassword = ref("");
const newPassword = ref("");
const confirmation = ref("");
const busy = ref(false);
const error = ref("");
function clear() {
  currentPassword.value = "";
  newPassword.value = "";
  confirmation.value = "";
}
let active = true;
onBeforeUnmount(() => {
  active = false;
  clear();
});
async function save() {
  if (busy.value) return;
  error.value = "";
  if (newPassword.value !== confirmation.value) {
    error.value = "两次新密码不一致";
    return;
  }
  busy.value = true;
  const epoch = currentAuthEpoch();
  try {
    await clubApi("/auth/password", "PUT", { currentPassword: currentPassword.value, newPassword: newPassword.value });
    if (epoch === currentAuthEpoch()) {
      auth.clearSession();
      if (active) window.location.assign("/login");
    }
  } catch (e) {
    if (active && epoch === currentAuthEpoch()) error.value = (e as Error).message;
  } finally {
    clear();
    busy.value = false;
  }
}
async function leave() {
  if (busy.value) return;
  busy.value = true;
  try {
    await auth.logout();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
