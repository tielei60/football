export interface Session {
  user: { id: number; username: string; role: "admin" | "player"; playerId: string | null; teamId: number };
  team: { id: number; name: string };
}
export interface ClubPlayer {
  id: string;
  name: string;
  number: number | null;
  positions: string[];
  preferredFoot: string;
  status: "active" | "inactive";
  note: string;
  avatar: string | null;
  hasAccount: boolean;
}
export interface Season {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
}
export interface Appearance {
  playerId: string;
  position: string;
  appeared: boolean | null;
  goals: number | null;
  assists: number | null;
}
export interface ClubMatch {
  id: number;
  opponent: string;
  date: string;
  kickoff: string;
  location: string;
  status: "draft" | "published" | "completed" | "cancelled";
  homeScore: number | null;
  awayScore: number | null;
  analysis: string;
  tacticIds: number[];
  rsvps: { playerId: string; response: "yes" | "no" | "maybe" }[];
  roster: Appearance[];
}
export interface Statistics {
  filter: { startDate: string; endDate: string; label: string };
  matches: number;
  players: {
    playerId: string;
    name: string;
    appearances: number;
    unknownAppearances: number;
    goals: number | null;
    assists: number | null;
    goalsKnownMatches: number;
    assistsKnownMatches: number;
  }[];
}
export class ClubApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}
export async function clubApi<T>(path: string, method = "GET", body: unknown = undefined): Promise<T> {
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
      if (response.status === 401 && path !== "/auth/login" && path !== "/auth/me") window.location.assign("/login");
      throw new ClubApiError(data?.message || "请求失败，请稍后重试", response.status);
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
