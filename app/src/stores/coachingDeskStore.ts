import { computed, nextTick, ref, watch } from "vue";
import { defineStore } from "pinia";
import { useTacticsStore } from "./tacticsStore";
import { useRosterStore, type RosterEntry } from "./rosterStore";
import { useHistoryStore } from "./historyStore";
import { useFormation } from "@/composables/useFormation";
import { migrateBoardIfNeeded } from "@/utils/migrateBoard";
import { apiRequest, TacticsApiError } from "@/services/tacticsApi";
import { toBoard, fromBoard, type Board } from "@/services/tacticLanguage";
import { normalizePlayerPositions, type PlayerPosition } from "@/data/berlinGarden";

interface TeamPlayer {
  playerId: string;
  name: string;
  number: number;
  positions?: PlayerPosition[];
  position?: string;
  preferredFoot: string;
  status: RosterEntry["status"];
  note: string;
  avatar?: string | null;
  fieldPieceId: string | number | null;
}
interface CoachingDesk {
  board: Board;
  players: TeamPlayer[];
  selectedTacticId: number | null;
}
interface SavedDesk {
  desk: CoachingDesk | null;
  edition: number;
  savedAt: number | null;
}

export const useCoachingDeskStore = defineStore("coachingDesk", () => {
  const tactics = useTacticsStore();
  const roster = useRosterStore();
  const ready = ref(false);
  const status = ref<"loading" | "saved" | "pending" | "saving" | "error" | "conflict">("loading");
  const message = ref("");
  const savedAt = ref<number | null>(null);
  const edition = ref(0);
  const savedContent = ref("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let initializing: Promise<void> | undefined;
  let applying = false;
  let watching = false;

  const capture = (): CoachingDesk => ({
    board: toBoard(tactics.snapshotBoard()),
    players: roster.players.map((p) => ({
      playerId: p.id,
      name: p.name,
      number: p.number,
      positions: [...p.positions],
      preferredFoot: p.foot,
      status: p.status ?? "ok",
      note: p.note,
      avatar: p.avatar,
      fieldPieceId: p.fieldId,
    })),
    selectedTacticId: tactics.currentId,
  });
  const content = () => JSON.stringify(capture());
  const hasUnsavedChanges = computed(() => ready.value && content() !== savedContent.value);

  async function apply(saved: SavedDesk) {
    applying = true;
    try {
      edition.value = saved.edition;
      savedAt.value = saved.savedAt;
      if (saved.desk) {
        roster.players = saved.desk.players.map((p) => ({
          id: p.playerId,
          name: p.name,
          number: p.number,
          positions: normalizePlayerPositions(p.positions ?? p.position),
          foot: p.preferredFoot,
          status: p.status,
          note: p.note,
          avatar: p.avatar ?? undefined,
          fieldId: p.fieldPieceId,
        }));
        tactics.restoreSnapshot(fromBoard(saved.desk.board));
        tactics.currentId = tactics.tactics.some((t) => t.id === saved.desk!.selectedTacticId)
          ? saved.desk.selectedTacticId
          : null;
      }
      await nextTick();
      useHistoryStore().clearHistory();
      savedContent.value = content();
    } finally {
      applying = false;
    }
  }

  async function saveChanges() {
    if (status.value === "conflict") throw new Error(message.value);
    while (true) {
      const nextDesk = capture();
      const nextContent = JSON.stringify(nextDesk);
      if (nextContent === savedContent.value) {
        status.value = "saved";
        return;
      }
      status.value = "saving";
      message.value = "";
      try {
        const saved = await apiRequest<SavedDesk>("/api/coaching-desk", {
          method: "PUT",
          body: { desk: nextDesk, edition: edition.value },
        });
        edition.value = saved.edition;
        savedAt.value = saved.savedAt;
        savedContent.value = nextContent;
      } catch (error) {
        if (error instanceof TacticsApiError && error.status === 404 && nextDesk.selectedTacticId !== null) {
          try {
            await tactics.refresh();
            if (!tactics.tactics.some((tactic) => tactic.id === nextDesk.selectedTacticId)) {
              if (tactics.currentId === nextDesk.selectedTacticId) tactics.currentId = null;
              continue;
            }
          } catch {
            /* 战术列表不可读时保留草稿，交由显式重试。 */
          }
        }
        status.value = error instanceof TacticsApiError && error.status === 409 ? "conflict" : "error";
        message.value = error instanceof Error ? error.message : "工作台保存失败";
        throw error;
      }
    }
  }

  async function flush() {
    clearTimeout(timer);
    if (!ready.value) throw new Error("工作台尚未载入");
    await nextTick();
    if (!saving)
      saving = saveChanges().finally(() => {
        saving = undefined;
      });
    await saving;
  }

  function startWatching() {
    if (watching) return;
    watching = true;
    watch(content, () => {
      if (applying || !ready.value || status.value === "conflict") return;
      clearTimeout(timer);
      status.value = "pending";
      timer = setTimeout(() => {
        void flush().catch(() => {});
      }, 700);
    });
    window.addEventListener("beforeunload", (event) => {
      if (!hasUnsavedChanges.value) return;
      event.preventDefault();
      event.returnValue = "";
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && hasUnsavedChanges.value) void flush().catch(() => {});
    });
  }

  async function loadDesk() {
    status.value = "loading";
    message.value = "";
    try {
      const saved = await apiRequest<SavedDesk>("/api/coaching-desk");
      await tactics.refresh();
      try {
        if (!ready.value && !localStorage.getItem("football-previous-coaching-desk")) {
          localStorage.setItem("football-previous-coaching-desk", content());
        }
      } catch {
        /* 浏览器空间不足不应阻止载入已保存的工作台。 */
      }
      await apply(saved);
      if (!saved.desk) {
        migrateBoardIfNeeded();
        const formation = useFormation();
        formation.seedDefaultFormation();
        formation.tidyCurrentBoard();
        await nextTick();
        savedContent.value = "";
      }
      ready.value = true;
      startWatching();
      await flush();
      status.value = "saved";
    } catch (error) {
      status.value = error instanceof TacticsApiError && error.status === 409 ? "conflict" : "error";
      message.value = error instanceof Error ? error.message : "工作台载入失败";
    }
  }

  async function initialize() {
    if (!initializing)
      initializing = loadDesk().finally(() => {
        initializing = undefined;
      });
    await initializing;
  }

  function downloadDraft() {
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([JSON.stringify(capture(), null, 2)], { type: "application/json" }));
    link.href = url;
    link.download = `教练工作台-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return { ready, status, message, savedAt, edition, hasUnsavedChanges, initialize, flush, downloadDraft };
});
