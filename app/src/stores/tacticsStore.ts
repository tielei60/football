import { nextTick, ref, watch } from "vue";
import { defineStore } from "pinia";
import { type BoardSnapshot, type MatchInfo, type TacticRecord, type VersionRecord } from "@/db";
import { apiRequest, collectionImportResult, type CollectionImportResult } from "@/services/tacticsApi";
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
  // 三层模型的状态贯通：阵型模板（起点）→ 当前画布（草稿）→ 战术库（存档）。
  // currentFormationId 记录“当前画布由哪个模板落位”，手动拖动后 formationCustomized 置 true；
  // boardDirty 表示草稿有未保存修改（落模板 / 手动编辑均置脏，保存 / 打开后清零）。
  const currentFormationId = ref<string | null>(null);
  const awayFormationId = ref<string | null>(null);
  const formationCustomized = ref(false);
  const boardDirty = ref(false);
  // 程序化落位/打开/保存期间挂起 BoardView 的手动编辑 watcher，避免误标“已微调”。
  // 挂起在 nextTick 自动解除：落位变更与 watcher 回调同 tick，watcher 先跑（仍挂起中被跳过）。
  const dirtySuspended = ref(false);
  const suspendDirty = () => {
    dirtySuspended.value = true;
    void nextTick(() => {
      dirtySuspended.value = false;
    });
  };

  // awayId 缺省 undefined 表示“保持对手状态”，传 null 则清空对手。
  const applyFormationState = (id: string | null, awayId?: string | null, resetCustomized = true) => {
    currentFormationId.value = id;
    if (awayId !== undefined) awayFormationId.value = awayId;
    if (resetCustomized) formationCustomized.value = false;
    boardDirty.value = true;
    suspendDirty();
  };

  const markBoardEdited = () => {
    boardDirty.value = true;
    if (currentFormationId.value) formationCustomized.value = true;
  };

  const markBoardClean = (
    formationId: string | null = currentFormationId.value,
    awayId?: string | null,
    customized = false
  ) => {
    currentFormationId.value = formationId;
    if (awayId !== undefined) awayFormationId.value = awayId;
    formationCustomized.value = customized;
    boardDirty.value = false;
    suspendDirty();
  };

  // 人数和阵型来自同一份历史快照，撤销/重做时一起恢复。
  const restoreBoardMeta = (
    meta: { formationId: string | null; awayFormationId: string | null; formationCustomized: boolean } | undefined
  ) => {
    suspendDirty();
    if (!meta) {
      currentFormationId.value = null;
      awayFormationId.value = null;
      formationCustomized.value = false;
    } else {
      currentFormationId.value = meta.formationId;
      awayFormationId.value = meta.awayFormationId;
      formationCustomized.value = meta.formationCustomized;
    }
    boardDirty.value = true;
  };

  const snapshotBoard = (): BoardSnapshot => {
    const itemStore = useItemStore();
    const drawStore = useDrawStore();
    return JSON.parse(
      JSON.stringify({
        playerCount: useMatchStore().playerCount,
        formationId: currentFormationId.value,
        awayFormationId: awayFormationId.value,
        formationCustomized: formationCustomized.value,
        items: itemStore.items.getAll().map((e) => ({ ...e })),
        drawings: drawStore.drawings.getDrawings().map((d) => ({ ...d })),
        keyframes: [],
        coaching: normalizeTrainingPlan(useCoachingStore().plan),
        animation: useAnimationStore().getSnapshot(),
      })
    ) as BoardSnapshot;
  };

  // 训练计划和演示也是战术内容，编辑它们不代表主队站位已微调。
  watch(
    () => [useCoachingStore().plan, useAnimationStore().currentAnimation],
    () => {
      if (!dirtySuspended.value) boardDirty.value = true;
    },
    { deep: true }
  );

  const syncBoardDirty = () => {
    const record = tactics.value.find((tactic) => tactic.id === currentId.value);
    if (!record) {
      boardDirty.value = true;
      return;
    }
    const saved = record.snapshot;
    const normalized = {
      ...saved,
      formationId: saved.formationId === undefined ? record.formationId : saved.formationId,
      awayFormationId:
        saved.awayFormationId === undefined
          ? saved.items.some((raw) => raw.team === "away")
            ? "custom"
            : null
          : saved.awayFormationId,
      formationCustomized: saved.formationCustomized === true,
    };
    boardDirty.value = JSON.stringify(toBoard(snapshotBoard())) !== JSON.stringify(toBoard(normalized));
  };

  const restoreFormationMeta = (snap: BoardSnapshot, fallback: string | null = null) => {
    markBoardClean(
      snap.formationId === undefined ? fallback : snap.formationId,
      snap.awayFormationId === undefined
        ? snap.items.some((raw) => raw.team === "away")
          ? "custom"
          : null
        : snap.awayFormationId,
      snap.formationCustomized === true
    );
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

  // 显式保存：更新战术快照 + 新增一条历史版本。
  // formationId 缺省取当前画布的模板（含“已微调”也保留模板血缘），调用方可显式覆盖。
  const saveTactic = async (
    title: string,
    tags: string[],
    formationId: string | null = currentFormationId.value,
    note = "",
    match: MatchInfo = {},
    asNew = false
  ) => {
    const now = Date.now();
    const snapshot = snapshotBoard();
    const capturedContent = JSON.stringify(toBoard(snapshot));
    snapshot.formationId = formationId;
    const sourceId = currentId.value;
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
    // 保存的是请求发出时的快照；响应不能清除后续编辑或切换的新画布。
    if (currentId.value === sourceId) {
      currentId.value = savedId;
      if (JSON.stringify(toBoard(snapshotBoard())) === capturedContent) {
        markBoardClean(formationId, snapshot.awayFormationId, snapshot.formationCustomized);
      }
    }
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
    // 空白画布尚未应用模板，允许下一次点击默认阵型进行落位。
    markBoardClean(null, null);
  };

  const loadTactic = async (id: number) => {
    const record = fromTactic(await apiRequest<Tactic>(`/api/tactics/${id}`));
    await loadVersions(id);
    restoreSnapshot(record.snapshot);
    currentId.value = id;
    restoreFormationMeta(record.snapshot, record.formationId);
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
    restoreFormationMeta(version.snapshot);
    // 回滚只替换工作台草稿，尚未写回战术库。
    boardDirty.value = true;
  };

  // 从 JSON 文件导入：落到画布并存为一条新战术（含初始版本）
  const importTactic = async (title: string, tags: string[], snapshot: BoardSnapshot, match?: MatchInfo) => {
    const now = Date.now();
    const safe: BoardSnapshot = {
      playerCount: normalizePlayerCount(snapshot.playerCount),
      formationId: snapshot.formationId,
      awayFormationId: snapshot.awayFormationId,
      formationCustomized: snapshot.formationCustomized,
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
          formationId: safe.formationId ?? null,
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
    restoreFormationMeta(safe);
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

  // 快速保存：沿用原标题/标签/比赛信息，阵型取当前画布模板；无战术时自动起名新建
  const quickSave = async (): Promise<string> => {
    if (currentId.value === null) {
      const name = `战术 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
      await saveTactic(name, [], currentFormationId.value, "快速保存");
      return `已新建并保存「${name}」`;
    }
    const t =
      tactics.value.find((x) => x.id === currentId.value) ??
      fromTactic(await apiRequest<Tactic>(`/api/tactics/${currentId.value}`));
    if (!t) {
      const name = `战术 ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
      await saveTactic(name, [], currentFormationId.value, "快速保存");
      return `已新建并保存「${name}」`;
    }
    await saveTactic(t.title, t.tags, currentFormationId.value ?? t.formationId, "快速保存", t.match ?? {});
    return `已保存「${t.title}」`;
  };
  // 整库备份：战术 + 历史版本（版本用数组下标关联，恢复时重建 id 映射）
  const exportBackup = async (): Promise<string> => {
    return JSON.stringify(await apiRequest<TacticCollection>("/api/tactic-collections"));
  };

  // 整库恢复：追加导入（不覆盖现有），返回导入数量及收据内容核验结果
  const importBackup = async (payload: unknown): Promise<CollectionImportResult> => {
    const result = collectionImportResult(await apiRequest<CollectionImportResult>("/api/tactic-collections", {
      method: "POST",
      body: readCollection(payload),
    }));
    if (result.receiptVerification === "verified") currentId.value = null;
    try {
      await refresh();
    } catch {
      // POST 已返回收据；列表读取失败不能冒充导入失败并引导重复写入。
      result.listRefreshFailed = true;
    }
    return result;
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
    currentFormationId,
    awayFormationId,
    formationCustomized,
    boardDirty,
    dirtySuspended,
    applyFormationState,
    markBoardEdited,
    markBoardClean,
    restoreBoardMeta,
    syncBoardDirty,
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
