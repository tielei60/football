import { test as clubTest, expect } from "./fixtures";
import { seedTacticalRoster } from "./tactical-roster.mjs";

// Opt-in only. Business/fresh-club tests continue importing fixtures.ts and begin with an empty club.
export const test = clubTest.extend<{ tacticalRoster: void }>({
  tacticalRoster: [
    async ({ isolatedDatabase, request }, use) => {
      // Declare the dependency so the isolated empty database reset always precedes seeding.
      expect(isolatedDatabase).toBeUndefined();
      const players = await seedTacticalRoster(request);
      expect(players).toHaveLength(20);
      expect(new Set(players.map((player: { id: string }) => player.id)).size).toBe(20);
      await use();
    },
    { auto: true },
  ],
});
export { expect };
export { authenticateAdmin } from "./fixtures";
