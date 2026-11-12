import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createFootballServer } from "./index.mjs";

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "football-security-"));
  const databasePath = join(directory, "audit.sqlite");
  const server = createFootballServer({
    databasePath,
    bootstrapAdmin: { username: "owner", password: "owner-password-123" },
    ...options,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  async function call(path, method = "GET", body, cookie, headers = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      body: response.status === 204 ? null : await response.json(),
    };
  }
  async function login(
    username = "owner",
    password = "owner-password-123",
    headers = {},
  ) {
    return call(
      "/api/auth/login",
      "POST",
      { username, password },
      undefined,
      headers,
    );
  }
  async function pending(path, body, cookie) {
    const serialized = JSON.stringify(body);
    let finish;
    const result = new Promise((resolve, reject) => {
      const request = httpRequest(
        base + path,
        {
          method: "PUT",
          headers: {
            Origin: base,
            Cookie: cookie,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(serialized),
          },
        },
        (response) => {
          response.resume();
          response.on("end", () => resolve(response.statusCode));
        },
      );
      request.on("error", reject);
      request.write(serialized.slice(0, 1));
      finish = () => request.end(serialized.slice(1));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { finish, result };
  }
  return { call, login, pending, databasePath };
}

test("slow writes cannot survive password reset, archive, logout, or role revocation", async (t) => {
  const f = await fixture(t),
    admin = (await f.login()).cookie;
  const p = (await f.call("/api/players", "POST", { name: "Player" }, admin))
    .body;
  await f.call(
    `/api/players/${p.id}/account`,
    "POST",
    { username: "player", password: "original-password" },
    admin,
  );
  const player = (await f.login("player", "original-password")).cookie;
  const change = await f.pending(
    "/api/auth/password",
    { currentPassword: "original-password", newPassword: "attacker-password" },
    player,
  );
  assert.equal(
    (
      await f.call(
        `/api/players/${p.id}/password`,
        "PUT",
        { newPassword: "reset-safe-password" },
        admin,
      )
    ).status,
    204,
  );
  change.finish();
  assert.equal(await change.result, 401);
  assert.equal((await f.login("player", "attacker-password")).status, 401);
  const current = (await f.login("player", "reset-safe-password")).cookie;
  const m = (
    await f.call(
      "/api/matches",
      "POST",
      { opponent: "Other", date: "2026-11-12", status: "published" },
      admin,
    )
  ).body;
  const rsvp = await f.pending(
    `/api/matches/${m.id}/rsvp`,
    { response: "yes" },
    current,
  );
  const latest = (await f.call(`/api/players/${p.id}`, "GET", undefined, admin))
    .body;
  assert.equal(
    (
      await f.call(
        `/api/players/${p.id}`,
        "PUT",
        { ...latest, status: "inactive" },
        admin,
      )
    ).status,
    200,
  );
  rsvp.finish();
  assert.equal(await rsvp.result, 401);
  assert.deepEqual(
    (await f.call(`/api/matches/${m.id}`, "GET", undefined, admin)).body.rsvps,
    [],
  );
  const loggedOut = await f.pending(
    "/api/auth/password",
    { currentPassword: "owner-password-123", newPassword: "should-not-work" },
    admin,
  );
  await f.call("/api/auth/logout", "POST", {}, admin);
  loggedOut.finish();
  assert.equal(await loggedOut.result, 401);
  const nextAdmin = (await f.login()).cookie;
  const adminPlayer = (
    await f.call("/api/players", "POST", { name: "Admin player" }, nextAdmin)
  ).body;
  const modify = await f.pending(
    `/api/matches/${m.id}`,
    { ...m, location: "Unauthorized" },
    nextAdmin,
  );
  const db = new DatabaseSync(f.databasePath);
  db.prepare(
    "UPDATE club_users SET role='player',player_id=? WHERE username='owner'",
  ).run(adminPlayer.id);
  db.prepare("UPDATE club_players SET status='active' WHERE id=?").run(p.id);
  db.close();
  modify.finish();
  assert.equal(await modify.result, 403);
});

test("untrusted forwarded headers cannot bypass a client's login limit", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 30; i++)
    assert.equal(
      (
        await f.login("owner", "wrong", {
          "X-Forwarded-For": `192.0.2.${i + 1}`,
        })
      ).status,
      401,
    );
  assert.equal(
    (
      await f.login("owner", "owner-password-123", {
        "X-Forwarded-For": "198.51.100.1",
      })
    ).status,
    429,
  );
});

test("trusted proxy isolates client IPs and one username cannot lock all users", async (t) => {
  const f = await fixture(t, { trustedProxyAddresses: ["127.0.0.1"] });
  for (let i = 0; i < 30; i++)
    assert.equal(
      (await f.login("owner", "wrong", { "X-Forwarded-For": "192.0.2.1" }))
        .status,
      401,
    );
  assert.equal(
    (
      await f.login("owner", "owner-password-123", {
        "X-Forwarded-For": "192.0.2.1",
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await f.login("owner", "owner-password-123", {
        "X-Forwarded-For": "192.0.2.2",
      })
    ).status,
    200,
  );
  for (let i = 0; i < 30; i++)
    assert.equal(
      (await f.login("missing", "wrong", { "X-Forwarded-For": "192.0.2.3" }))
        .status,
      401,
    );
  assert.equal(
    (
      await f.login("owner", "owner-password-123", {
        "X-Forwarded-For": "192.0.2.3",
      })
    ).status,
    200,
  );
});

test("malformed forwarded chains are ignored even from a trusted proxy", async (t) => {
  const f = await fixture(t, { trustedProxyAddresses: ["127.0.0.1"] });
  for (let i = 0; i < 30; i++) {
    assert.equal(
      (
        await f.login("owner", "wrong", {
          "X-Forwarded-For": `192.0.2.${i + 1}, 198.51.100.1`,
        })
      ).status,
      401,
    );
  }
  assert.equal(
    (
      await f.login("owner", "owner-password-123", {
        "X-Forwarded-For": "invalid",
      })
    ).status,
    429,
  );
  assert.equal(
    (
      await f.login("owner", "owner-password-123", {
        "X-Forwarded-For": "192.0.2.99",
      })
    ).status,
    200,
  );
});
