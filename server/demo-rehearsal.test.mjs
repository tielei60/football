import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createDemo } from "../scripts/create-demo.mjs";
import { createFootballServer } from "./index.mjs";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";

const script = fileURLToPath(
  new URL("../scripts/create-demo.mjs", import.meta.url),
);

test("fictional rehearsal preserves complete match, season, registration and permission semantics", async (t) => {
  const demo = createDemo();
  let server;
  t.after(async () => {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    rmSync(demo.directory, { recursive: true, force: true });
  });
  assert.equal(demo.fictional, true);
  assert.equal(demo.adultsOnly, true);
  assert.equal(
    statSync(join(demo.directory, "demo-manifest.json")).mode & 0o777,
    0o600,
  );
  assert.match(
    readFileSync(join(demo.directory, ".football-demo-owned"), "utf8"),
    /Fictional adult/,
  );
  const legacy = openFootballStore(demo.databasePath);
  try {
    const club = createClubStore(legacy.database, legacy);
    const session = club.login(demo.credentials[0], "rehearsal-test");
    const admin = club.authenticate(session.token);
    assert.equal(
      club.getTeam(admin.team_id).name,
      "青岚周末足球俱乐部（演练）",
    );
    const players = club.listPlayers(admin.team_id);
    assert.equal(players.length, 8);
    assert.equal(
      players.filter((p) => p.avatar?.startsWith("data:image/png;base64,"))
        .length,
      2,
    );
    const venues = club.listVenues(admin.team_id);
    assert.equal(venues.length, 3);
    assert.equal(venues.filter((v) => v.status === "active").length, 2);
    assert.equal(venues.filter((v) => v.status === "archived").length, 1);
    const byName = new Map(players.map((p) => [p.name, p]));
    assert.deepEqual(
      ["林远", "周泽", "顾川", "陈越"].map((n) => byName.get(n).number),
      [9, 8, 1, 4],
    );
    assert.deepEqual(
      ["林远", "周泽", "顾川", "陈越"].map((n) => byName.get(n).hasAccount),
      [true, true, true, false],
    );
    const seasonal = club.getSeasonRoster(admin.team_id, demo.season.id);
    assert.equal(seasonal.season.startDate, "2026-08-01");
    assert.equal(seasonal.season.endDate, "2027-07-31");
    assert.equal(seasonal.roster.length, 8);
    assert.deepEqual(
      seasonal.roster.map((p) => p.number).sort((a, b) => a - b),
      [1, 4, 6, 7, 8, 11, 12, 19],
    );
    const away = club.getMatch(admin, demo.matches.away),
      home = club.getMatch(admin, demo.matches.home);
    assert.equal(away.date, "2026-12-27");
    assert.equal(home.date, "2027-01-10");
    assert.equal(away.opponent, home.opponent);
    assert.equal(away.side, "away");
    assert.equal(away.durationMinutes, 90);
    assert.equal(home.durationMinutes, null);
    assert.ok(away.notice.length > 0);
    assert.ok(away.venueSnapshot.name);
    assert.equal(away.photos.length, 2);
    assert.equal(away.photoCount, 2);
    assert.equal(away.coverPhotoId, away.photos[0].id);
    assert.equal(away.coverPhotoUrl, away.photos[0].url);
    assert.ok(away.photos.every((p) => p.byteSize > 0));
    const sourcePhotos = legacy.database
      .prepare(
        "SELECT id,hex(data) AS data,caption,position FROM club_match_photos ORDER BY match_id,position",
      )
      .all();
    const backupPath = join(demo.directory, "photo-backup.sqlite");
    const backup = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../scripts/backup.mjs", import.meta.url)),
        backupPath,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, FOOTBALL_DB_PATH: demo.databasePath },
      },
    );
    assert.equal(backup.status, 0, backup.stderr);
    const backupDb = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.deepEqual(
        backupDb
          .prepare(
            "SELECT id,hex(data) AS data,caption,position FROM club_match_photos ORDER BY match_id,position",
          )
          .all(),
        sourcePhotos,
      );
      assert.equal(
        backupDb.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok",
      );
    } finally {
      backupDb.close();
    }
    assert.equal(home.side, "home");
    assert.deepEqual(
      [away.homeScore, away.awayScore, home.homeScore, home.awayScore],
      [3, 1, 0, null],
    );
    assert.equal(away.status, "completed");
    assert.equal(home.status, "completed");
    assert.deepEqual(home.roster, []);
    assert.equal(away.seasonId, seasonal.season.id);
    assert.equal(home.seasonId, seasonal.season.id);
    const rows = new Map(away.roster.map((r) => [r.playerId, r]));
    const lin = rows.get(byName.get("林远").id),
      zhou = rows.get(byName.get("周泽").id),
      gu = rows.get(byName.get("顾川").id);
    assert.deepEqual(
      [lin.selection, lin.appeared, lin.goals, lin.assists],
      ["starter", true, 2, 0],
    );
    assert.deepEqual(
      [zhou.selection, zhou.appeared, zhou.goals, zhou.assists],
      ["bench", true, 1, 1],
    );
    assert.deepEqual([gu.appeared, gu.goals, gu.assists], [null, null, null]);
    assert.equal(zhou.playerSnapshot.number, 8);
    assert.equal(lin.playerSnapshot.number, 19);
    assert.equal(byName.get("林远").number, 9);
    assert.equal(away.format, 7);
    assert.deepEqual(away.rsvps.map((r) => r.response).sort(), [
      "maybe",
      "no",
      "yes",
    ]);
    const upcoming = club.getMatch(admin, demo.matches.upcoming);
    assert.equal(upcoming.status, "published");
    assert.equal(upcoming.photos.length, 1);
    assert.equal(upcoming.coverPhotoId, upcoming.photos[0].id);
    assert.deepEqual(upcoming.roster, []);
    assert.deepEqual([upcoming.homeScore, upcoming.awayScore], [null, null]);
    assert.deepEqual(upcoming.rsvps.map((r) => r.response).sort(), [
      "maybe",
      "no",
      "yes",
    ]);
    const stats = club.statistics(
      admin,
      new URLSearchParams({ seasonId: String(demo.season.id) }),
    );
    assert.equal(stats.matches, 2);
    assert.equal(stats.matchesWithoutRoster, 1);
    assert.equal(stats.team.wins, 1);
    assert.equal(stats.team.scoredMatches, 1);
    assert.equal(stats.team.goalsFor, 3);
    assert.equal(stats.team.goalsForKnownMatches, 2);
    assert.equal(stats.team.goalsAgainstKnownMatches, 1);
    assert.equal(stats.opponents.length, 1);
    assert.equal(stats.opponents[0].matches, 2);
    const guStats = stats.players.find((p) => p.name === "顾川");
    assert.equal(guStats.goals, null);
    assert.equal(guStats.unknownAppearances, 1);
    assert.equal(stats.players.find((p) => p.name === "林远").assists, 0);
    for (const name of ["陈越", "宋青", "魏宁", "何舟", "许朗"]) {
      assert.equal(byName.get(name).hasAccount, false);
      const unused = stats.players.find((p) => p.name === name);
      assert.equal(unused.unrecordedMatches, 2);
      assert.equal(unused.registration.unanswered, 3);
      assert.equal(unused.goals, null);
    }
    assert.equal(
      club.statistics(admin, new URLSearchParams({ year: "2026" })).matches,
      1,
    );
    assert.equal(
      club.statistics(admin, new URLSearchParams({ year: "2027" })).matches,
      1,
    );
    assert.equal(demo.tacticsCreated, 1);
    assert.equal(legacy.listTactics().length, 1);
    const template = legacy.getTactic(demo.tacticId);
    assert.equal(template.formationName, "2-3-1");
    assert.equal(template.board.playerCount, 7);
    assert.equal(
      template.board.pieces.filter((p) => p.kind === "player").length,
      7,
    );
    assert.equal(
      template.board.pieces.filter((p) => p.kind === "ball").length,
      1,
    );
    for (const piece of template.board.pieces.filter(
      (p) => p.kind === "player",
    )) {
      assert.ok(
        players.some((p) => p.id === piece.playerId && p.name === piece.label),
      );
    }
    // Real editor coordinates: landscape pitch x=68..1183, y=62..763.
    const historicalPieces = away.tacticSnapshots[0].tactic.board.pieces;
    assert.ok(
      historicalPieces.every(
        (p) => p.x > 86 && p.x < 1165 && p.y > 80 && p.y < 745,
      ),
    );
    const lines = ["GK", "DF", "MF", "FW"].map((role) =>
      historicalPieces.filter((p) => p.position === role),
    );
    assert.deepEqual(
      lines.map((line) => line.length),
      [1, 2, 3, 1],
    );
    for (let i = 1; i < lines.length; i++)
      assert.ok(lines[i][0].x > lines[i - 1][0].x);
    assert.equal(template.board.markings.length, 2);
    assert.ok(template.board.markings.every((m) => m.kind === "arrow"));
    const animation = template.board.demonstration;
    assert.equal(animation.stages.length, 2);
    assert.equal(animation.participants.length, 8);
    assert.deepEqual(
      animation.stages.map((s) => s.stageNumber),
      [0, 1],
    );
    assert.ok(animation.runs.length > 0);
    assert.deepEqual(
      animation.stages.map((s) => s.durationSeconds),
      [2, 2],
    );
    assert.deepEqual(
      template.board.markings.map((m) => m.dashed),
      [false, true],
    );
    for (const stage of animation.stages) {
      assert.equal(stage.positions.length, 8);
      assert.ok(
        stage.positions.every((p) =>
          animation.participants.some((a) => a.pieceId === p.pieceId),
        ),
      );
    }
    assert.notDeepEqual(
      animation.stages[0].positions,
      animation.stages[1].positions,
    );
    assert.equal(legacy.getDesk().desk, null);
    assert.equal(club.tacticalDesk().initialPlayers.length, 8);
    assert.deepEqual(away.tacticIds, [demo.tacticId]);
    assert.equal(away.tacticSnapshots.length, 1);
    const snapshot = away.tacticSnapshots[0];
    assert.equal(snapshot.captureSource, "association");
    assert.equal(snapshot.sourceTacticId, demo.tacticId);
    assert.equal(
      snapshot.tactic.board.pieces.find((p) => p.pieceId === "demo-player-0").x,
      559,
    );
    assert.equal(
      template.board.pieces.find((p) => p.pieceId === "demo-player-0").x,
      600,
    );
    assert.notEqual(snapshot.tactic.title, template.title);
    assert.equal(snapshot.tactic.board.demonstration.stages.length, 2);
    // Exercise the actual editor save contract, while the completed record is immutable.
    legacy.saveTactic(demo.tacticId, {
      tactic: { ...template, title: template.title + "（编辑验证）" },
      note: "test",
    });
    assert.deepEqual(
      club.getMatch(admin, away.id).tacticSnapshots,
      away.tacticSnapshots,
    );
    assert.deepEqual(home.tacticSnapshots, []);
    const cancelled = club.getMatch(admin, demo.matches.cancelled);
    assert.equal(cancelled.status, "cancelled");
    assert.deepEqual([cancelled.homeScore, cancelled.awayScore], [null, null]);
    assert.equal(stats.registrationMatches, 3);
    assert.equal(club.listMatches(admin).length, 5);
    assert.equal(
      legacy.database.prepare("PRAGMA foreign_key_check").all().length,
      0,
    );
    club.logout(session.token);
  } finally {
    legacy.close();
  }

  server = createFootballServer({
    databasePath: demo.databasePath,
    publicOrigin: undefined,
    secureCookies: false,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [index, credential] of demo.credentials.entries()) {
    const login = await fetch(origin + "/api/auth/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(credential),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const headers = {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    };
    assert.equal(
      (await fetch(origin + "/api/tactics", { headers })).status,
      200,
    );
    assert.equal(
      (await fetch(origin + `/api/matches/${demo.matches.draft}`, { headers }))
        .status,
      index === 0 ? 200 : 404,
    );
    if (index) {
      assert.equal(
        (
          await fetch(origin + "/api/tactics", {
            method: "POST",
            headers,
            body: "{}",
          })
        ).status,
        403,
      );
      const result = await fetch(
        origin + `/api/matches/${demo.matches.upcoming}/rsvp`,
        { method: "PUT", headers, body: JSON.stringify({ response: "yes" }) },
      );
      assert.equal(result.status, 200);
      assert.equal(
        (
          await fetch(origin + "/api/players", {
            method: "POST",
            headers,
            body: JSON.stringify({ name: "不得创建" }),
          })
        ).status,
        403,
      );
    }
  }
});

test("demo ignores production environment paths and refuses all supplied targets without overwriting", (t) => {
  const sentinels = mkdtempSync(join(tmpdir(), "football-demo-sentinel-"));
  t.after(() => rmSync(sentinels, { recursive: true, force: true }));
  const existing = join(sentinels, "production.sqlite");
  writeFileSync(existing, "untouched existing database sentinel");
  assert.throws(() => createDemo({ databasePath: existing }), /不接受/);
  assert.throws(() => createDemo(existing), /不接受/);
  for (const args of [[existing], ["--database", existing]]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /不接受/);
  }
  const generated = [];
  t.after(() => {
    for (const demo of generated)
      rmSync(demo.directory, { recursive: true, force: true });
  });
  for (let index = 0; index < 2; index++) {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, FOOTBALL_DB_PATH: existing },
    });
    assert.equal(result.status, 0, result.stderr);
    const demo = JSON.parse(result.stdout);
    generated.push(demo);
    assert.notEqual(demo.databasePath, existing);
  }
  assert.notEqual(generated[0].databasePath, generated[1].databasePath);
  assert.equal(
    readFileSync(existing, "utf8"),
    "untouched existing database sentinel",
  );
});
