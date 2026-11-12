import type { BoardSnapshot, MatchInfo, TacticRecord, VersionRecord } from "@/db";
import { restoreAnimation } from "@/types/animation";
import { normalizeTrainingPlan } from "@/types/coaching";
import { normalizePlayerCount } from "@/data/matchFormats";

type PieceId = string | number;
export interface Piece {
  pieceId: PieceId;
  kind: string;
  x: number;
  y: number;
  color?: string;
  radius?: number;
  label?: string;
  shirtNumber?: number;
  position?: string;
  team?: string;
  playerId?: string | null;
}
export interface Marking {
  markingId: PieceId;
  kind: string;
  x?: number;
  y?: number;
  color?: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  strokeColor?: string;
  backgroundColor?: string;
  width?: number;
  path?: [number, number][];
  dashed?: boolean;
  label?: string;
}
export interface Board {
  playerCount?: number;
  pieces: Piece[];
  markings: Marking[];
  // 当前画布的阵型血缘（模板起点），随工作台自动保存；重载后恢复徽标与高亮。
  formationId?: string | null;
  awayFormationId?: string | null;
  formationCustomized?: boolean;
  trainingPlan?: BoardSnapshot["coaching"];
  demonstration?: {
    demonstrationId: PieceId;
    title: string;
    participants: Piece[];
    stages: {
      stageNumber: number;
      title?: string;
      note?: string;
      durationSeconds?: number;
      positions: { pieceId: PieceId; x: number; y: number }[];
    }[];
    runs: { pieceId: PieceId; fromStage: number; bend: { x: number; y: number } }[];
  };
}
export interface Tactic {
  tacticId?: number;
  title: string;
  tags: string[];
  favorite: boolean;
  formationName: string | null;
  match?: MatchInfo;
  board: Board;
  thumbnail: string | null;
  createdAt?: number;
  savedAt?: number;
  presetName?: string;
  presetEdition?: number;
}
export interface TacticVersion {
  versionId: number;
  tacticId: number;
  note: string;
  board: Board;
  createdAt: number;
}
export interface TacticCollection {
  tactics: Tactic[];
  versions: { tacticNumber: number; note: string; board: Board; createdAt: number }[];
  exportedAt?: number;
  collectionName?: string;
}

function toPiece(raw: Record<string, unknown>): Piece {
  return {
    pieceId: raw.id as PieceId,
    kind: (raw.elementType as string) || "player",
    x: Number(raw.x) || 0,
    y: Number(raw.y) || 0,
    color: raw.color as string,
    radius: raw.r as number,
    label: raw.text as string,
    shirtNumber: raw.number as number,
    position: raw.playerPosition as string,
    team: raw.team as string,
    playerId: raw.rosterId as string | null,
  };
}
function fromPiece(piece: Piece, creationMode = "normal"): Record<string, unknown> {
  return {
    id: piece.pieceId,
    elementType: piece.kind,
    x: piece.x,
    y: piece.y,
    color: piece.color,
    r: piece.radius,
    text: piece.label,
    number: piece.shirtNumber,
    playerPosition: piece.position,
    team: piece.team,
    rosterId: piece.playerId,
    creationMode,
    isDragging: false,
  };
}
export function toBoard(value: BoardSnapshot): Board {
  const animation = restoreAnimation(value.animation)?.toJSON();
  return {
    playerCount: normalizePlayerCount(value.playerCount),
    formationId: value.formationId,
    awayFormationId: value.awayFormationId,
    formationCustomized: value.formationCustomized,
    pieces: value.items.filter((p) => !p.creationMode || p.creationMode === "normal").map(toPiece),
    markings: value.drawings.map((d) => ({
      markingId: d.id as PieceId,
      kind: d.drawingType as string,
      x: d.x as number,
      y: d.y as number,
      color: d.color as string,
      startX: d.startX as number,
      startY: d.startY as number,
      endX: d.endX as number,
      endY: d.endY as number,
      strokeColor: d.strokeColor as string,
      backgroundColor: d.backgroundColor as string,
      width: d.size as number,
      path: d.pathPoints as [number, number][],
      dashed: d.dashed as boolean,
      label: d.text as string,
    })),
    trainingPlan: normalizeTrainingPlan(value.coaching),
    demonstration: animation
      ? {
          demonstrationId: animation.id,
          title: animation.name,
          participants: animation.sharedElementPool.map(([id, p]) => toPiece({ ...p, id })),
          stages: animation.frames.map((f) => ({
            stageNumber: f.frameNumber,
            title: f.title,
            note: f.note,
            durationSeconds: f.duration,
            positions: f.elements.map((p) => ({ pieceId: p.id, x: p.x, y: p.y })),
          })),
          runs: animation.actions.map((a) => ({
            pieceId: a.animationElementId,
            fromStage: a.startFrame,
            bend: a.controlPoint,
          })),
        }
      : undefined,
  };
}
export function fromBoard(board: Board): BoardSnapshot {
  if (!board || !Array.isArray(board.pieces) || !Array.isArray(board.markings)) throw new Error("战术板内容不完整");
  const demonstration = board.demonstration;
  return {
    playerCount: normalizePlayerCount(board.playerCount),
    formationId: board.formationId,
    awayFormationId: board.awayFormationId,
    formationCustomized: board.formationCustomized,
    items: board.pieces.map((p) => fromPiece(p)),
    drawings: board.markings.map((d) => ({
      id: d.markingId,
      drawingType: d.kind,
      x: d.x,
      y: d.y,
      color: d.color,
      startX: d.startX,
      startY: d.startY,
      endX: d.endX,
      endY: d.endY,
      strokeColor: d.strokeColor,
      backgroundColor: d.backgroundColor,
      size: d.width,
      pathPoints: d.path,
      dashed: d.dashed,
      text: d.label,
      creationMode: "normal",
      isDragging: false,
    })),
    keyframes: [],
    coaching: normalizeTrainingPlan(board.trainingPlan),
    animation: demonstration
      ? restoreAnimation({
          id: demonstration.demonstrationId,
          name: demonstration.title,
          sharedElementPool: demonstration.participants.map((p) => [p.pieceId, fromPiece(p, "animation")]),
          frames: demonstration.stages.map((s) => ({
            frameNumber: s.stageNumber,
            title: s.title,
            note: s.note,
            duration: s.durationSeconds,
            elements: s.positions.map((p) => ({ id: p.pieceId, x: p.x, y: p.y })),
          })),
          actions: demonstration.runs.map((r) => ({
            animationElementId: r.pieceId,
            startFrame: r.fromStage,
            controlPoint: r.bend,
          })),
        })?.toJSON()
      : undefined,
  };
}
export function toTactic(t: TacticRecord): Tactic {
  return {
    tacticId: t.id,
    title: t.title,
    tags: t.tags,
    favorite: t.fav,
    formationName: t.formationId,
    match: t.match,
    board: toBoard(t.snapshot),
    thumbnail: t.thumb,
    createdAt: t.createdAt,
    savedAt: t.updatedAt,
    presetName: t.seedKey,
    presetEdition: t.seedRevision,
  };
}
export function fromTactic(t: Tactic): TacticRecord {
  return {
    id: t.tacticId,
    title: t.title,
    tags: t.tags,
    fav: t.favorite,
    formationId: t.formationName,
    match: t.match,
    snapshot: fromBoard(t.board),
    thumb: t.thumbnail,
    createdAt: t.createdAt ?? Date.now(),
    updatedAt: t.savedAt ?? Date.now(),
    seedKey: t.presetName,
    seedRevision: t.presetEdition,
  };
}
export function fromVersion(v: TacticVersion): VersionRecord {
  return { id: v.versionId, tacticId: v.tacticId, note: v.note, snapshot: fromBoard(v.board), createdAt: v.createdAt };
}

export function readCollection(payload: unknown): TacticCollection {
  if (!payload || typeof payload !== "object" || !("tactics" in payload) || !Array.isArray(payload.tactics)) {
    throw new Error("不是有效的战术库备份文件");
  }
  const data = payload as {
    tactics: (Tactic & TacticRecord)[];
    versions?: (TacticCollection["versions"][number] & VersionRecord & { tacticKey: number })[];
  };
  return {
    tactics: data.tactics.map((t) => {
      if (t.board) return toTactic(fromTactic(t));
      if (!t.snapshot) throw new Error("备份中的战术板内容不完整");
      return toTactic({
        ...t,
        title: t.title || "恢复战术",
        tags: t.tags ?? [],
        fav: !!t.fav,
        formationId: t.formationId ?? null,
        thumb: t.thumb ?? null,
        snapshot: {
          ...t.snapshot,
          items: Array.isArray(t.snapshot.items) ? t.snapshot.items : [],
          drawings: Array.isArray(t.snapshot.drawings) ? t.snapshot.drawings : [],
        },
      });
    }),
    versions: (data.versions ?? []).map((v) => ({
      tacticNumber: v.tacticNumber ?? v.tacticKey,
      note: v.note ?? "",
      board: v.board ? toBoard(fromBoard(v.board)) : toBoard(v.snapshot),
      createdAt: v.createdAt ?? Date.now(),
    })),
    exportedAt: Date.now(),
  };
}
