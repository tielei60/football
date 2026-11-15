import type { Tactic } from "./tacticLanguage";

export interface Team {
  id: number;
  name: string;
  crest: string | null;
  revision: number;
}
export interface Session {
  user: {
    id: number;
    username: string;
    role: "admin" | "player";
    playerId: string | null;
    teamId: number;
    systemAdmin?: boolean;
    mustChangePassword?: boolean;
    accountEnabled?: boolean;
    accountRevision?: number;
  };
  team: Team;
}
export interface ClubPlayer {
  revision: number;
  id: string;
  name: string;
  number: number | null;
  positions: string[];
  preferredFoot: string;
  status: "active" | "inactive";
  membershipConfirmed?: boolean;
  note: string;
  avatar: string | null;
  hasAccount: boolean;
}
export interface Season {
  revision: number;
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}
export interface SeasonRoster {
  season: Season;
  roster: { playerId: string; name: string; number: number | null; positions: string[] }[];
}
export interface Appearance {
  selection: "starter" | "bench" | "unknown";
  playerSnapshot?: { id: string; name: string; number: number | null; positions: string[] };
  snapshotCapturedAt?: number;
  snapshotSource?: "roster" | "migration";
  playerId: string;
  position: string;
  appeared: boolean | null;
  goals: number | null;
  assists: number | null;
}
export interface ClubMatch {
  revision: number;
  id: number;
  competition: string;
  format: 5 | 6 | 7 | 8 | 9 | 11 | null;
  side: "home" | "away" | "neutral" | "unknown";
  seasonId: number | null;
  opponent: string;
  date: string;
  kickoff: string;
  location: string;
  status: "draft" | "published" | "completed" | "cancelled";
  homeScore: number | null;
  awayScore: number | null;
  analysis: string;
  tacticIds: number[];
  tacticSnapshots: {
    sourceTacticId: number;
    tactic: Tactic;
    capturedAt: number;
    captureSource: "association" | "migration";
  }[];
  rsvps: { playerId: string; response: "yes" | "no" | "maybe" }[];
  roster: Appearance[];
}
export type ClubMatchSummary = Omit<ClubMatch, "tacticSnapshots">;
export interface TeamSummary {
  matches: number;
  scoredMatches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalsForKnownMatches: number;
  goalsAgainstKnownMatches: number;
}
export interface Statistics {
  team: TeamSummary & {
    attendance: { confirmedAppearances: number; unknownAppearances: number; matchesWithoutRoster: number };
  };
  registrationMatches: number;
  unassignedMatches: number;
  opponents: (TeamSummary & { opponent: string })[];

  filter: { startDate: string; endDate: string; label: string };
  matches: number;
  matchesWithoutRoster: number;
  players: {
    playerId: string;
    name: string;
    registration: { yes: number; no: number; maybe: number; unanswered: number };
    appearances: number;
    unknownAppearances: number;
    unrecordedMatches: number;
    goals: number | null;
    assists: number | null;
    goalsKnownMatches: number;
    assistsKnownMatches: number;
  }[];
}
export class ClubApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}
// 每次身份切换失效旧请求的认证副作用，不持久保存任何凭据。
let authEpoch = 0;
export const advanceAuthEpoch = () => ++authEpoch;
export const currentAuthEpoch = () => authEpoch;
export interface SystemAccount {
  id: number;
  username: string;
  role: "admin" | "player";
  playerId: string | null;
  systemAdmin: boolean;
  enabled: boolean;
  revision: number;
  passwordEnabled: boolean;
  mustChangePassword: boolean;
}
export async function clubApi<T>(path: string, method = "GET", body: unknown = undefined): Promise<T> {
  const epoch = authEpoch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      signal: controller.signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? undefined : await response.json();
    if (!response.ok) {
      if (epoch === authEpoch) {
        if (data?.code === "PASSWORD_CHANGE_REQUIRED") window.location.assign("/change-password");
        else if (response.status === 401 && path !== "/auth/login" && path !== "/auth/me")
          window.location.assign("/login");
      }
      throw new ClubApiError(data?.message || "请求失败，请稍后重试", response.status, data?.code);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ClubApiError) throw error;
    throw new Error(controller.signal.aborted ? "连接超时，请重试" : "无法连接服务，请检查网络后重试");
  } finally {
    clearTimeout(timeout);
  }
}
export const matchStatuses = { draft: "草稿", published: "已发布", completed: "已完赛", cancelled: "已取消" };
export const unknown = (value: number | null | undefined) => (value == null ? "未知" : value);
