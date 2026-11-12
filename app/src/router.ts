import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "./stores/authStore";
import { useCoachingDeskStore } from "./stores/coachingDeskStore";
import LandingPage from "./views/LandingPage.vue";
import BoardView from "./views/BoardView.vue";
import ChangelogPage from "./views/ChangelogPage.vue";
import LoginView from "./views/LoginView.vue";
import ClubLayout from "./views/ClubLayout.vue";
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/club" },
    { path: "/login", name: "login", component: LoginView },
    { path: "/about", name: "about", component: LandingPage },
    { path: "/board", name: "board", component: BoardView, meta: { admin: true } },
    { path: "/changelog", name: "changelog", component: ChangelogPage },
    {
      path: "/club",
      component: ClubLayout,
      children: [
        { path: "", component: () => import("./views/ClubMatchesView.vue") },
        { path: "players", component: () => import("./views/ClubPlayersView.vue") },
        { path: "statistics", component: () => import("./views/ClubStatisticsView.vue") },
        { path: "account", component: () => import("./views/AccountView.vue") },
        { path: "matches/:id", component: () => import("./views/ClubMatchView.vue") },
      ],
    },
    { path: "/:pathMatch(.*)*", redirect: "/club" },
  ],
});
router.beforeEach(async (to, from) => {
  if (from.name === "board" && to.name !== "board") {
    const desk = useCoachingDeskStore();
    // Finish any in-flight load before leaving, so it cannot restart autosave off-board.
    await desk.settleInitialization();
    if (desk.ready) {
      try {
        await desk.flush();
      } catch {
        return false;
      }
    }
    desk.suspend();
  }
  const auth = useAuthStore();
  try {
    await auth.initialize();
  } catch {
    if (to.name !== "login") return "/login";
  }
  if (!auth.session && !["login", "about", "changelog"].includes(String(to.name))) return "/login";
  if (auth.session && to.name === "login") return "/club";
  if (to.meta.admin && !auth.isAdmin) return "/club";
});
export default router;
