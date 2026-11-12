import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm, open } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const app = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(process.env.FOOTBALL_RUN_DIR || resolve(app, ".run"));
const [action, target] = process.argv.slice(2);
const names = { frontend: "前端", backend: "后端" };
const ports = {
  frontend: Number(process.env.FRONTEND_PORT || 15173),
  backend: Number(process.env.BACKEND_PORT || 13001),
};
const statePath = (name) => resolve(directory, `${name}.json`);
const logPath = (name) => resolve(directory, `${name}.log`);

function identity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return "";
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "lstart=", "-o", "command="], {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
    }).trim();
  } catch {
    return "";
  }
}

async function state(name) {
  try {
    const value = JSON.parse(await readFile(statePath(name), "utf8"));
    return value.identity && identity(value.pid) === value.identity ? value : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function checkPort(port) {
  const socket = createServer();
  await new Promise((accept, reject) => {
    socket.once("error", () => reject(new Error(`端口 ${port} 已被占用或无法监听，请指定其他端口。`)));
    socket.listen(port, "127.0.0.1", accept);
  });
  await new Promise((accept) => socket.close(accept));
}

async function stop(name) {
  const saved = await state(name);
  if (!saved) {
    await rm(statePath(name), { force: true });
    console.log(`${names[name]}：未运行`);
    return;
  }
  // 独立进程组包含 Node watch 的子进程及 Vite 的辅助进程。
  try {
    process.kill(-saved.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  for (let attempt = 0; attempt < 50 && (await state(name)); attempt++) await delay(100);
  if (await state(name)) throw new Error(`${names[name]}停止超时，请查看日志；进程记录已保留。`);
  await rm(statePath(name), { force: true });
  console.log(`${names[name]}：已停止`);
}

async function start(name) {
  const saved = await state(name);
  if (saved) {
    console.log(`${names[name]}：已在运行（PID ${saved.pid}，端口 ${saved.port}）`);
    return;
  }
  const port = ports[name];
  await checkPort(port);
  const backend = await state("backend");
  const args =
    name === "backend"
      ? ["--watch", "../server/index.mjs"]
      : ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  const log = await open(logPath(name), "a");
  let child;
  try {
    child = spawn(process.execPath, args, {
      cwd: app,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        FOOTBALL_API_URL: `http://127.0.0.1:${backend?.port || ports.backend}`,
      },
    });
    await new Promise((accept, reject) => {
      child.once("spawn", accept);
      child.once("error", reject);
    });
  } finally {
    await log.close();
  }
  child.unref();
  const fingerprint = identity(child.pid);
  if (!fingerprint) throw new Error(`${names[name]}启动失败，请查看 ${logPath(name)}`);
  await writeFile(statePath(name), JSON.stringify({ pid: child.pid, identity: fingerprint, port }));
  for (let attempt = 0; attempt < 150; attempt++) {
    if (!(await state(name))) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/${name === "backend" ? "api/health" : ""}`, {
        signal: AbortSignal.timeout(1000),
      });
      await response.arrayBuffer();
      if (response.ok) {
        console.log(
          `${names[name]}：已启动（PID ${child.pid}）http://127.0.0.1:${port}${name === "frontend" ? "/board" : ""}`
        );
        return;
      }
    } catch {
      /* 等待服务开始监听。 */
    }
    await delay(200);
  }
  await stop(name);
  throw new Error(`${names[name]}启动失败或超时，请查看 ${logPath(name)}`);
}

async function run(name) {
  if (action === "start") await start(name);
  if (action === "stop") await stop(name);
  if (action === "restart") {
    await stop(name);
    await start(name);
  }
  if (action === "status") {
    const saved = await state(name);
    console.log(`${names[name]}：${saved ? `运行中（PID ${saved.pid}，端口 ${saved.port}）` : "未运行"}`);
  }
  if (action === "logs") {
    console.log(`=== ${names[name]}日志 ===`);
    try {
      console.log((await readFile(logPath(name), "utf8")).trimEnd().split("\n").slice(-50).join("\n"));
    } catch (error) {
      if (error.code === "ENOENT") console.log("暂无日志");
      else throw error;
    }
  }
}

let locked = false;
try {
  if (
    !["start", "stop", "restart", "status", "logs"].includes(action) ||
    !["all", ...Object.keys(names)].includes(target)
  )
    throw new Error("命令无效，请运行 make help。");
  if (Object.values(ports).some((port) => !Number.isInteger(port) || port < 1 || port > 65535))
    throw new Error("端口必须为 1 至 65535 的整数。");
  await mkdir(directory, { recursive: true });
  if (["start", "stop", "restart"].includes(action)) {
    try {
      await mkdir(resolve(directory, "lock"));
      locked = true;
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("另一条服务管理命令正在执行，请稍后重试。");
      throw error;
    }
  }
  const targets = target === "all" ? ["backend", "frontend"] : [target];
  if (target === "all" && ["stop", "restart"].includes(action)) {
    await stop("frontend");
    await stop("backend");
    if (action === "restart") {
      await start("backend");
      await start("frontend");
    }
  } else for (const name of targets) await run(name);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (locked) await rm(resolve(directory, "lock"), { recursive: true, force: true });
}
