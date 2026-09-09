import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useHistoryStore } from "../stores/historyStore";
import { useDrawStore } from "../stores/drawStore";
import { useItemStore } from "../stores/itemStore";
import { useRosterStore } from "../stores/rosterStore";
import { useCoachingStore } from "../stores/coachingStore";
import { useMatchStore } from "../stores/matchStore";

export function useHistory() {
  const itemStore = useItemStore();
  const drawStore = useDrawStore();
  const historyStore = useHistoryStore();

  const { items } = storeToRefs(itemStore);
  const { drawings } = storeToRefs(drawStore);
  const { undoStack, redoStack } = storeToRefs(historyStore);

  // 检查是否可以撤销/重做
  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);

  // 处理撤销操作
  const handleUndo = () => {
    if (!canUndo.value) return;

    // 在执行撤销之前，保存当前状态到 redoHistory
    historyStore.pushRedoHistory(
      "",
      items.value.getAll(),
      drawings.value.getDrawings(),
      useRosterStore().players,
      useCoachingStore().plan
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
  };

  // 处理重做操作
  const handleRedo = () => {
    if (!canRedo.value) return;

    // 在执行重做之前，保存当前状态到 undoHistory
    historyStore.pushHistory(
      "",
      items.value.getAll(),
      drawings.value.getDrawings(),
      useRosterStore().players,
      useCoachingStore().plan
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
  };

  // 保存当前状态到撤销栈
  const pushHistory = () => {
    const itemData = items && items.value ? items.value.getAll() : [];
    const drawingData = drawings?.value ? drawings.value.getDrawings() : [];
    historyStore.pushHistory("", itemData, drawingData, useRosterStore().players, useCoachingStore().plan);
    // 清空重做栈
    redoStack.value = [];
  };

  return {
    handleUndo,
    handleRedo,
    pushHistory,
    canUndo,
    canRedo,
  };
}
