import Dexie from "dexie";
import { db } from "@/db";
import { toBoard, toTactic, type TacticCollection } from "./tacticLanguage";

export class TacticsApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}
export async function apiRequest<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      signal: controller.signal,
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      throw new TacticsApiError(detail?.message || "战术服务暂时不可用，请稍后重试", response.status);
    }
    return response.status === 204 ? (undefined as T) : await response.json();
  } catch (error) {
    if (error instanceof TacticsApiError) throw error;
    throw new Error(
      controller.signal.aborted ? "战术服务响应超时，请检查连接后重试" : "无法连接战术服务，请检查连接后重试"
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function inspectLegacyTactics(): Promise<number> {
  if (!(await Dexie.exists("berlin-garden-8v8"))) return 0;
  return db.tactics.count();
}
export async function migrateLegacyTactics(): Promise<number> {
  if (!(await inspectLegacyTactics())) return 0;
  const tactics = await db.tactics.toArray();
  const versions = await db.versions.toArray();
  const numbers = new Map(tactics.map((t, i) => [t.id, i]));
  const nameKey = "football-tactic-collection-name";
  let collectionName = localStorage.getItem(nameKey);
  if (!collectionName) {
    collectionName = `browser-tactics-${crypto.randomUUID()}`;
    localStorage.setItem(nameKey, collectionName);
  }
  const collection: TacticCollection = {
    collectionName,
    tactics: tactics.map(toTactic),
    versions: versions
      .filter((v) => numbers.has(v.tacticId))
      .map((v) => ({
        tacticNumber: numbers.get(v.tacticId)!,
        note: v.note,
        board: toBoard(v.snapshot),
        createdAt: v.createdAt,
      })),
  };
  const result = await apiRequest<{ importedCount: number }>("/api/tactic-collections", {
    method: "POST",
    body: collection,
  });
  return result.importedCount;
}
