import { EIGHT_FORMATIONS, type Formation } from "./eightFormations";

export const MATCH_PLAYER_COUNTS = [8, 11, 9, 6, 5, 7] as const;
export type MatchPlayerCount = (typeof MATCH_PLAYER_COUNTS)[number];
export const normalizePlayerCount = (value: unknown): MatchPlayerCount =>
  MATCH_PLAYER_COUNTS.includes(value as MatchPlayerCount) ? (value as MatchPlayerCount) : 8;

function formation(name: string): Formation {
  const lines = name.split("-").map(Number);
  return {
    id: name,
    name,
    category: "常规",
    spots: [
      { nx: 50, ny: 6, role: "GK" },
      ...lines.flatMap((count, line) =>
        Array.from({ length: count }, (_, index) => ({
          nx: ((index + 1) * 100) / (count + 1),
          ny: 18 + (line * 26) / (lines.length - 1),
          role: line === 0 ? "DF" : line === lines.length - 1 ? "FW" : "MF",
        }))
      ),
    ],
  };
}

export const MATCH_FORMATIONS: Record<MatchPlayerCount, Formation[]> = {
  8: [...EIGHT_FORMATIONS, ...["3-1-3", "2-4-1", "4-2-1"].map(formation)],
  11: ["4-4-2", "4-3-3", "4-2-3-1", "3-5-2", "3-4-3", "4-5-1", "5-3-2", "5-4-1"].map(formation),
  9: ["3-3-2", "3-2-3", "2-4-2", "3-4-1", "2-3-3", "4-3-1", "2-3-2-1"].map(formation),
  7: ["2-3-1", "3-2-1", "2-2-2", "3-1-2", "1-3-2", "2-1-2-1"].map(formation),
  6: ["2-2-1", "1-3-1", "2-1-2", "1-2-2", "3-1-1"].map(formation),
  5: ["1-2-1", "2-2", "3-1", "1-3"].map(formation),
};

// 跨人数按 id 找模板（徽标/战术库展示用，同名取首个即可）。
export const findFormation = (id: string): Formation | undefined =>
  (Object.values(MATCH_FORMATIONS) as Formation[][]).flat().find((f) => f.id === id);
