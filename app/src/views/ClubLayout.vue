<template>
  <div class="club-app club-shell">
    <a class="club-skip-link" href="#club-main">跳到主要内容</a>
    <aside class="club-nav" aria-label="俱乐部导航">
      <div class="club-wordmark">
        TOUCH
        <span>LINE</span>
        <small>边线 · 俱乐部工作室</small>
      </div>
      <div class="club-brand">
        <img :src="auth.session?.team.crest || defaultBadge" alt="球队队徽" />
        <div>
          <strong>{{ auth.session?.team.name || "球队俱乐部" }}</strong>
          <small>FOOTBALL CLUB</small>
        </div>
      </div>
      <nav aria-label="主要导航">
        <RouterLink
          to="/club"
          active-class=""
          exact-active-class="router-link-active"
          :class="{ 'router-link-active': route.path.startsWith('/club/matches/') }"
        >
          <CalendarDays :size="18" aria-hidden="true" />
          <span>比赛</span>
        </RouterLink>
        <RouterLink to="/club/players">
          <UsersRound :size="18" aria-hidden="true" />
          <span>球员</span>
        </RouterLink>
        <RouterLink to="/club/venues">
          <MapPin :size="18" aria-hidden="true" />
          <span>球场</span>
        </RouterLink>
        <RouterLink to="/club/statistics">
          <ChartNoAxesCombined :size="18" aria-hidden="true" />
          <span>统计与赛季</span>
        </RouterLink>
        <RouterLink v-if="auth.isAdmin" to="/board">
          <Goal :size="18" aria-hidden="true" />
          <span>战术板 ↗</span>
        </RouterLink>
        <RouterLink to="/club/account">
          <UserRound :size="18" aria-hidden="true" />
          <span>账号</span>
        </RouterLink>
      </nav>
      <div class="club-nav-footer">
        <p>一群人，一整季。</p>
        <div class="club-user">
          <span class="club-user-mark" aria-hidden="true">
            {{ auth.session?.user.username.slice(0, 1).toUpperCase() }}
          </span>
          <div>
            <strong>{{ auth.session?.user.username }}</strong>
            <small>{{ auth.isAdmin ? "俱乐部管理员" : "球队球员" }}</small>
          </div>
        </div>
      </div>
    </aside>
    <div class="club-shell-body">
      <header class="club-topbar">
        <span>把注意力留给足球</span>
        <span class="club-role-label">{{ auth.isAdmin ? "管理端" : "球员端" }}</span>
      </header>
      <main id="club-main" class="club-content" tabindex="-1"><RouterView :key="$route.path" /></main>
      <footer class="club-page-footer">TOUCHLINE / 每一场比赛，都值得记录。</footer>
    </div>
  </div>
</template>
<script setup lang="ts">
import { CalendarDays, UsersRound, ChartNoAxesCombined, Goal, UserRound, MapPin } from "lucide-vue-next";
import { useRoute } from "vue-router";
import defaultBadge from "@/assets/default-club-badge.svg";
import { useAuthStore } from "@/stores/authStore";
const auth = useAuthStore();
const route = useRoute();
</script>
