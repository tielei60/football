import { spawn } from "node:child_process";
import { removeTestDatabase, testDatabaseDirectory } from "./test-database.mjs";

const databasePath = process.env.FOOTBALL_E2E_DB_PATH;
testDatabaseDirectory(databasePath);
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", resolve);
        })
    )
  ).then(() => {
    removeTestDatabase(databasePath);
    process.exit(code);
  });
}

function start(args, environment) {
  const child = spawn(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, ...environment },
  });
  children.push(child);
  child.on("error", () => stop(1));
  child.on("exit", (code) => {
    if (!stopping) stop(code || 1);
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
start(["../server/index.mjs"], {
  PORT: "3003",
  FOOTBALL_DB_PATH: databasePath,
  FOOTBALL_ADMIN_USERNAME: "testadmin",
  FOOTBALL_ADMIN_PASSWORD: "test-password-123",
  FOOTBALL_PUBLIC_ORIGIN: "http://127.0.0.1:5175",
});
start(["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5175", "--strictPort"], {
  FOOTBALL_API_URL: "http://127.0.0.1:3003",
});
