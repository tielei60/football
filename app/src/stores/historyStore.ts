import { defineStore } from "pinia";
import { ref } from "vue";
import { FieldElement } from "../types/fieldElement";
import { Drawing } from "../types/drawing";
import type { RosterEntry } from "./rosterStore";
import type { TrainingPlan } from "@/types/coaching";
import { useMatchStore } from "./matchStore";
import type { MatchPlayerCount } from "@/data/matchFormats";
import type { AnimationSnapshot } from "@/types/animation";

// 定义操作类型
type OperationType = "add" | "delete" | "update" | "clear" | "";

// 定义历史记录项的接口
export interface BoardMetaSnapshot {
  tacticId?: number | null;
  formationId: string | null;
  awayFormationId: string | null;
  formationCustomized: boolean;
}

interface HistoryItem {
  playerCount: MatchPlayerCount;
  type: OperationType;
  elements?: FieldElement[];
  drawings?: Drawing[];
  roster?: RosterEntry[];
  coaching?: TrainingPlan;
  meta?: BoardMetaSnapshot;
  // Undefined: ordinary edit, leave animation alone. Null: boundary had no animation.
  animation?: AnimationSnapshot | null;
  timestamp: number;
}

const cloneAnimation = (animation?: AnimationSnapshot | null): AnimationSnapshot | null | undefined => {
  if (animation === undefined || animation === null) return animation;
  return JSON.parse(JSON.stringify(animation));
};

export const useHistoryStore = defineStore("history", () => {
  const undoStack = ref<HistoryItem[]>([]);
  const redoStack = ref<HistoryItem[]>([]);

  // 添加新的操作到历史记录
  const pushHistory = (
    type: OperationType,
    elements?: FieldElement[],
    drawings?: Drawing[],
    roster?: RosterEntry[],
    coaching?: TrainingPlan,
    meta?: BoardMetaSnapshot,
    animation?: AnimationSnapshot | null
  ) => {
    const historyItem: HistoryItem = {
      playerCount: useMatchStore().playerCount,
      type,
      elements: elements?.map((el) => el.cloneIncludingId()),
      drawings: drawings?.map((d) => d.clone()),
      roster: roster?.map((p) => ({ ...p, positions: [...p.positions] })),
      coaching: coaching ? { ...coaching } : undefined,
      meta: meta ? { ...meta } : undefined,
      animation: cloneAnimation(animation),
      timestamp: Date.now(),
    };
    undoStack.value.push(historyItem);
  };

  // 添加新的操作到重做记录
  const pushRedoHistory = (
    type: OperationType,
    elements?: FieldElement[],
    drawings?: Drawing[],
    roster?: RosterEntry[],
    coaching?: TrainingPlan,
    meta?: BoardMetaSnapshot,
    animation?: AnimationSnapshot | null
  ) => {
    const historyItem: HistoryItem = {
      playerCount: useMatchStore().playerCount,
      type,
      elements: elements?.map((el) => el.cloneIncludingId()),
      drawings: drawings?.map((d) => d.clone()),
      roster: roster?.map((p) => ({ ...p, positions: [...p.positions] })),
      coaching: coaching ? { ...coaching } : undefined,
      meta: meta ? { ...meta } : undefined,
      animation: cloneAnimation(animation),
      timestamp: Date.now(),
    };
    redoStack.value.push(historyItem);
  };

  const popUndo = () => {
    if (undoStack.value.length === 0) return null;
    return undoStack.value.pop();
  };

  const popRedo = () => {
    if (redoStack.value.length === 0) return null;
    return redoStack.value.pop();
  };

  // 清空历史记录
  const clearHistory = () => {
    undoStack.value = [];
    redoStack.value = [];
  };

  // 检查是否可以撤销/重做
  const canUndo = () => undoStack.value.length > 0;
  const canRedo = () => redoStack.value.length > 0;

  return {
    pushHistory,
    pushRedoHistory,
    popUndo,
    popRedo,
    clearHistory,
    canUndo,
    canRedo,
    undoStack,
    redoStack,
  };
});
