import Dexie, { type Table } from "dexie";
import type { TrainingPlan } from "@/types/coaching";
import type { AnimationSnapshot } from "@/types/animation";

// 战术快照，keyframes 保留兼容旧文件，完整动画存于 animation。
export interface BoardSnapshot {
  formationId?: string | null;
  awayFormationId?: string | null;
  formationCustomized?: boolean;
  playerCount?: number;
  items: Record<string, unknown>[];
  drawings: Record<string, unknown>[];
  keyframes: unknown[];
  coaching?: TrainingPlan;
  animation?: AnimationSnapshot;
}

export interface MatchInfo {
  opponent?: string;
  date?: string;
  score?: string;
}

export interface TacticRecord {
  seedKey?: string;
  seedRevision?: number;
  id?: number;
  title: string;
  tags: string[];
  fav: boolean;
  formationId: string | null;
  match?: MatchInfo; // 关联比赛（对手/日期/比分），可选
  snapshot: BoardSnapshot;
  thumb: string | null; // 320px JPEG dataURL
  createdAt: number;
  updatedAt: number;
}

export interface VersionRecord {
  id?: number;
  tacticId: number;
  note: string;
  snapshot: BoardSnapshot;
  createdAt: number;
}

export const TACTIC_TAGS = ["进攻", "防守", "定位球", "边路", "逼抢"] as const;
export const MAX_VERSIONS = 50;

class BerlinGardenDB extends Dexie {
  tactics!: Table<TacticRecord, number>;
  versions!: Table<VersionRecord, number>;

  constructor() {
    super("berlin-garden-8v8");
    this.version(1).stores({
      tactics: "++id, title, fav, updatedAt",
      versions: "++id, tacticId, createdAt",
    });
  }
}

// 仅供读取旧浏览器战术，日常保存由战术服务完成。
export const db = new BerlinGardenDB();
