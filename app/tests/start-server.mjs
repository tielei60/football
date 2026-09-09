import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "football-playwright-"));
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
    rmSync(directory, { recursive: true, force: true });
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
start(["../server/index.mjs"], { PORT: "3003", FOOTBALL_DB_PATH: join(directory, "test.sqlite") });
start(["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5175", "--strictPort"], {
  FOOTBALL_API_URL: "http://127.0.0.1:3003",
});
