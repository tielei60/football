import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFootballServer } from "./index.mjs";
import { createLocalPlayerAiProvider } from "./player-ai-local-provider.mjs";

test("server.drained在监听或未监听关闭后等待SQLite实际释放且只关闭一次", async () => {
  for (const listen of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), "server-drained-test-"));
    let closes = 0;
    const original = DatabaseSync.prototype.close;
    DatabaseSync.prototype.close = function (...args) {
      closes++;
      return original.apply(this, args);
    };
    let server;
    try {
      server = createFootballServer({
        databasePath: join(directory, "isolated.sqlite"),
        bootstrapAdmin: null,
        publicOrigin: "",
        trustedProxyAddresses: [],
        secureCookies: false,
        wechat: { enabled: false },
        aiPhotos: {
          enabled: true,
          provider: createLocalPlayerAiProvider(),
          policy: {
            mode: "local-simulation",
            currency: "XXX",
            amountMinor: 0,
            version: "drained-test",
            lifetimeMs: 60000,
          },
        },
      });
      if (listen) {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
      }
      const drained = server.drained;
      assert.ok(drained instanceof Promise);
      server.closeAllConnections();
      server.close(() => {});
      await drained;
      assert.equal(closes, 1);
      server.close(() => {});
      await drained;
      assert.equal(closes, 1);
    } finally {
      DatabaseSync.prototype.close = original;
      if (server?.listening) {
        server.closeAllConnections();
        server.close(() => {});
        await server.drained;
      }
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("关闭在途来源后drained才报告资源释放，迟到适配器结果不再访问库", async () => {
  const { request } = await import("node:http");
  const { randomUUID } = await import("node:crypto");
  const directory = await mkdtemp(join(tmpdir(), "server-drained-upload-"));
  const local = createLocalPlayerAiProvider();
  let release, started;
  const ready = new Promise((r) => (started = r));
  let closes = 0;
  const original = DatabaseSync.prototype.close;
  DatabaseSync.prototype.close = function (...args) {
    closes++;
    return original.apply(this, args);
  };
  let server;
  try {
    const account = {
      username: "fixture-drain",
      password: "fixture-drain-password",
    };
    server = createFootballServer({
      databasePath: join(directory, "isolated.sqlite"),
      bootstrapAdmin: account,
      publicOrigin: "",
      trustedProxyAddresses: [],
      secureCookies: false,
      wechat: { enabled: false },
      aiPhotos: {
        enabled: true,
        provider: {
          ...local,
          sample: () =>
            new Promise((resolve) => {
              release = resolve;
              started();
            }),
        },
        policy: {
          mode: "local-simulation",
          currency: "XXX",
          amountMinor: 0,
          version: "drain-test",
          lifetimeMs: 60000,
        },
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const post = (path, body, token) =>
      new Promise((resolve, reject) => {
        const req = request(
          `http://127.0.0.1:${server.address().port}/api${path}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Football-Client": "native-v1",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          },
          (res) => {
            let raw = "";
            res.on("data", (c) => (raw += c));
            res.on("end", () => resolve(JSON.parse(raw)));
          },
        );
        req.on("error", reject);
        req.end(JSON.stringify(body));
      });
    const token = (await post("/auth/native-login", account)).token;
    const player = await post(
      "/players",
      { name: "匿名关闭目标", number: null },
      token,
    );
    const consent = await post(
      `/players/${player.id}/ai/consents`,
      {
        requestId: randomUUID(),
        purpose: "private-ai-source",
        styleId: "source",
        maxAmountMinor: 0,
        policyVersion: "drain-test",
        confirmed: true,
      },
      token,
    );
    const pending = post(
      `/players/${player.id}/ai/sources`,
      {
        requestId: randomUUID(),
        consentId: consent.id,
        sampleId: "purple-square",
      },
      token,
    ).catch(() => null);
    await ready;
    server.closeAllConnections();
    server.close(() => {});
    await server.drained;
    assert.equal(closes, 1);
    release(await local.sample("purple-square"));
    await pending;
    await new Promise((r) => setImmediate(r));
    assert.equal(closes, 1);
  } finally {
    if (server?.listening) {
      server.closeAllConnections();
      server.close(() => {});
      await server.drained;
    }
    DatabaseSync.prototype.close = original;
    await rm(directory, { recursive: true, force: true });
  }
});
