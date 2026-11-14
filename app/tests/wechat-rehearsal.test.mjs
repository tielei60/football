import test from "node:test";
import { request } from "node:http";
const post = (url, body) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      { method: "POST", headers: { "Content-Type": "application/json", "X-Football-Client": "native-v1" } },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => resolve({ status: res.statusCode, json: async () => JSON.parse(raw) }));
      }
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
import assert from "node:assert/strict";
import { readFileSync, statSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { startWechatRehearsal, parseWechatRehearsalArguments } from "../../scripts/start-wechat-rehearsal.mjs";

test("微信演练拒绝生产路径、密钥与额外参数", async () => {
  assert.equal(parseWechatRehearsalArguments([]), "disabled");
  assert.equal(parseWechatRehearsalArguments(["enabled"]), "enabled");
  for (const args of [["--db", "production.sqlite"], ["enabled", "secret"], ["other"]])
    assert.throws(() => parseWechatRehearsalArguments(args));
  await assert.rejects(startWechatRehearsal({ databasePath: "production.sqlite" }));
});

test("默认关闭、新私有匿名库、密码登录及环境隔离", async (t) => {
  const names = [
    "FOOTBALL_DB_PATH",
    "FOOTBALL_ADMIN_USERNAME",
    "FOOTBALL_ADMIN_PASSWORD",
    "FOOTBALL_WECHAT_ENABLED",
    "FOOTBALL_WECHAT_APP_ID",
    "FOOTBALL_WECHAT_APP_SECRET",
    "FOOTBALL_PUBLIC_ORIGIN",
    "FOOTBALL_TRUSTED_PROXY_ADDRESSES",
  ];
  const old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) process.env[n] = "invalid-production-sentinel";
  t.after(() => {
    for (const n of names) old[n] === undefined ? delete process.env[n] : (process.env[n] = old[n]);
  });
  const r = await startWechatRehearsal();
  t.after(async () => {
    await r.close();
    rmSync(r.directory, { recursive: true, force: true });
  });
  const m = JSON.parse(readFileSync(r.manifestPath));
  assert.equal(statSync(r.directory).mode & 0o777, 0o700);
  assert.equal(statSync(r.manifestPath).mode & 0o777, 0o600);
  assert.equal(statSync(m.databasePath).mode & 0o777, 0o600);
  assert.equal(m.databasePath, join(r.directory, "anonymous.sqlite"));
  assert.equal(existsSync(join(r.directory, "no-static-files")), false);
  assert.equal(Object.keys(m.players).length, 4);
  const base = `http://127.0.0.1:${r.port}/api`;
  assert.deepEqual(await (await fetch(`${base}/auth/capabilities`)).json(), { wechat: false });
  const login = await post(`${base}/auth/native-login`, m.admin);
  assert.equal(login.status, 200);
});

test("启用演练也拒绝任意微信交换，独立库不复用", async (t) => {
  const a = await startWechatRehearsal("enabled"),
    b = await startWechatRehearsal("enabled");
  t.after(async () => {
    for (const r of [a, b]) {
      await r.close();
      await r.close();
      rmSync(r.directory, { recursive: true, force: true });
    }
  });
  assert.notEqual(a.directory, b.directory);
  assert.notEqual(a.port, b.port);
  const base = `http://127.0.0.1:${a.port}/api`;
  assert.deepEqual(await (await fetch(`${base}/auth/capabilities`)).json(), { wechat: true });
  const response = await post(`${base}/auth/wechat/login`, { code: "arbitrary-fictional-code" });
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.token, undefined);
  assert.ok(!JSON.stringify(result).includes("arbitrary-fictional-code"));
});

test("同步及异步监听失败均关闭已构造服务并清理新目录", async () => {
  const { Server } = await import("node:http");
  const { readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const list = () =>
    readdirSync(tmpdir())
      .filter((n) => n.startsWith("football-wechat-rehearsal-"))
      .sort();
  const before = list();
  const originalListen = Server.prototype.listen,
    originalClose = Server.prototype.close;
  for (const asynchronous of [false, true]) {
    let closes = 0;
    const failure = new Error("synthetic-listen-failure");
    Server.prototype.listen = function () {
      if (asynchronous) {
        queueMicrotask(() => this.emit("error", failure));
        return this;
      }
      throw failure;
    };
    Server.prototype.close = function (...args) {
      closes++;
      return originalClose.apply(this, args);
    };
    try {
      await assert.rejects(startWechatRehearsal(), (error) => error === failure);
      assert.equal(closes, 1);
      assert.deepEqual(list(), before);
    } finally {
      Server.prototype.listen = originalListen;
      Server.prototype.close = originalClose;
    }
  }
});

test("关闭回调错误不覆盖启动故障或跳过目录清理", async () => {
  const { Server } = await import("node:http");
  const { readdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const list = () =>
    readdirSync(tmpdir())
      .filter((n) => n.startsWith("football-wechat-rehearsal-"))
      .sort();
  const before = list(),
    originalListen = Server.prototype.listen,
    originalClose = Server.prototype.close;
  const failure = new Error("original-start-failure");
  Server.prototype.listen = function () {
    throw failure;
  };
  Server.prototype.close = function (callback) {
    return originalClose.call(this, () => callback(new Error("cleanup-failure")));
  };
  try {
    await assert.rejects(startWechatRehearsal(), (error) => error === failure);
    assert.deepEqual(list(), before);
  } finally {
    Server.prototype.listen = originalListen;
    Server.prototype.close = originalClose;
  }
});
