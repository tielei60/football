import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useHistoryStore } from "../stores/historyStore";
import { useDrawStore } from "../stores/drawStore";
import { useItemStore } from "../stores/itemStore";
import { useRosterStore } from "../stores/rosterStore";
import { useCoachingStore } from "../stores/coachingStore";
import { useMatchStore } from "../stores/matchStore";
import { useTacticsStore } from "../stores/tacticsStore";
import type { BoardMetaSnapshot } from "../stores/historyStore";
import { useAnimationStore } from "../stores/animationStore";

export function useHistory() {
  const itemStore = useItemStore();
  const drawStore = useDrawStore();
  const historyStore = useHistoryStore();

  const { items } = storeToRefs(itemStore);
  const { drawings } = storeToRefs(drawStore);
  const { undoStack, redoStack } = storeToRefs(historyStore);

  // 压栈时顺带记录阵型血缘，撤销/重做可精确恢复徽标与高亮。
  const captureMeta = (boundary = false): BoardMetaSnapshot => {
    const tactics = useTacticsStore();
    return {
      ...(boundary ? { tacticId: tactics.currentId } : {}),
      formationId: tactics.currentFormationId,
      awayFormationId: tactics.awayFormationId,
      formationCustomized: tactics.formationCustomized,
    };
  };

  // 检查是否可以撤销/重做
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  // 处理撤销操作
  const handleUndo = () => {
    if (!canUndo.value) return;
    useTacticsStore().invalidateBoardRequests();

    // 在执行撤销之前，保存当前状态到 redoHistory
    historyStore.pushRedoHistory(
      "",
      items.value.getAll(),
      drawings.value.getDrawings(),
      useRosterStore().players,
      useCoachingStore().plan,
      captureMeta(undoStack.value[undoStack.value.length - 1]?.animation !== undefined),
      undoStack.value[undoStack.value.length - 1]?.animation !== undefined
        ? (useAnimationStore().getSnapshot() ?? null)
        : undefined
    );

    const lastOperation = historyStore.popUndo();
    if (!lastOperation) return;
    useMatchStore().playerCount = lastOperation.playerCount;

    items.value.clear();
    drawings.value.clear();

    if (lastOperation.elements) {
      lastOperation.elements.forEach((el) => items.value.add(el.cloneIncludingId()));
    }

    if (lastOperation.drawings) {
      lastOperation.drawings.forEach((d) => drawings.value.add(d.clone()));
    }
    if (lastOperation.roster)
      useRosterStore().players = lastOperation.roster.map((p) => ({ ...p, positions: [...p.positions] }));
    if (lastOperation.coaching) useCoachingStore().plan = { ...lastOperation.coaching };
    useTacticsStore().restoreBoardMeta(lastOperation.meta);
    if (lastOperation.animation !== undefined) useAnimationStore().loadSnapshot(lastOperation.animation);
  };

  // 处理重做操作
  const handleRedo = () => {
    if (!canRedo.value) return;
    useTacticsStore().invalidateBoardRequests();

    // 在执行重做之前，保存当前状态到 undoHistory
    historyStore.pushHistory(
      "",
      items.value.getAll(),
      drawings.value.getDrawings(),
      useRosterStore().players,
      useCoachingStore().plan,
      captureMeta(redoStack.value[redoStack.value.length - 1]?.animation !== undefined),
      redoStack.value[redoStack.value.length - 1]?.animation !== undefined
        ? (useAnimationStore().getSnapshot() ?? null)
        : undefined
    );

    const nextOperation = historyStore.popRedo();
    if (!nextOperation) return;
    useMatchStore().playerCount = nextOperation.playerCount;

    // 清空当前画布并恢复重做状态
    items.value.clear();
    drawings.value.clear();

    if (nextOperation.elements) {
      nextOperation.elements.forEach((el) => items.value.add(el.cloneIncludingId()));
    }

    if (nextOperation.drawings) {
      nextOperation.drawings.forEach((d) => drawings.value.add(d.clone()));
    }
    if (nextOperation.roster)
      useRosterStore().players = nextOperation.roster.map((p) => ({ ...p, positions: [...p.positions] }));
    if (nextOperation.coaching) useCoachingStore().plan = { ...nextOperation.coaching };
    useTacticsStore().restoreBoardMeta(nextOperation.meta);
    if (nextOperation.animation !== undefined) useAnimationStore().loadSnapshot(nextOperation.animation);
  };

  // 保存当前状态到撤销栈
  const captureHistory = (includeAnimation: boolean) => {
    const itemData = items && items.value ? items.value.getAll() : [];
    const drawingData = drawings?.value ? drawings.value.getDrawings() : [];
    historyStore.pushHistory(
      "",
      itemData,
      drawingData,
      useRosterStore().players,
      useCoachingStore().plan,
      captureMeta(includeAnimation),
      includeAnimation ? (useAnimationStore().getSnapshot() ?? null) : undefined
    );
    // 清空重做栈
    redoStack.value = [];
  };

  return {
    handleUndo,
    handleRedo,
    pushHistory: () => captureHistory(false),
    pushBoardHistory: () => captureHistory(true),
    canUndo,
    canRedo,
  };
}
