import { test as base, expect } from "@playwright/test";

export const test = base.extend<{ isolatedDatabase: void }>({
  isolatedDatabase: [
    async ({ request }, use) => {
      const tactics = await request.get("/api/tactics");
      expect(tactics.ok()).toBe(true);
      for (const tactic of await tactics.json()) {
        const deleted = await request.delete(`/api/tactics/${tactic.tacticId}`);
        expect(deleted.ok()).toBe(true);
      }
      const response = await request.get("/api/coaching-desk");
      expect(response.ok()).toBe(true);
      const { edition } = await response.json();
      const reset = await request.put("/api/coaching-desk", { data: { desk: null, edition } });
      expect(reset.ok()).toBe(true);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
