import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { resetClubTestData } from "./test-database.mjs";

export async function authenticateAdmin(request: APIRequestContext, baseURL: string) {
  const response = await request.post(new URL("/api/auth/login", baseURL).href, {
    headers: { Origin: new URL(baseURL).origin },
    data: { username: "testadmin", password: "test-password-123" },
  });
  expect(response.ok()).toBe(true);
}

export const test = base.extend<{ isolatedDatabase: void }>({
  extraHTTPHeaders: async ({ baseURL }, use) => {
    await use({ Origin: new URL(baseURL!).origin });
  },
  request: async ({ context }, use) => {
    await use(context.request);
  },
  isolatedDatabase: [
    async ({ request, baseURL }, use, testInfo) => {
      if (testInfo.config.workers !== 1)
        throw new Error("Shared temporary database fixtures require exactly one worker.");
      resetClubTestData(process.env.FOOTBALL_E2E_DB_PATH);
      await authenticateAdmin(request, baseURL!);
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
