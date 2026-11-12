import type { APIRequestContext } from "@playwright/test";

export const TACTICAL_TEST_PLAYERS: { name: string; number: number; positions: string[] }[];
export function seedTacticalRoster(
  request: APIRequestContext
): Promise<{ id: string; name: string; number: number; positions: string[] }[]>;
