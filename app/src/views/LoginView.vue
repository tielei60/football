<template>
  <main class="club-app club-login-wrap">
    <aside class="club-login-intro">
      <div class="club-wordmark">
        TOUCH
        <span>LINE</span>
        <small>边线 · 俱乐部工作室</small>
      </div>
      <h2>
        场上的默契，
        <br />
        从这里开始。
      </h2>
      <p>一起准备比赛，记录每次上场，让球队的每一步都有迹可循。</p>
      <div class="club-login-detail">球队 · 比赛 · 战术 · 赛季</div>
    </aside>
    <form class="club-card club-login" @submit.prevent="login">
      <img :src="defaultBadge" alt="球队徽章" />
      <span class="club-eyebrow">WELCOME BACK / 欢迎回来</span>
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
      <p class="club-muted club-login-note">管理端与球员端使用同一入口。球员账号由球队管理员创建。</p>
    </form>
  </main>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import defaultBadge from "@/assets/default-club-badge.svg";
import { useAuthStore } from "@/stores/authStore";

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
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
    const redirect = route.query.redirect;
    await router.replace(typeof redirect === "string" && redirect.startsWith("/club/") ? redirect : "/club");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    password.value = "";
    busy.value = false;
  }
}
</script>
