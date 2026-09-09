import { ref } from "vue";
import { defineStore } from "pinia";
import { type BoardSnapshot, type MatchInfo, type TacticRecord, type VersionRecord } from "@/db";
import { apiRequest } from "@/services/tacticsApi";
import {
  toBoard,
  toTactic,
  fromTactic,
  fromVersion,
  readCollection,
  type Tactic,
  type TacticVersion,
  type TacticCollection,
} from "@/services/tacticLanguage";
import { SEED_TACTICS } from "@/data/seedTactics";
import { FieldElement } from "@/types/fieldElement";
import { Drawing } from "@/types/drawing";
import { useItemStore } from "@/stores/itemStore";
import { useDrawStore } from "@/stores/drawStore";
import { useRosterStore } from "@/stores/rosterStore";
import { useHistory } from "@/composables/useHistory";
import { captureThumb } from "@/utils/thumbnail";
import { useCoachingStore } from "./coachingStore";
import { normalizeTrainingPlan } from "@/types/coaching";
import { useAnimationStore } from "./animationStore";
import { restoreAnimation } from "@/types/animation";
import { useMatchStore } from "./matchStore";
import { normalizePlayerCount } from "@/data/matchFormats";

export const useTacticsStore = defineStore("tactics", () => {
  const tactics = ref<TacticRecord[]>([]);
  const versions = ref<Record<number, VersionRecord[]>>({});
  const currentId = ref<number | null>(null);
  const ready = ref(false);
  // 打印源：设置后由 BoardView 渲染 PrintSheet 并调起 window.print
  const printSource = ref<TacticRecord | null>(null);
  const printNote = ref("");

  const snapshotBoard = (): BoardSnapshot => {
    const itemStore = useItemStore();
    const drawStore = useDrawStore();
    return JSON.parse(
      JSON.stringify({
        playerCount: useMatchStore().playerCount,
        items: itemStore.items.getAll().map((e) => ({ ...e })),
        drawings: drawStore.drawings.getDrawings().map((d) => ({ ...d })),
        keyframes: [],
        coaching: normalizeTrainingPlan(useCoachingStore().plan),
        animation: useAnimationStore().getSnapshot(),
      })
    ) as BoardSnapshot;
  };

  const restoreSnapshot = (snap: BoardSnapshot) => {
    const itemStore = useItemStore();
    const drawStore = useDrawStore();
    const rosterStore = useRosterStore();
    const { pushHistory } = useHistory();
    pushHistory();
    useMatchStore().playerCount = normalizePlayerCount(snap.playerCount);
    useAnimationStore().loadSnapshot(snap.animation);
    useCoachingStore().plan = normalizeTrainingPlan(snap.coaching);
    itemStore.items.clear();
    drawStore.drawings.clear();
    snap.items.forEach((raw) => itemStore.addElement(new FieldElement(raw as never)));
    snap.drawings.forEach((raw) => drawStore.drawings.add(new Drawing(raw as never)));
    // 按 id→姓名→号码重建名单↔场上关联（老快照无 rosterId 时兜底；对手跳过）
    rosterStore.players.forEach((p) => {
      p.fieldId = null;
    });
    itemStore.items
      .findByCreationMode("normal")
      .filter((el) => el.elementType === "player")
      .forEach((el) => {
        if (el.team === "away") return;
        const owner =
          rosterStore.players.find((p) => p.fieldId === null && el.rosterId && p.id === el.rosterId) ??
          (el.text
            ? (rosterStore.players.find((p) => p.fieldId === null && p.name === el.text) ??
              rosterStore.players.find((p) => p.fieldId === null && p.number === el.number))
            : undefined);
        if (owner) {
          owner.fieldId = el.id;
          // 顺手把 id 补进老元素，后续不再依赖名字
          if (!el.rosterId) el.rosterId = owner.id;
        }
      });
  };

  const refresh = async () => {
    tactics.value = (await apiRequest<Tactic[]>("/api/tactics")).map(fromTactic);
    ready.value = true;
  };

  const loadVersions = async (tacticId: number) => {
    versions.value[tacticId] = (await apiRequest<TacticVersion[]>(`/api/tactics/${tacticId}/versions`)).map(
      fromVersion
    );
  };

  // 显式保存：更新战术快照 + 新增一条历史版本
  const saveTactic = async (
    title: string,
    tags: string[],
    formationId: string | null,
    note = "",
    match: MatchInfo = {},
    asNew = false
  ) => {
    const now = Date.now();
    const snapshot = snapshotBoard();
    const targetId = asNew ? null : currentId.value;
    const cleanTags = [...tags];
    const thumb = await captureThumb();
    const cleanMatch: MatchInfo = {
      opponent: match.opponent?.trim() || undefined,
      date: match.date?.trim() || undefined,
      score: match.score?.trim() || undefined,
    };
    const existing = targetId === null ? undefined : tactics.value.find((t) => t.id === targetId);
    const result = await apiRequest<Tactic>(targetId === null ? "/api/tactics" : `/api/tactics/${targetId}`, {
      method: targetId === null ? "POST" : "PUT",
      body: {
        tactic: toTactic({
          ...existing,
          title,
          tags: cleanTags,
          formationId,
          match: cleanMatch,
          snapshot,
          thumb,
          fav: existing?.fav ?? false,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        }),
        note: note || (targetId === null ? "创建" : "保存"),
      },
    });
    const savedId = result.tacticId!;
    currentId.value = savedId;
    await refresh();
    await loadVersions(savedId);
  };

  const newBoard = () => {
    const itemStore = useItemStore();
    const drawStore = useDrawStore();
    const rosterStore = useRosterStore();
    const { pushHistory } = useHistory();
    pushHistory();
    itemStore.clearElements();
    drawStore.clearDrawings();
    useMatchStore().playerCount = 8;
    useCoachingStore().plan = normalizeTrainingPlan();
    useAnimationStore().loadSnapshot();
    rosterStore.players.forEach((p) => {
      p.fieldId = null;
    });
    currentId.value = null;
  };

  const loadTactic = async (id: number) => {
    const record = fromTactic(await apiRequest<Tactic>(`/api/tactics/${id}`));
    await loadVersions(id);
    restoreSnapshot(record.snapshot);
    currentId.value = id;
    // 打开时现拍缩略图回填（预置导入时无图）
    try {
      const thumb = await captureThumb();
      if (thumb) {
        await apiRequest(`/api/tactics/${id}`, { method: "PATCH", body: { thumbnail: thumb } });
        await refresh();
      }
    } catch {
      /* 忽略 */
    }
  };

  const rollback = async (version: VersionRecord) => {
    await apiRequest(`/api/tactics/${version.tacticId}`);
    const previousId = currentId.value;
    // 当前草稿的备份始终属于原战术，空白板由撤销历史保留。
    if (previousId !== null) {
      await apiRequest(`/api/tactics/${previousId}/versions`, {
        method: "POST",
        body: {
          note: "回滚前自动备份",
          board: toBoard(snapshotBoard()),
        },
      });
      await loadVersions(previousId);
    }
    restoreSnapshot(version.snapshot);
    currentId.value = version.tacticId;
    await loadVersions(version.tacticId);
  };

  // 从 JSON 文件导入：落到画布并存为一条新战术（含初始版本）
  const importTactic = async (title: string, tags: string[], snapshot: BoardSnapshot, match?: MatchInfo) => {
    const now = Date.now();
    const safe: BoardSnapshot = {
      playerCount: normalizePlayerCount(snapshot.playerCount),
      items: Array.isArray(snapshot.items) ? snapshot.items : [],
      drawings: Array.isArray(snapshot.drawings) ? snapshot.drawings : [],
      keyframes: [],
      coaching: normalizeTrainingPlan(snapshot.coaching),
      animation: restoreAnimation(snapshot.animation)?.toJSON(),
    };
    const record = await apiRequest<Tactic>("/api/tactics", {
      method: "POST",
      body: {
        tactic: toTactic({
          title,
          tags,
          fav: false,
          formationId: null,
          match: match && (match.opponent || match.date || match.score) ? match : undefined,
          snapshot: safe,
          thumb: null,
          createdAt: now,
          updatedAt: now,
        }),
        note: "导入",
      },
    });
    restoreSnapshot(safe);
    currentId.value = record.tacticId!;
    await loadVersions(currentId.value);
    await refresh();
  };

  const deleteTactic = async (id: number) => {
    await apiRequest(`/api/tactics/${id}`, { method: "DELETE" });
    delete versions.value[id];
    if (currentId.value === id) currentId.value = null;
    await refresh();
  };

  const toggleFav = async (id: number) => {
    const record = fromTactic(await apiRequest<Tactic>(`/api/tactics/${id}`));
    await apiRequest(`/api/tactics/${id}`, { method: "PATCH", body: { favorite: !record.fav } });
    await refresh();
  };

  const requestPrint = async (id: number) => {
    const record = fromTactic(await apiRequest<Tactic>(`/api/tactics/${id}`));
    await loadVersions(id);
    const vs = versions.value[id] || [];
    printNote.value = [...vs].sort((a, b) => b.createdAt - a.createdAt)[0]?.note ?? "";
    printSource.value = record;
  };

  // 导入预置战术：按标题去重，返回新增套数；要点记为首条版本备注
  const importSeedTactics = async (): Promise<number> => {
    const records = (await apiRequest<Tactic[]>("/api/tactics")).map(fromTactic);
    const existing = new Set(records.filter((t) => t.seedRevision === 2).map((t) => t.seedKey));
    let count = 0;
    for (const seed of SEED_TACTICS) {
      if (existing.has(seed.id)) continue;
      const now = Date.now();
      const snapshot: BoardSnapshot = {
        items: seed.snapshot.items,
        drawings: seed.snapshot.drawings,
        keyframes: [],
        coaching: seed.snapshot.coaching,
        animation: seed.snapshot.animation,
      };
      await apiRequest<Tactic>("/api/tactics", {
        method: "POST",
        body: {
          tactic: toTactic({
            title: records.some((t) => t.title === seed.title) ? `${seed.title} · 进阶版` : seed.title,
            seedKey: seed.id,
            seedRevision: 2,
            tags: [...seed.tags],
            fav: false,
            formationId: seed.formationId,
            snapshot,
            thumb: null,
            createdAt: now,
            updatedAt: now,
          }),
          note: `预置：${seed.note}`,
        },
      });
      existing.add(seed.id);
      count++;
    }
    await refresh();
    return count;
  };

  // 快速保存：沿用原标题/标签/阵型/比赛信息，无战术时自动起名新建
  const quickSave = async (): Promise<string> => {
    if (currentId.value === null) {
      const name = `战术 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
      await saveTactic(name, [], null, "快速保存");
      return `已新建并保存「${name}」`;
    }
    const t =
      tactics.value.find((x) => x.id === currentId.value) ??
      fromTactic(await apiRequest<Tactic>(`/api/tactics/${currentId.value}`));
    if (!t) {
      const name = `战术 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
      await saveTactic(name, [], null, "快速保存");
      return `已新建并保存「${name}」`;
    }
    await saveTactic(t.title, t.tags, t.formationId, "快速保存", t.match ?? {});
    return `已保存「${t.title}」`;
  };
  // 整库备份：战术 + 历史版本（版本用数组下标关联，恢复时重建 id 映射）
  const exportBackup = async (): Promise<string> => {
    return JSON.stringify(await apiRequest<TacticCollection>("/api/tactic-collections"));
  };

  // 整库恢复：追加导入（不覆盖现有），返回导入套数
  const importBackup = async (payload: unknown): Promise<number> => {
    const result = await apiRequest<{ importedCount: number }>("/api/tactic-collections", {
      method: "POST",
      body: readCollection(payload),
    });
    currentId.value = null;
    await refresh();
    return result.importedCount;
  };

  const clearPrint = () => {
    printSource.value = null;
    printNote.value = "";
  };

  return {
    tactics,
    versions,
    currentId,
    ready,
    printSource,
    printNote,
    snapshotBoard,
    restoreSnapshot,
    refresh,
    loadVersions,
    saveTactic,
    newBoard,
    loadTactic,
    rollback,
    importTactic,
    deleteTactic,
    toggleFav,
    requestPrint,
    clearPrint,
    exportBackup,
    importBackup,
    importSeedTactics,
    quickSave,
  };
});
