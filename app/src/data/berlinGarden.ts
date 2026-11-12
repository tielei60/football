// Shared roster vocabulary. Keep seed identities and positions in sync with the
// Berlin Garden migrations in server/football-store.mjs.
export const PLAYER_POSITIONS = [
  "门将",
  "后卫",
  "中后卫",
  "边后卫",
  "后腰",
  "中场",
  "前腰",
  "边前卫",
  "左边前",
  "右边前",
  "中锋",
  "前锋",
  "待定",
] as const;
export type PlayerPosition = (typeof PLAYER_POSITIONS)[number];
export type PlayerStatus = "ok" | "injured" | "suspended";
export type PlayerRole = "GK" | "DF" | "MF" | "FW" | "待定";
export interface TeamPlayer {
  id: string;
  name: string;
  number: number | null;
  positions: PlayerPosition[];
  foot: string;
  status?: PlayerStatus;
  note: string;
  avatar?: string;
}
export const TEAM = { name: "柏林花园 FC", badge: "/team-badge.png", coach: "待设置" };
export const PLAYER_POSITION_OPTIONS = PLAYER_POSITIONS.map((value) => ({ value, label: value }));
export const ROLE_OPTIONS: { value: PlayerRole; label: string }[] = [
  { value: "GK", label: "门将" },
  { value: "DF", label: "后卫" },
  { value: "MF", label: "中场" },
  { value: "FW", label: "前锋" },
  { value: "待定", label: "待定" },
];
export const STATUS_META: Record<PlayerStatus, { label: string; color: string }> = {
  ok: { label: "健康", color: "#16A34A" },
  injured: { label: "受伤", color: "#DC2626" },
  suspended: { label: "停赛", color: "#F59E0B" },
};
export const statusLabel = (status?: PlayerStatus) => STATUS_META[status ?? "ok"]?.label ?? "健康";
const legacyPositions: Record<string, PlayerPosition> = {
  GK: "门将",
  DF: "后卫",
  MF: "中场",
  FW: "前锋",
  Goalkeeper: "门将",
  Defender: "后卫",
  Midfielder: "中场",
  Forward: "前锋",
};
export function normalizePlayerPositions(input: unknown): PlayerPosition[] {
  let values: unknown = input;
  if (typeof values === "string") {
    const text = values.trim();
    if (text.startsWith("[")) {
      try {
        values = JSON.parse(text);
      } catch {
        values = [];
      }
    } else values = text.split(/[、,，/]/);
  }
  if (!Array.isArray(values)) return ["待定"];
  const positions = [
    ...new Set(
      values.flatMap((value): PlayerPosition[] => {
        if (typeof value !== "string") return [];
        const position = legacyPositions[value.trim()] ?? value.trim();
        return PLAYER_POSITIONS.includes(position as PlayerPosition) ? [position as PlayerPosition] : [];
      })
    ),
  ];
  const known = positions.filter((position) => position !== "待定");
  return known.length ? known : ["待定"];
}
export function primaryRole(positions: readonly PlayerPosition[]): PlayerRole {
  const position = positions[0];
  if (position === "门将") return "GK";
  if (["后卫", "中后卫", "边后卫"].includes(position)) return "DF";
  if (["后腰", "中场", "前腰", "边前卫", "左边前", "右边前"].includes(position)) return "MF";
  if (["中锋", "前锋"].includes(position)) return "FW";
  return "待定";
}
const roleColors: Record<string, string> = {
  GK: "#F59E0B",
  DF: "#2495FF",
  MF: "#16A34A",
  FW: "#DC2626",
  待定: "#6D28D9",
};
export const posColor = (role?: string) => roleColors[role ?? "待定"] ?? roleColors.待定;
export const posLabel = (role?: string) =>
  ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role ?? "待定";

// No portraits ship with this repository. Never manufacture a photograph or
// request the historical /avatars/bg-*.jpg paths, which do not exist.
export const avatarPath = (_id: string): string | undefined => undefined;
const seeds: [string, PlayerPosition[]][] = [
  ["刘作涛", ["中后卫", "后腰"]],
  ["刘建宏", ["门将"]],
  ["史丙林", ["后腰"]],
  ["朱子言", ["中后卫"]],
  ["王伟", ["中锋"]],
  ["妥昰", ["前腰", "右边前"]],
  ["韩达", ["边前卫"]],
  ["余哲", ["边后卫", "边前卫"]],
  ["侯瑞", ["中锋"]],
  ["刘京", ["中锋", "边前卫"]],
  ["刘潜", ["右边前"]],
  ["吕晓露", ["左边前"]],
  ["高宁", ["后卫"]],
  ["张铁磊", ["后卫"]],
  ["栗可", ["后卫"]],
  ["陈成", ["后卫"]],
  ["周军", ["后腰"]],
  ["赵家骥", ["边前卫", "前腰"]],
  ["孙皓", ["后腰"]],
  ["刘刚", ["前腰"]],
];
export const BERLIN_GARDEN_PLAYERS: TeamPlayer[] = seeds.map(([name, positions], index) => ({
  id: `bg-${index + 1}`,
  name,
  number: index + 1,
  positions: [...positions],
  foot: "",
  status: "ok",
  note: "",
}));
interface RosterReference {
  rosterId?: string | null;
  text?: string;
  number?: number;
  team?: string;
}
export function resolveRosterPlayer<T extends TeamPlayer>(
  players: readonly T[],
  reference: RosterReference
): T | undefined {
  if (reference.team === "away") return undefined;
  // A stable ID is authoritative; never replace a deleted player's identity
  // with somebody who happens to share their old shirt number or name.
  if (reference.rosterId) return players.find((player) => player.id === reference.rosterId);
  const byName = reference.text ? players.filter((player) => player.name === reference.text) : [];
  if (byName.length === 1) return byName[0];
  const candidates = byName.length ? byName : players;
  const byNumber = candidates.filter((player) => player.number === reference.number);
  return byNumber.length === 1 ? byNumber[0] : undefined;
}
export function resolveAvatar(players: readonly TeamPlayer[], reference: RosterReference): string | undefined {
  const avatar = resolveRosterPlayer(players, reference)?.avatar;
  return avatar && !/^\/?avatars\/bg-\d+\.jpg(?:[?#].*)?$/.test(avatar) ? avatar : undefined;
}
const roleScores: Record<string, Partial<Record<PlayerPosition, number>>> = {
  GK: { 门将: 100 },
  DF: { 后卫: 100, 中后卫: 100, 边后卫: 95, 后腰: 40 },
  MF: { 后腰: 100, 中场: 100, 边前卫: 100, 边后卫: 90, 前腰: 85, 左边前: 80, 右边前: 80 },
  FW: { 中锋: 100, 前锋: 100, 前腰: 90, 左边前: 90, 右边前: 90, 边前卫: 70 },
};
export function assignPlayersToFormation<T extends TeamPlayer>(
  players: readonly T[],
  spots: readonly { role: string }[]
): T[] {
  const remaining = [...players];
  const assigned: T[] = [];
  for (const { role } of spots) {
    if (!remaining.length) break;
    const score = (player: T) => Math.max(0, ...player.positions.map((position) => roleScores[role]?.[position] ?? 0));
    let best = 0;
    for (let index = 1; index < remaining.length; index++) {
      if (score(remaining[index]) > score(remaining[best])) best = index;
    }
    assigned.push(remaining.splice(best, 1)[0]);
  }
  return assigned;
}
