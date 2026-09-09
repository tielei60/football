import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL("../", import.meta.url));
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => child.kill("SIGTERM"));
  process.exitCode = code;
}
function launch(args, env = process.env) {
  const child = spawn(process.execPath, args, { cwd: directory, stdio: "inherit", env });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(code ?? 0));
}

const port = process.env.PORT || "13001";
launch(["--watch", "../server/index.mjs"]);
launch(["node_modules/vite/bin/vite.js", ...process.argv.slice(2)], {
  ...process.env,
  FOOTBALL_API_URL: process.env.FOOTBALL_API_URL || `http://127.0.0.1:${port}`,
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
