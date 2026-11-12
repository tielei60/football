<template>
  <div class="club-app">
    <header class="club-nav">
      <div class="club-brand">
        <img :src="auth.session?.team.crest || defaultBadge" alt="球队队徽" />
        {{ auth.session?.team.name || "球队俱乐部" }}
      </div>
      <RouterLink to="/club" active-class="" exact-active-class="router-link-active">比赛</RouterLink>
      <RouterLink to="/club/players">球员</RouterLink>
      <RouterLink to="/club/statistics">统计与赛季</RouterLink>
      <RouterLink v-if="auth.isAdmin" to="/board">战术板 ↗</RouterLink>
      <RouterLink to="/club/account">账号</RouterLink>
    </header>
    <main class="club-content"><RouterView :key="$route.fullPath" /></main>
  </div>
</template>
<script setup lang="ts">
import defaultBadge from "@/assets/default-club-badge.svg";
import { useAuthStore } from "@/stores/authStore";

const auth = useAuthStore();
</script>
