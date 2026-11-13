<template>
  <div class="club-heading">
    <div>
      <span class="club-eyebrow">PROFILE / 个人与球队</span>
      <h1>我的账号</h1>
      <p class="club-muted">{{ auth.session?.user.username }} · {{ auth.isAdmin ? "管理员" : "球员" }}</p>
    </div>
    <button :disabled="busy" @click="logout">退出登录</button>
  </div>
  <ClubTeamCard />
  <form class="club-card" style="max-width: 580px" @submit.prevent="changePassword">
    <h2>修改密码</h2>
    <p class="club-muted club-credential-hint">修改后，所有设备需要重新登录。请使用独立密码，并通过可信渠道保管。</p>
    <p v-if="error" class="club-error" role="alert">{{ error }}</p>
    <div class="club-fields">
      <label>
        当前密码
        <input v-model="currentPassword" type="password" autocomplete="current-password" :disabled="busy" required />
      </label>
      <label>
        新密码（至少 10 位）
        <input
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          :disabled="busy"
          minlength="10"
          required
        />
      </label>
    </div>
    <button class="primary" :disabled="busy">修改并重新登录</button>
  </form>
</template>
<script setup lang="ts">
import { ref } from "vue";
import ClubTeamCard from "@/components/ClubTeamCard.vue";
import { useAuthStore } from "@/stores/authStore";
import { clubApi } from "@/services/clubApi";

const auth = useAuthStore();
const currentPassword = ref("");
const newPassword = ref("");
const busy = ref(false);
const error = ref("");
async function changePassword() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await clubApi("/auth/password", "PUT", { currentPassword: currentPassword.value, newPassword: newPassword.value });
    window.location.assign("/login");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function logout() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await auth.logout();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
