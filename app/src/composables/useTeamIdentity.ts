import { computed } from "vue";
import { useAuthStore } from "@/stores/authStore";
import defaultBadge from "@/assets/default-club-badge.svg";

export function useTeamIdentity() {
  const auth = useAuthStore();
  const teamName = computed(() => auth.session?.team.name || "足球俱乐部");
  const teamBadge = computed(() => auth.session?.team.crest || defaultBadge);
  // eslint-disable-next-line no-control-regex -- Remove unsafe filename characters, including controls.
  const teamFileName = computed(() => teamName.value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 100));
  return { teamName, teamBadge, teamFileName };
}
