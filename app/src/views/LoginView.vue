<template>
  <main class="club-app club-login-wrap">
    <form class="club-card club-login" @submit.prevent="login">
      <img :src="defaultBadge" alt="球队徽章" />
      <h1>回到球队</h1>
      <p class="club-muted">比赛、队友与每一次进步。</p>
      <p v-if="error" class="club-error" role="alert">{{ error }}</p>
      <label>
        用户名
        <input v-model="username" autocomplete="username" :disabled="busy" required autofocus />
      </label>
      <label>
        密码
        <input v-model="password" type="password" autocomplete="current-password" :disabled="busy" required />
      </label>
      <button class="primary" :disabled="busy">{{ busy ? "正在登录…" : "登录" }}</button>
      <p class="club-muted" style="margin-top: 18px; font-size: 13px">
        管理端与球员端使用同一入口。球员账号由球队管理员创建。
      </p>
    </form>
  </main>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import defaultBadge from "@/assets/default-club-badge.svg";
import { useAuthStore } from "@/stores/authStore";

const auth = useAuthStore();
const router = useRouter();
const username = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);
async function login() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await auth.login(username.value, password.value);
    await router.replace("/club");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
