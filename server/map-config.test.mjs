import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { tencentMapConfig } from "./map-config.mjs";
import { createFootballServer } from "./index.mjs";

test("Tencent config is disabled by default and accepts only a browser key identifier", () => {
  assert.deepEqual(tencentMapConfig(), {
    provider: "tencent",
    enabled: false,
    key: null,
  });
  assert.deepEqual(tencentMapConfig("  TEST-TENCENT-BROWSER-KEY  "), {
    provider: "tencent",
    enabled: true,
    key: "TEST-TENCENT-BROWSER-KEY",
  });
  for (const invalid of [
    42,
    {},
    "tiny",
    "x".repeat(129),
    "https://other.invalid/a",
    "test-key?<secret>",
    "x".repeat(12) + "\nextra",
  ])
    assert.throws(
      () => tencentMapConfig(invalid),
      (error) => {
        assert.equal(error.message, "腾讯地图浏览器 Key 配置格式不正确。");
        return true;
      },
    );
});

for (const key of ["", "TEST-TENCENT-BROWSER-KEY"])
  test(`map configuration is admin-only, non-cacheable, and read-only (${key ? "configured" : "empty"})`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "football-map-config-"));
    const server = createFootballServer({
      databasePath: join(directory, "test.sqlite"),
      tencentMapKey: key,
      bootstrapAdmin: {
        username: "map-admin",
        password: "map-test-only-password",
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = (path, { cookie, method = "GET", data } = {}) =>
      fetch(base + path, {
        method,
        headers: {
          Origin: base,
          ...(cookie ? { Cookie: cookie } : {}),
          ...(data ? { "Content-Type": "application/json" } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
    assert.equal((await call("/api/maps/config")).status, 401);
    const login = await call("/api/auth/login", {
      method: "POST",
      data: { username: "map-admin", password: "map-test-only-password" },
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const result = await call("/api/maps/config", { cookie });
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.deepEqual(await result.json(), tencentMapConfig(key));
    assert.equal(
      (
        await call("/api/maps/config", {
          cookie,
          method: "PUT",
          data: { key: "replacement-test-key" },
        })
      ).status,
      404,
    );
    assert.deepEqual(
      await (await call("/api/maps/config", { cookie })).json(),
      tencentMapConfig(key),
    );
    const player = await (
      await call("/api/players", {
        cookie,
        method: "POST",
        data: { name: "虚构地图球员" },
      })
    ).json();
    assert.equal(
      (
        await call(`/api/players/${player.id}/account`, {
          cookie,
          method: "POST",
          data: { username: "map-player", password: "map-test-only-password" },
        })
      ).status,
      201,
    );
    const playerLogin = await call("/api/auth/login", {
      method: "POST",
      data: { username: "map-player", password: "map-test-only-password" },
    });
    assert.equal(playerLogin.status, 200);
    const playerCookie = playerLogin.headers.get("set-cookie").split(";")[0];
    assert.equal(
      (await call("/api/maps/config", { cookie: playerCookie })).status,
      403,
    );
    assert.equal(
      (await call("/api/venues", { cookie: playerCookie })).status,
      200,
    );
  });
