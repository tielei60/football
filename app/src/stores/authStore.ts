import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { clubApi, ClubApiError, type Session } from "@/services/clubApi";

export const useAuthStore = defineStore("clubAuth", () => {
  const session = ref<Session | null>(null);
  const loaded = ref(false);
  const isAdmin = computed(() => session.value?.user.role === "admin");
  let pending: Promise<void> | undefined;
  async function initialize() {
    if (loaded.value) return;
    if (!pending)
      pending = (async () => {
        try {
          session.value = await clubApi<Session>("/auth/me");
        } catch (error) {
          if (!(error instanceof ClubApiError && error.status === 401)) throw error;
        }
        loaded.value = true;
      })().finally(() => {
        pending = undefined;
      });
    await pending;
  }
  async function login(username: string, password: string) {
    session.value = await clubApi<Session>("/auth/login", "POST", { username, password });
    loaded.value = true;
  }
  async function logout() {
    try {
      await clubApi("/auth/logout", "POST", {});
    } finally {
      session.value = null;
      loaded.value = false;
      window.location.assign("/login");
    }
  }
  return { session, loaded, isAdmin, initialize, login, logout };
});
