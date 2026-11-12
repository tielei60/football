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

const minimalTactic = {
  title: "Original",
  tags: [],
  favorite: false,
  formationName: null,
  board: {
    pieces: [],
    markings: [],
    trainingPlan: { instructions: "Preserve this exact content" },
  },
  thumbnail: null,
};

test("snapshot fields cannot be forged, failed associations roll back, and summaries omit contents", async (t) => {
  const f = await fixture(t),
    cookie = (await f.login()).cookie;
  const call = (path, method = "GET", body) =>
    f.call(path, method, body, cookie);
  const tactic = (await call("/api/tactics", "POST", { tactic: minimalTactic }))
    .body;
  const p = (await call("/api/players", "POST", { name: "Real", number: 7 }))
    .body;
  let m = (
    await call("/api/matches", "POST", {
      opponent: "Other",
      date: "2026-05-01",
      status: "completed",
      tacticIds: [tactic.tacticId],
      tacticSnapshots: [{ tactic: { title: "Forged" }, capturedAt: 1 }],
    })
  ).body;
  assert.equal(m.tacticSnapshots[0].tactic.title, "Original");
  assert.deepEqual(m.tacticSnapshots[0].tactic.board, minimalTactic.board);
  m = (
    await call(`/api/matches/${m.id}/roster`, "PUT", {
      revision: m.revision,
      roster: [
        {
          playerId: p.id,
          appeared: true,
          goals: null,
          playerSnapshot: { id: "forged", name: "Forged", number: 99 },
          snapshotCapturedAt: 1,
          snapshotSource: "migration",
        },
      ],
    })
  ).body;
  assert.equal(m.roster[0].playerSnapshot.name, "Real");
  assert.equal(m.roster[0].snapshotSource, "roster");
  assert.notEqual(m.roster[0].snapshotCapturedAt, 1);
  const before = structuredClone(m);
  assert.equal(
    (
      await call(`/api/matches/${m.id}`, "PUT", {
        revision: m.revision,
        location: "Must roll back",
        tacticIds: [99999999],
      })
    ).status,
    404,
  );
  assert.deepEqual((await call(`/api/matches/${m.id}`)).body, before);
  assert.equal(
    (
      await call(`/api/matches/${m.id}/roster`, "PUT", {
        revision: m.revision - 1,
        roster: [],
      })
    ).status,
    409,
  );
  assert.deepEqual((await call(`/api/matches/${m.id}`)).body, before);
  assert.equal(
    (await call(`/api/tactics/${tactic.tacticId}`, "DELETE")).status,
    204,
  );
  assert.deepEqual(
    (await call(`/api/matches/${m.id}`)).body.tacticSnapshots,
    before.tacticSnapshots,
  );
  const list = (await call("/api/matches")).body;
  assert.equal("tacticSnapshots" in list[0], false);
  assert.deepEqual(list[0].tacticIds, [tactic.tacticId]);
});

test("snapshot byte limit rolls back partial inserts and preserves match revision", async (t) => {
  const f = await fixture(t),
    cookie = (await f.login()).cookie;
  const m = (
    await f.call(
      "/api/matches",
      "POST",
      { opponent: "Bounded", date: "2026-05-01" },
      cookie,
    )
  ).body;
  const db = new DatabaseSync(f.databasePath);
  // Each source is legal under the existing 25 MiB request limit; their sum is not.
  const insert = db.prepare(
    "INSERT INTO tactics(title,tags,favorite,formation_name,board,thumbnail,created_at,saved_at) VALUES (?,'[]',0,NULL,?,?,1,1)",
  );
  const large = "x".repeat(17 * 1024 * 1024);
  const a = Number(
    insert.run("Large A", JSON.stringify(minimalTactic.board), large)
      .lastInsertRowid,
  );
  const b = Number(
    insert.run("Large B", JSON.stringify(minimalTactic.board), large)
      .lastInsertRowid,
  );
  const failed = await f.call(
    `/api/matches/${m.id}`,
    "PUT",
    { revision: m.revision, location: "Must not persist", tacticIds: [a, b] },
    cookie,
  );
  assert.equal(failed.status, 413);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) AS n FROM club_match_tactic_snapshots WHERE match_id=?",
      )
      .get(m.id).n,
    0,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) AS n FROM club_match_tactics WHERE match_id=?")
      .get(m.id).n,
    0,
  );
  db.close();
  assert.deepEqual(
    (await f.call(`/api/matches/${m.id}`, "GET", undefined, cookie)).body,
    m,
  );
});

test("season roster authorization and invalid members leave snapshots and revision unchanged", async (t) => {
  const f = await fixture(t),
    cookie = (await f.login()).cookie;
  const call = (path, method = "GET", body) =>
    f.call(path, method, body, cookie);
  const p = (await call("/api/players", "POST", { name: "Home", number: 3 }))
    .body;
  const s = (
    await call("/api/seasons", "POST", {
      name: "Season",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    })
  ).body;
  const first = (
    await call(`/api/seasons/${s.id}/roster`, "PUT", {
      revision: s.revision,
      roster: [
        { playerId: p.id, number: 14, name: "Forged", positions: ["Forged"] },
      ],
    })
  ).body;
  assert.equal(first.roster[0].name, "Home");
  assert.equal(first.roster[0].number, 14);
  const db = new DatabaseSync(f.databasePath);
  db.exec(
    "PRAGMA foreign_keys=ON; INSERT INTO club_teams(id,name) VALUES(2,'Other'); INSERT INTO club_players(id,team_id,name,positions) VALUES('foreign-player',2,'Foreign','[\"中场\"]')",
  );
  db.prepare(
    "INSERT INTO club_users(team_id,username,password_hash,role) SELECT 2,'other',password_hash,'admin' FROM club_users WHERE username='owner'",
  ).run();
  db.close();
  for (const roster of [
    [{ playerId: "foreign-player" }],
    [{ playerId: p.id }, { playerId: p.id }],
  ]) {
    assert.ok(
      [400, 404].includes(
        (
          await call(`/api/seasons/${s.id}/roster`, "PUT", {
            revision: first.season.revision,
            roster,
          })
        ).status,
      ),
    );
    assert.deepEqual((await call(`/api/seasons/${s.id}/roster`)).body, first);
  }
  assert.equal(
    (
      await call(`/api/seasons/${s.id}/roster`, "PUT", {
        revision: s.revision,
        roster: [],
      })
    ).status,
    409,
  );
  const other = (await f.login("other")).cookie;
  assert.equal(
    (await f.call(`/api/seasons/${s.id}/roster`, "GET", undefined, other))
      .status,
    404,
  );
  assert.equal(
    (
      await f.call(
        `/api/seasons/${s.id}/roster`,
        "PUT",
        { revision: first.season.revision, roster: [] },
        other,
      )
    ).status,
    404,
  );
  await call(`/api/players/${p.id}/account`, "POST", {
    username: "member",
    password: "member-password",
  });
  const member = (await f.login("member", "member-password")).cookie;
  assert.equal(
    (
      await f.call(
        `/api/seasons/${s.id}/roster`,
        "PUT",
        { revision: first.season.revision, roster: [] },
        member,
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.call(`/api/seasons/${s.id}/roster`, "GET", undefined, member))
      .status,
    200,
  );
  assert.deepEqual((await call(`/api/seasons/${s.id}/roster`)).body, first);
});

test("avatar changed values reject URL normalization and MIME bypasses without losing legacy values", async (t) => {
  const f = await fixture(t),
    cookie = (await f.login()).cookie;
  const call = (path, method = "GET", body) =>
    f.call(path, method, body, cookie);
  let p = (await call("/api/players", "POST", { name: "Avatar" })).body;
  const bad = [
    "//evil.example/a.png",
    "/\\evil.example/a.png",
    "/%2f%2fevil.example/a.png",
    "/%5cevil.example/a.png",
    "/avatars/a.svg",
    "/avatars/a.png?redirect=https://evil.example",
    "/avatars/a.png#x",
    "/avatars/../a.png",
    "/avatars/a%2epng",
    "/avatars/a.png\n",
    "https://evil.example/a.png",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "data:image/png;base64,PHN2Zz48L3N2Zz4=",
  ];
  for (const avatar of bad) {
    assert.equal(
      (
        await call(`/api/players/${p.id}`, "PUT", {
          revision: p.revision,
          avatar,
        })
      ).status,
      400,
      avatar,
    );
    assert.deepEqual((await call(`/api/players/${p.id}`)).body, p);
  }
  const board = { pieces: [], markings: [] };
  let desk = (
    await call("/api/coaching-desk", "PUT", {
      edition: 0,
      desk: {
        board,
        selectedTacticId: null,
        players: [
          {
            playerId: p.id,
            name: p.name,
            number: 0,
            positions: p.positions,
            preferredFoot: "",
            status: "ok",
            note: "",
            avatar: "/avatars/safe.png",
            fieldPieceId: null,
          },
        ],
      },
    })
  ).body;
  assert.equal(desk.desk.players[0].avatar, "/avatars/safe.png");
  for (const avatar of bad) {
    const forged = structuredClone(desk);
    forged.desk.players[0].avatar = avatar;
    assert.equal(
      (await call("/api/coaching-desk", "PUT", forged)).status,
      400,
      avatar,
    );
    assert.deepEqual((await call("/api/coaching-desk")).body, desk);
  }
  // Migration compatibility is exact-value preservation, not permission to add new unsafe URLs.
  const db = new DatabaseSync(f.databasePath);
  const legacy = "data:image/png;base64," + "A".repeat(3 * 1024 * 1024);
  db.prepare("UPDATE club_players SET avatar=? WHERE id=?").run(legacy, p.id);
  db.close();
  p = (await call(`/api/players/${p.id}`)).body;
  assert.equal(
    (await call(`/api/players/${p.id}`, "PUT", { ...p, status: "inactive" }))
      .status,
    200,
  );
  assert.equal((await call(`/api/players/${p.id}`)).body.avatar, legacy);
});
