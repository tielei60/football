import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { createFootballServer } from "./index.mjs";
const sample = () => ({
  title: "模拟战术",
  tags: ["测试"],
  favorite: false,
  formationName: "3-3-1",
  thumbnail: null,
  board: {
    pieces: [
      {
        pieceId: "p",
        kind: "player",
        x: 200,
        y: 300,
        color: "#8845a0",
        customRole: { hint: "preserve" },
      },
      { pieceId: "b", kind: "ball", x: 600, y: 400 },
    ],
    markings: [
      {
        markingId: "l",
        kind: "line",
        startX: 20,
        startY: 30,
        endX: 40,
        endY: 50,
        customLine: "keep",
      },
    ],
    trainingPlan: {
      objective: "压迫",
      instructions: "保留说明",
      durationMinutes: 15,
    },
    extraBoard: { version: 7 },
    demonstration: {
      demonstrationId: "d",
      title: "演示",
      participants: [{ pieceId: "p", kind: "player", x: 200, y: 300 }],
      stages: [
        { stageNumber: 0, positions: [{ pieceId: "p", x: 200, y: 300 }] },
      ],
      runs: [],
    },
  },
});
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "football-commands-"));
  const server = createFootballServer({
    databasePath: join(dir, "test.sqlite"),
    bootstrapAdmin: { username: "owner", password: "owner-password-123" },
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  });
  let cookie;
  const call = async (path, method = "GET", body, credential = cookie) => {
    const r = await fetch(base + "/api" + path, {
      method,
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(credential ? { Cookie: credential } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      body: r.status === 204 ? null : await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  };
  cookie = (
    await call("/auth/login", "POST", {
      username: "owner",
      password: "owner-password-123",
    })
  ).cookie;
  const saved = await call("/tactics", "POST", {
    tactic: sample(),
    note: "初始",
  });
  assert.equal(saved.status, 201);
  return {
    call,
    id: saved.body.tacticId,
    databasePath: join(dir, "test.sqlite"),
  };
}
test("command batch changes ball, players and markings while preserving extensions and animation", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`,
    before = (await f.call(path)).body;
  const commands = [
    { type: "move-piece", pieceId: "b", x: 700, y: 450 },
    { type: "move-piece", pieceId: "p", x: 300, y: 350 },
    {
      type: "update-marking",
      markingId: "l",
      patch: { strokeColor: "#8845a0", width: 3 },
    },
    {
      type: "add-marking",
      marking: {
        markingId: "native-new",
        kind: "arrow",
        startX: 10,
        startY: 20,
        endX: 50,
        endY: 60,
        width: 2,
        dashed: true,
      },
    },
    {
      type: "add-marking",
      marking: {
        markingId: 88,
        kind: "text",
        startX: 1,
        startY: 2,
        endX: 1,
        endY: 2,
        label: "压迫",
      },
    },
    { type: "delete-marking", markingId: 88 },
  ];
  const r = await f.call(path, "PUT", { version: before.version, commands });
  assert.equal(r.status, 200);
  assert.equal(r.body.tactic.board.pieces[1].x, 700);
  assert.equal(r.body.tactic.board.pieces[0].x, 300);
  assert.equal(r.body.tactic.board.markings[0].customLine, "keep");
  assert.equal(r.body.tactic.board.markings.length, 2);
  assert.deepEqual(
    r.body.tactic.board.demonstration,
    before.tactic.board.demonstration,
  );
  assert.deepEqual(
    r.body.tactic.board.trainingPlan,
    before.tactic.board.trainingPlan,
  );
  assert.deepEqual(
    r.body.tactic.board.extraBoard,
    before.tactic.board.extraBoard,
  );
  assert.deepEqual(
    r.body.tactic.board.pieces[0].customRole,
    before.tactic.board.pieces[0].customRole,
  );
  assert.equal(r.body.tactic.thumbnail, null);
  assert.equal(r.body.tactic.board.formationCustomized, true);
  assert.equal((await f.call(`/tactics/${f.id}/versions`)).body.length, 2);
  assert.equal(
    (await f.call(path, "PUT", { version: before.version, commands })).status,
    409,
  );
  assert.equal((await f.call(`/tactics/${f.id}/versions`)).body.length, 2);
});
test("invalid late command rolls entire batch back; strict command and shape validation", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`,
    before = (await f.call(path)).body;
  const add = {
    type: "add-marking",
    marking: {
      markingId: "new",
      kind: "line",
      startX: 1,
      startY: 2,
      endX: 10,
      endY: 20,
    },
  };
  const invalid = [
    { type: "unknown" },
    { type: "move-piece", pieceId: "b", x: 1251, y: 2 },
    { type: "move-piece", pieceId: "b", x: 1, y: 2, team: "away" },
    { type: "delete-marking", markingId: "missing" },
    { type: "add-marking", marking: { ...add.marking, markingId: "l" } },
    { type: "add-marking", marking: { ...add.marking, kind: "script" } },
    {
      type: "update-marking",
      markingId: "l",
      patch: { markingId: "overwrite" },
    },
    {
      type: "update-marking",
      markingId: "l",
      patch: { strokeColor: "url(https://evil.example)" },
    },
    { type: "update-marking", markingId: "l", patch: { width: 0 } },
    {
      type: "add-marking",
      marking: {
        ...add.marking,
        kind: "pen",
        path: [
          [1, 2],
          [4, 900],
        ],
      },
    },
    {
      type: "add-marking",
      marking: { ...add.marking, kind: "text", label: "" },
    },
  ];
  for (const bad of invalid) {
    const r = await f.call(path, "PUT", {
      version: before.version,
      commands: [{ type: "move-piece", pieceId: "p", x: 5, y: 6 }, bad],
    });
    assert.equal(r.status, 400);
    assert.equal((await f.call(path)).body.version, before.version);
  }
  assert.equal((await f.call(path, "PUT", { commands: [add] })).status, 428);
  assert.equal(
    (
      await f.call(path, "PUT", {
        version: before.version,
        commands: Array(101).fill(add),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call(path, "PUT", {
        version: before.version,
        commands: [add],
        requestId: "unsupported",
      })
    ).status,
    400,
  );
  assert.equal((await f.call(`/tactics/${f.id}/versions`)).body.length, 1);
});
test("removed target with old version reports conflict rather than invalid operation", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`,
    before = (await f.call(path)).body;
  assert.equal(
    (
      await f.call(path, "PUT", {
        version: before.version,
        commands: [{ type: "delete-marking", markingId: "l" }],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(path, "PUT", {
        version: before.version,
        commands: [
          { type: "update-marking", markingId: "l", patch: { width: 2 } },
        ],
      })
    ).status,
    409,
  );
  const current = (await f.call(path)).body;
  assert.equal(
    (
      await f.call(path, "PUT", {
        version: current.version,
        commands: [
          {
            type: "add-marking",
            marking: {
              markingId: "wide",
              kind: "line",
              startX: 0,
              startY: 0,
              endX: 5,
              endY: 5,
              width: 51,
            },
          },
        ],
      })
    ).status,
    400,
  );
});

test("commands enforce member read-only and preserve historical match snapshot", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`;
  const p = (await f.call("/players", "POST", { name: "模拟队员" })).body;
  await f.call(`/players/${p.id}/account`, "POST", {
    username: "member",
    password: "member-password-123",
  });
  const member = (
    await f.call("/auth/login", "POST", {
      username: "member",
      password: "member-password-123",
    })
  ).cookie;
  const match = (
    await f.call("/matches", "POST", {
      opponent: "模拟对手",
      date: "2026-11-13",
      status: "published",
      tacticIds: [f.id],
    })
  ).body;
  const before = (await f.call(path)).body;
  const body = {
    version: before.version,
    commands: [{ type: "delete-marking", markingId: "l" }],
  };
  assert.equal((await f.call(path, "GET", undefined, member)).status, 200);
  assert.equal((await f.call(path, "PUT", body, member)).status, 403);
  assert.equal((await f.call(path, "PUT", body)).status, 200);
  assert.equal(
    (await f.call(`/matches/${match.id}`)).body.tacticSnapshots[0].tactic.board
      .markings.length,
    1,
  );
  const now = (await f.call(path)).body;
  await f.call(`/tactics/${f.id}`, "PUT", {
    tactic: { ...now.tactic, title: "网页修改" },
    note: "web",
  });
  assert.equal(
    (
      await f.call(path, "PUT", {
        version: now.version,
        commands: [{ type: "move-piece", pieceId: "b", x: 20, y: 30 }],
      })
    ).status,
    409,
  );
});

test("composition edits preserve extensions, remap edges and commit one atomic version", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`;
  let current = (await f.call(path)).body;
  const original = current.tactic;
  original.board.demonstration.customDemo = { keep: 1 };
  original.board.demonstration.stages[0].customStage = "keep";
  original.board.demonstration.stages[0].positions[0].customPosition = "keep";
  await f.call(`/tactics/${f.id}`, "PUT", { tactic: original });
  current = (await f.call(path)).body;
  const result = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      {
        type: "update-piece",
        pieceId: "p",
        patch: { label: "前锋", shirtNumber: 0, position: "FW" },
      },
      {
        type: "update-participant",
        pieceId: "p",
        patch: { label: "跑位", shirtNumber: null },
      },
      {
        type: "add-stage",
        afterStage: 0,
        stage: { title: "冲刺", durationSeconds: 0.5 },
      },
      {
        type: "move-participant",
        stageNumber: 1,
        pieceId: "p",
        x: 900,
        y: 600,
      },
      { type: "set-run", fromStage: 0, pieceId: "p", bend: { x: 500, y: 200 } },
      { type: "add-stage", afterStage: 1, stage: { durationSeconds: 30 } },
      { type: "set-run", fromStage: 1, pieceId: "p", bend: { x: 800, y: 500 } },
      { type: "update-stage", stageNumber: 2, patch: { note: "收尾" } },
    ],
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const b = result.body.tactic.board,
    d = b.demonstration;
  assert.equal(b.pieces[0].label, "前锋");
  assert.equal(b.pieces[0].shirtNumber, 0);
  assert.equal(d.participants[0].label, "跑位");
  assert.equal(d.participants[0].shirtNumber, undefined);
  assert.deepEqual(d.customDemo, { keep: 1 });
  assert.equal(d.stages[1].customStage, "keep");
  assert.equal(d.stages[1].positions[0].customPosition, "keep");
  assert.equal(d.stages[1].positions[0].x, 900);
  assert.equal(b.pieces[0].x, 200);
  assert.equal(d.runs.length, 2);
  assert.deepEqual(
    d.stages.map((s) => s.stageNumber),
    [0, 1, 2],
  );
  let r = await f.call(path, "PUT", {
    version: result.body.version,
    commands: [{ type: "add-stage", afterStage: 0 }],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.tactic.board.demonstration.runs.map((x) => x.fromStage),
    [2],
  );
  r = await f.call(path, "PUT", {
    version: r.body.version,
    commands: [{ type: "delete-stage", stageNumber: 1 }],
  });
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.tactic.board.demonstration.runs.map((x) => x.fromStage),
    [1],
  );
  r = await f.call(path, "PUT", {
    version: r.body.version,
    commands: [{ type: "set-run", fromStage: 1, pieceId: "p", bend: null }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.tactic.board.demonstration.runs.length, 0);
});

test("composition rejects invalid fields and rolls back a valid earlier command", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`,
    current = (await f.call(path)).body;
  const invalid = [
    { type: "update-piece", pieceId: "p", patch: { playerId: "other" } },
    { type: "update-piece", pieceId: "p", patch: { shirtNumber: -1 } },
    { type: "update-piece", pieceId: "b", patch: { label: "ball" } },
    { type: "update-piece", pieceId: "p", patch: { radius: 101 } },
    { type: "update-piece", pieceId: "p", patch: { label: "a".repeat(101) } },
    { type: "update-participant", pieceId: "missing", patch: { label: "x" } },
    { type: "delete-stage", stageNumber: 0 },
    { type: "add-stage", afterStage: -1 },
    { type: "update-stage", stageNumber: 0, patch: { positions: [] } },
    { type: "update-stage", stageNumber: 0, patch: { durationSeconds: 31 } },
    { type: "move-participant", stageNumber: 0, pieceId: "b", x: 1, y: 1 },
    { type: "move-participant", stageNumber: 0, pieceId: "p", x: 1251, y: 1 },
    { type: "set-run", fromStage: 0, pieceId: "p", bend: { x: 1, y: 1 } },
    { type: "init-demonstration", demonstrationId: "new" },
  ];
  for (const command of invalid) {
    const r = await f.call(path, "PUT", {
      version: current.version,
      commands: [
        { type: "update-piece", pieceId: "p", patch: { label: "not saved" } },
        command,
      ],
    });
    assert.equal(r.status, 400, JSON.stringify(command));
    assert.deepEqual((await f.call(path)).body, current);
  }
  const r = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      { type: "add-stage", afterStage: 0 },
      {
        type: "set-run",
        fromStage: 0,
        pieceId: "p",
        bend: { x: 1, y: 1, extra: 1 },
      },
    ],
  });
  assert.equal(r.status, 400);
  assert.deepEqual((await f.call(path)).body, current);
});

test("initialize canonical demonstration without overwriting one and enforce web stage limit", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`;
  const tactic = (await f.call(path)).body.tactic;
  delete tactic.board.demonstration;
  await f.call(`/tactics/${f.id}`, "PUT", { tactic });
  let current = (await f.call(path)).body;
  let r = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      {
        type: "init-demonstration",
        demonstrationId: "native-demo",
        title: "演练",
      },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body.tactic.board.demonstration;
  assert.deepEqual(
    d.participants.map((p) => p.pieceId),
    ["p", "b"],
  );
  assert.equal(d.stages[0].durationSeconds, 3);
  assert.equal(d.stages[0].positions.length, 2);
  assert.deepEqual(d.participants[0].customRole, { hint: "preserve" });
  let next = r.body.tactic;
  next.board.demonstration.stages = Array.from({ length: 120 }, (_, i) => ({
    ...structuredClone(d.stages[0]),
    stageNumber: i,
  }));
  await f.call(`/tactics/${f.id}`, "PUT", { tactic: next });
  current = (await f.call(path)).body;
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [{ type: "add-stage", afterStage: 119 }],
  });
  assert.equal(r.status, 400);
  assert.deepEqual((await f.call(path)).body, current);
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [{ type: "delete-stage", stageNumber: 119 }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.tactic.board.demonstration.stages.length, 119);
  assert.equal(
    (
      await f.call(path, "PUT", {
        version: current.version,
        commands: [{ type: "delete-stage", stageNumber: 119 }],
      })
    ).status,
    409,
  );
});

test("composition allows explicit property synchronization and rejects malformed legacy stage numbering", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`;
  let current = (await f.call(path)).body;
  let r = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      {
        type: "update-piece",
        pieceId: "p",
        patch: { label: "同步", shirtNumber: 9 },
      },
      {
        type: "update-participant",
        pieceId: "p",
        patch: { label: "同步", shirtNumber: 9 },
      },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(
    r.body.tactic.board.pieces[0].label,
    r.body.tactic.board.demonstration.participants[0].label,
  );
  let tactic = r.body.tactic;
  tactic.board.demonstration.stages[0].stageNumber = 7;
  assert.equal(
    (await f.call(`/tactics/${f.id}`, "PUT", { tactic })).status,
    200,
  );
  current = (await f.call(path)).body;
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      { type: "update-stage", stageNumber: 0, patch: { title: "bad" } },
    ],
  });
  assert.equal(r.status, 400);
  assert.deepEqual((await f.call(path)).body, current);
  // Legacy data remains editable through unrelated commands without being normalized.
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      { type: "update-piece", pieceId: "p", patch: { label: "局部" } },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.tactic.board.demonstration.stages[0].stageNumber, 7);
});

test("formation catalog exactly matches Web sources without runtime Web dependency", async () => {
  const { readFile } = await import("node:fs/promises");
  const { stripTypeScriptTypes } = await import("node:module");
  const { runInNewContext } = await import("node:vm");
  const base = new URL("../app/src/data/", import.meta.url);
  const source =
    (await readFile(new URL("eightFormations.ts", base), "utf8")) +
    "\n" +
    (await readFile(new URL("matchFormats.ts", base), "utf8")).replace(
      /^import .*\n/,
      "",
    );
  const script = stripTypeScriptTypes(source.replace(/export /g, ""));
  const expected = runInNewContext(
    script +
      ";Object.entries(MATCH_FORMATIONS).flatMap(([playerCount,list])=>list.map(f=>({...f,playerCount:Number(playerCount),spots:f.spots.map(s=>({x:toSvgX(s.ny),y:toSvgY(s.nx),role:s.role}))})))",
  );
  const actual = JSON.parse(
    await readFile(
      new URL("./native-formations.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)));
});

test("setup commands apply all formations both sides and preserve animation", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`;
  let current = (await f.call(path)).body;
  const animation = structuredClone(current.tactic.board.demonstration);
  for (const formation of current.formations) {
    const commands = [];
    for (const team of ["home", "away"]) {
      const old = current.tactic.board.pieces.filter(
        (p) =>
          (p.kind || "player") === "player" &&
          (p.team === "away" ? "away" : "home") === team,
      );
      const ids = formation.spots.map(
        (_, i) => `${team}-${formation.playerCount}-${formation.id}-${i}`,
      );
      commands.push(
        ...old.map((p) => ({
          type: "remove-player",
          pieceId: p.pieceId,
          acknowledgeAnimation: true,
        })),
        ...ids.map((pieceId) => ({
          type: "add-player",
          pieceId,
          team,
          x: 100,
          y: 100,
        })),
        {
          type: "apply-formation",
          team,
          playerCount: formation.playerCount,
          formationId: formation.id,
          pieceIds: ids,
        },
      );
    }
    const r = await f.call(path, "PUT", { version: current.version, commands });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    current = (await f.call(path)).body;
    for (const team of ["home", "away"]) {
      const side = current.tactic.board.pieces.filter((p) => p.team === team);
      assert.equal(side.length, formation.playerCount);
      side.forEach((p, i) => {
        assert.equal(
          p.x,
          team === "away" ? 1251 - formation.spots[i].x : formation.spots[i].x,
        );
        assert.equal(p.y, formation.spots[i].y);
        assert.equal(p.position, formation.spots[i].role);
        assert.ok(p.x >= 0 && p.x <= 1250 && p.y >= 0 && p.y <= 826);
      });
    }
    assert.equal(current.tactic.board.playerCount, formation.playerCount);
    assert.equal(current.tactic.board.formationId, formation.id);
    assert.equal(current.tactic.board.awayFormationId, formation.id);
    assert.equal(current.tactic.formationName, formation.id);
    assert.deepEqual(current.tactic.board.demonstration, animation);
    assert.equal(current.tactic.board.markings[0].customLine, "keep");
    assert.deepEqual(current.tactic.board.extraBoard, { version: 7 });
  }
});

test("setup guards animation identities, metadata, roster identity and atomicity", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`;
  let current = (await f.call(path)).body;
  let r = await f.call(path, "PUT", {
    version: current.version,
    commands: [{ type: "remove-player", pieceId: "p" }],
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "ANIMATION_IDENTITY_CONFIRMATION_REQUIRED");
  const invalid = [
    { type: "add-player", pieceId: "p", team: "home", x: 1, y: 1 },
    { type: "remove-player", pieceId: "b" },
    {
      type: "add-player",
      pieceId: "new",
      team: "away",
      x: 1,
      y: 1,
      playerId: "forged",
    },
    { type: "update-metadata", patch: { title: " " } },
    { type: "update-metadata", patch: { favorite: "yes" } },
    { type: "update-metadata", patch: { board: {} } },
    {
      type: "apply-formation",
      team: "home",
      playerCount: 5,
      formationId: "4-4-2",
      pieceIds: ["p"],
    },
  ];
  for (const c of invalid) {
    r = await f.call(path, "PUT", {
      version: current.version,
      commands: [{ type: "update-metadata", patch: { title: "not saved" } }, c],
    });
    assert.equal(r.status, 400, JSON.stringify(c));
    assert.deepEqual((await f.call(path)).body, current);
  }
  const p = (
    await f.call("/players", "POST", {
      name: "真实球员",
      number: 12,
      positions: ["前锋"],
    })
  ).body;
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      {
        type: "add-player",
        pieceId: "real-player",
        team: "home",
        x: 100,
        y: 200,
        playerId: p.id,
      },
      {
        type: "update-metadata",
        patch: { title: " 新标题 ", tags: ["联赛"], favorite: true },
      },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tactic.title, "新标题");
  const piece = r.body.tactic.board.pieces.find(
    (p) => p.pieceId === "real-player",
  );
  assert.equal(piece.label, "真实球员");
  assert.equal(piece.shirtNumber, 12);
  assert.equal(piece.playerId, p.id);
  current = (await f.call(path)).body;
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      {
        type: "add-player",
        pieceId: "duplicate",
        team: "home",
        x: 1,
        y: 1,
        playerId: p.id,
      },
    ],
  });
  assert.equal(r.status, 400);
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      { type: "remove-player", pieceId: "p", acknowledgeAnimation: true },
      { type: "add-player", pieceId: "p", team: "home", x: 1, y: 1 },
    ],
  });
  assert.equal(r.status, 400);
  assert.deepEqual((await f.call(path)).body, current);
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      {
        type: "add-player",
        pieceId: "bad",
        team: "home",
        x: 1,
        y: 1,
        playerId: "no-such-player",
      },
    ],
  });
  assert.equal(r.status, 404);
});

test("linked lineup players reject archived and other-team references without mutating club records", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`,
    current = (await f.call(path)).body;
  const p = (
    await f.call("/players", "POST", { name: "归档球员", positions: ["后卫"] })
  ).body;
  assert.equal(
    (
      await f.call("/players/" + p.id, "PUT", {
        revision: p.revision,
        status: "inactive",
      })
    ).status,
    200,
  );
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(f.databasePath);
  db.prepare("INSERT INTO club_teams(id,name) VALUES(2,'Other')").run();
  db.prepare(
    "INSERT INTO club_players(id,team_id,name,positions) VALUES('other-player',2,'Private','[]')",
  ).run();
  db.close();
  for (const [playerId, status] of [
    [p.id, 400],
    ["other-player", 404],
  ]) {
    const r = await f.call(path, "PUT", {
      version: current.version,
      commands: [
        {
          type: "add-player",
          pieceId: "new-linked",
          playerId,
          team: "home",
          x: 0,
          y: 0,
        },
      ],
    });
    assert.equal(r.status, status);
    assert.deepEqual((await f.call(path)).body, current);
  }
  assert.equal(
    (await f.call("/players")).body.find((x) => x.id === p.id).status,
    "inactive",
  );
});

test("cross-format formation cannot leave another populated side on the old format", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`;
  const current = (await f.call(path)).body;
  const commands = [
    { type: "remove-player", pieceId: "p", acknowledgeAnimation: true },
    ...Array.from({ length: 5 }, (_, i) => ({
      type: "add-player",
      pieceId: "h" + i,
      team: "home",
      x: 1,
      y: 1,
    })),
    { type: "add-player", pieceId: "away", team: "away", x: 1, y: 1 },
    {
      type: "apply-formation",
      team: "home",
      playerCount: 5,
      formationId: "1-2-1",
      pieceIds: ["h0", "h1", "h2", "h3", "h4"],
    },
  ];
  const r = await f.call(path, "PUT", { version: current.version, commands });
  assert.equal(r.status, 400);
  assert.deepEqual((await f.call(path)).body, current);
});

test("ensure initial stage preserves empty demonstration identity and rejects orphan runs atomically", async (t) => {
  const f = await setup(t),
    path = `/tactics/${f.id}/commands`;
  const tactic = (await f.call(path)).body.tactic;
  tactic.board.demonstration.stages = [];
  tactic.board.demonstration.extension = { keep: "original" };
  tactic.board.demonstration.participants[0].customRole = "unchanged";
  assert.equal(
    (await f.call(`/tactics/${f.id}`, "PUT", { tactic })).status,
    200,
  );
  let current = (await f.call(path)).body;
  let r = await f.call(path, "PUT", {
    version: current.version,
    commands: [{ type: "ensure-initial-stage" }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body.tactic.board.demonstration;
  assert.deepEqual({ ...d, stages: [] }, tactic.board.demonstration);
  assert.deepEqual(d.stages, [
    {
      stageNumber: 0,
      title: "步骤 1",
      note: "",
      durationSeconds: 3,
      positions: [{ pieceId: "p", x: 200, y: 300 }],
    },
  ]);
  current = (await f.call(path)).body;
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [{ type: "ensure-initial-stage" }],
  });
  assert.equal(r.status, 400);
  assert.deepEqual((await f.call(path)).body, current);
  tactic.board.demonstration.runs = [
    {
      pieceId: "p",
      fromStage: 0,
      bend: { x: 250, y: 300 },
      unknown: "preserve",
    },
  ];
  assert.equal(
    (await f.call(`/tactics/${f.id}`, "PUT", { tactic })).status,
    200,
  );
  current = (await f.call(path)).body;
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [
      { type: "update-metadata", patch: { title: "not saved" } },
      { type: "ensure-initial-stage" },
    ],
  });
  assert.equal(r.status, 400);
  assert.deepEqual((await f.call(path)).body, current);
  delete tactic.board.demonstration;
  assert.equal(
    (await f.call(`/tactics/${f.id}`, "PUT", { tactic })).status,
    200,
  );
  current = (await f.call(path)).body;
  r = await f.call(path, "PUT", {
    version: current.version,
    commands: [{ type: "ensure-initial-stage" }],
  });
  assert.equal(r.status, 400);
});
