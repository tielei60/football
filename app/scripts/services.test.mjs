import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { once } from "node:events";
import test from "node:test";

const exec = promisify(execFile);
const root = new URL("../../", import.meta.url);

test("Makefile manages both services, proxies the API and refuses an occupied port", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "football-make-"));
  const blocker = createServer();
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");
  const port = blocker.address().port;
  const frontendSocket = createServer();
  frontendSocket.listen(0, "127.0.0.1");
  await once(frontendSocket, "listening");
  const frontendPort = frontendSocket.address().port;
  await new Promise((resolve) => frontendSocket.close(resolve));
  const adminCredentials = { username: "testadmin", password: "test-password-123" };
  const publicOrigin = `http://127.0.0.1:${frontendPort}`;
  const env = {
    ...process.env,
    FOOTBALL_RUN_DIR: directory,
    FOOTBALL_DB_PATH: join(directory, "test.sqlite"),
    FOOTBALL_ADMIN_USERNAME: adminCredentials.username,
    FOOTBALL_ADMIN_PASSWORD: adminCredentials.password,
    FOOTBALL_PUBLIC_ORIGIN: publicOrigin,
  };
  async function authenticatedTactics(origin) {
    const login = await fetch(`${origin}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: publicOrigin },
      body: JSON.stringify(adminCredentials),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const response = await fetch(`${origin}/api/tactics`, { headers: { cookie } });
    assert.equal(response.status, 200);
    return response.json();
  }
  const make = (target, envOverrides = {}) =>
    exec("make", ["--no-print-directory", target, `BACKEND_PORT=${port}`, `FRONTEND_PORT=${frontendPort}`], {
      cwd: root,
      env: { ...env, ...envOverrides },
    });
  t.after(async () => {
    await make("stop").catch(() => {});
    if (blocker.listening) await new Promise((resolve) => blocker.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  assert.match((await make("status")).stdout, /后端：未运行/);
  await assert.rejects(make("start-backend"), /端口.*已被占用/);
  await new Promise((resolve) => blocker.close(resolve));
  assert.match((await make("start-backend", { LC_ALL: "zh_CN.UTF-8" })).stdout, /后端：已启动/);
  assert.deepEqual(await authenticatedTactics(`http://127.0.0.1:${port}`), []);
  assert.match((await make("status", { LC_ALL: "C" })).stdout, /后端：运行中/);
  assert.match((await make("start-backend", { LC_ALL: "C" })).stdout, /后端：已在运行/);
  assert.match((await make("restart-backend")).stdout, /后端：已启动/);
  assert.match((await make("logs-backend")).stdout, /Football server listening/);
  assert.match((await make("start")).stdout, /前端：已启动/);
  const frontend = `http://127.0.0.1:${frontendPort}`;
  assert.equal((await fetch(frontend)).status, 200);
  assert.deepEqual(await authenticatedTactics(frontend), []);
  assert.match((await make("status-frontend")).stdout, /前端：运行中/);
  assert.match((await make("stop-frontend")).stdout, /前端：已停止/);
  await assert.rejects(fetch(frontend));
  assert.match((await make("stop-backend")).stdout, /后端：已停止/);
  assert.match((await make("stop-backend")).stdout, /后端：未运行/);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/tactics`));
});
