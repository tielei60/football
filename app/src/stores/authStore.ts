import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { clubApi, ClubApiError, advanceAuthEpoch, currentAuthEpoch, type Session } from "@/services/clubApi";

export const useAuthStore = defineStore("clubAuth", () => {
  const session = ref<Session | null>(null);
  const loaded = ref(false);
  const isAdmin = computed(() => session.value?.user.role === "admin");
  const isSystemAdmin = computed(() => session.value?.user.systemAdmin === true);
  let pending: Promise<void> | undefined;
  async function initialize() {
    if (loaded.value) return;
    if (!pending)
      pending = (async () => {
        try {
          const epoch = currentAuthEpoch();
          const result = await clubApi<Session>("/auth/me");
          if (epoch === currentAuthEpoch()) session.value = result;
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
    const epoch = advanceAuthEpoch();
    const result = await clubApi<Session>("/auth/login", "POST", { username, password });
    if (epoch !== currentAuthEpoch()) return;
    session.value = result;
    loaded.value = true;
  }
  function clearSession() {
    advanceAuthEpoch();
    session.value = null;
    loaded.value = true;
  }
  async function logout() {
    const epoch = currentAuthEpoch();
    try {
      await clubApi("/auth/logout", "POST", {});
    } finally {
      if (epoch === currentAuthEpoch()) {
        clearSession();
        window.location.assign("/login");
      }
    }
  }
  return { session, loaded, isAdmin, isSystemAdmin, initialize, login, logout, clearSession };
});
