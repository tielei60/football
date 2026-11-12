import { defineConfig } from "@playwright/test";
import { createTestDatabase, testDatabaseDirectory } from "./tests/test-database.mjs";

// The runner creates the path once; its web server and workers inherit it.
if (!process.env.FOOTBALL_E2E_DB_PATH) process.env.FOOTBALL_E2E_DB_PATH = createTestDatabase();
testDatabaseDirectory(process.env.FOOTBALL_E2E_DB_PATH);

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5175",
    viewport: { width: 1440, height: 960 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  webServer: {
    command: "node tests/start-server.mjs",
    url: "http://127.0.0.1:5175/api/health",
    timeout: 180000,
    reuseExistingServer: false,
  },
});
