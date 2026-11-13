import { FootballError } from './football-store.mjs';
import { tacticVersion } from './tactic-version.mjs';
export function readTacticPositions(store, id) {
  const tactic = store.getTactic(id);
  return { tactic, version: tacticVersion(tactic) };
}
export function moveTacticPositions(store, id, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FootballError(400, '请提供球员移动记录。');
  if (typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version)) throw new FootballError(428, '请先读取当前战术版本。');
  if (!Array.isArray(input.positions) || !input.positions.length || input.positions.length > 1000) throw new FootballError(400, '请提供有效的站位修改。');
  const current = store.getTactic(id);
  const pieces = new Map(current.board.pieces.map(p => [p.pieceId, p]));
  const updates = new Map();
  for (const p of input.positions) {
    if (!p || typeof p !== 'object' || !pieces.has(p.pieceId) || updates.has(p.pieceId) || (pieces.get(p.pieceId).kind || 'player') !== 'player' || typeof p.x !== 'number' || !Number.isFinite(p.x) || p.x < 0 || p.x > 1250 || typeof p.y !== 'number' || !Number.isFinite(p.y) || p.y < 0 || p.y > 826) throw new FootballError(400, '仅可移动本战术球员，且站位必须在画布范围内。');
    updates.set(p.pieceId, { x: p.x, y: p.y });
  }
  const tactic = {
    ...current,
    thumbnail: null,
    board: { ...current.board, formationCustomized: true,
      pieces: current.board.pieces.map(p => updates.has(p.pieceId) ? { ...p, ...updates.get(p.pieceId) } : p),
    },
  };
  const saved = store.saveTactic(id, { tactic, note: '小程序调整初始球员站位', expectedVersion: input.version });
  return { tactic: saved, version: tacticVersion(saved) };
}
