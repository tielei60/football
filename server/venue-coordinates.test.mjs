import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";
import { createFootballServer } from "./index.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "football-coordinate-tags-"));
  const path = join(directory, "test.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path;
}
const owner = { role: "admin", team_id: 1 };
const throwsStatus = (work, status) =>
  assert.throws(work, (error) => error.status === status);

test("coordinate tag migration preserves values, revisions and historical snapshot bytes across reads and edits", async (t) => {
  const path = await fixture(t);
  let db = openFootballStore(path),
    club = createClubStore(db.database, db);
  const venue = club.saveVenue(1, null, {
    name: "迁移演练球场",
    latitude: 31.23456789,
    longitude: 121.45678912,
  });
  const match = club.saveMatch(owner, null, {
    date: "2029-01-01",
    opponent: "虚构队",
    venueId: venue.id,
  });
  const oldSnapshot = {
    name: venue.name,
    address: venue.address,
    latitude: venue.latitude,
    longitude: venue.longitude,
  };
  // Preserve even insignificant whitespace: no pretend conversion or silent backfill.
  const raw = JSON.stringify(oldSnapshot, null, 2);
  db.database
    .prepare("UPDATE club_matches SET venue_snapshot=? WHERE id=?")
    .run(raw, match.id);
  db.close();
  const old = new DatabaseSync(path);
  old.exec(
    "ALTER TABLE club_venues DROP COLUMN coordinate_system; DELETE FROM app_migrations WHERE migration_name='club-venue-coordinate-system-v7'",
  );
  old.close();
  db = openFootballStore(path);
  club = createClubStore(db.database, db);
  const migrated = club.getVenue(1, venue.id);
  assert.deepEqual(migrated, { ...venue, coordinateSystem: "wgs84" });
  assert.equal(migrated.revision, venue.revision);
  assert.equal(club.listVenues(1)[0].coordinateSystem, "wgs84");
  assert.deepEqual(club.getMatch(owner, match.id).venueSnapshot, {
    ...oldSnapshot,
    coordinateSystem: "wgs84",
  });
  const rawRead = () =>
    db.database
      .prepare("SELECT venue_snapshot FROM club_matches WHERE id=?")
      .get(match.id).venue_snapshot;
  assert.equal(rawRead(), raw);
  let saved = club.saveMatch(owner, match.id, {
    revision: match.revision,
    notice: "只改须知",
    venueSnapshot: { ...oldSnapshot, coordinateSystem: "gcj02" },
  });
  assert.equal(rawRead(), raw);
  assert.equal(saved.venueSnapshot.coordinateSystem, "wgs84");
  const updatedVenue = club.saveVenue(1, venue.id, {
    revision: venue.revision,
    name: "新名称",
    latitude: 31.25,
    longitude: 121.47,
    coordinateSystem: "gcj02",
    status: "archived",
  });
  saved = club.saveMatch(owner, match.id, {
    revision: saved.revision,
    analysis: "只改复盘",
  });
  assert.equal(rawRead(), raw);
  assert.deepEqual(saved.venueSnapshot, {
    ...oldSnapshot,
    coordinateSystem: "wgs84",
  });
  throwsStatus(
    () =>
      club.saveMatch(owner, null, {
        date: "2029-01-02",
        opponent: "新比赛",
        venueId: venue.id,
      }),
    400,
  );
  db.close();
  db = openFootballStore(path);
  club = createClubStore(db.database, db);
  assert.equal(rawRead(), raw);
  assert.equal(club.getVenue(1, venue.id).coordinateSystem, "gcj02");
  assert.equal(
    club.getMatch(owner, match.id).venueSnapshot.coordinateSystem,
    "wgs84",
  );
  club.saveVenue(1, venue.id, {
    revision: updatedVenue.revision,
    status: "active",
  });
  saved = club.saveMatch(owner, match.id, {
    revision: saved.revision,
    venueId: null,
  });
  saved = club.saveMatch(owner, match.id, {
    revision: saved.revision,
    venueId: venue.id,
  });
  assert.deepEqual(saved.venueSnapshot, {
    name: "新名称",
    address: venue.address,
    latitude: 31.25,
    longitude: 121.47,
    coordinateSystem: "gcj02",
  });
  assert.equal(JSON.parse(rawRead()).coordinateSystem, "gcj02");
  assert.equal(db.database.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();
});

test("old requests preserve WGS84 compatibility but cannot silently change GCJ02 coordinates", async (t) => {
  const path = await fixture(t),
    db = openFootballStore(path),
    club = createClubStore(db.database, db);
  t.after(() => db.close());
  let venue = club.saveVenue(1, null, {
    name: "兼容演练",
    latitude: 30.5,
    longitude: 120.5,
  });
  assert.equal(venue.coordinateSystem, "wgs84");
  venue = club.saveVenue(1, venue.id, {
    revision: venue.revision,
    latitude: 30.6,
    longitude: 120.6,
  });
  assert.equal(venue.coordinateSystem, "wgs84");
  venue = club.saveVenue(1, venue.id, {
    revision: venue.revision,
    latitude: 30.6,
    longitude: 120.6,
    coordinateSystem: "gcj02",
  });
  assert.equal(venue.latitude, 30.6);
  assert.equal(venue.longitude, 120.6);
  venue = club.saveVenue(1, venue.id, {
    revision: venue.revision,
    name: "旧客户端只改名称",
    latitude: venue.latitude,
    longitude: venue.longitude,
  });
  venue = club.saveVenue(1, venue.id, {
    revision: venue.revision,
    status: "archived",
  });
  assert.equal(venue.coordinateSystem, "gcj02");
  for (const patch of [
    { latitude: 30.7 },
    { longitude: 120.7 },
    { latitude: null, longitude: null },
  ]) {
    throwsStatus(
      () => club.saveVenue(1, venue.id, { revision: venue.revision, ...patch }),
      400,
    );
    assert.deepEqual(club.getVenue(1, venue.id), venue);
  }
  for (const coordinateSystem of [null, "", "GCJ02", "bd09", "wgs-84", false])
    throwsStatus(
      () =>
        club.saveVenue(1, venue.id, {
          revision: venue.revision,
          coordinateSystem,
        }),
      400,
    );
  for (const patch of [
    { latitude: 91, longitude: 1 },
    { latitude: 0, longitude: 181 },
    { latitude: 0, longitude: null },
  ])
    throwsStatus(
      () =>
        club.saveVenue(1, venue.id, {
          revision: venue.revision,
          coordinateSystem: "gcj02",
          ...patch,
        }),
      400,
    );
  throwsStatus(
    () =>
      club.saveVenue(1, venue.id, {
        revision: venue.revision - 1,
        coordinateSystem: "gcj02",
        latitude: 31,
      }),
    409,
  );
  throwsStatus(
    () =>
      club.saveVenue(1, venue.id, { coordinateSystem: "gcj02", latitude: 31 }),
    428,
  );
  venue = club.saveVenue(1, venue.id, {
    revision: venue.revision,
    coordinateSystem: "gcj02",
    latitude: null,
    longitude: null,
  });
  assert.equal(venue.latitude, null);
  assert.equal(venue.coordinateSystem, "gcj02");
  venue = club.saveVenue(1, venue.id, {
    revision: venue.revision,
    coordinateSystem: "wgs84",
    latitude: -33.123,
    longitude: -70.456,
  });
  assert.equal(venue.latitude, -33.123);
  assert.equal(venue.longitude, -70.456);
  assert.equal(venue.coordinateSystem, "wgs84");
  assert.equal(
    club.saveVenue(1, null, { name: "无坐标", coordinateSystem: "gcj02" })
      .coordinateSystem,
    "gcj02",
  );
});

test("coordinate-tag HTTP permissions remain same-team read and administrator-only write", async (t) => {
  const path = await fixture(t),
    server = createFootballServer({
      databasePath: path,
      bootstrapAdmin: { username: "owner", password: "owner-password-123" },
    });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(route, method = "GET", body, cookie) {
    const response = await fetch(base + route, {
      method,
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const admin = (
    await call("/api/auth/login", "POST", {
      username: "owner",
      password: "owner-password-123",
    })
  ).cookie;
  const venue = (
    await call(
      "/api/venues",
      "POST",
      {
        name: "国内坐标球场",
        latitude: 31.2,
        longitude: 121.4,
        coordinateSystem: "gcj02",
      },
      admin,
    )
  ).body;
  assert.equal(venue.coordinateSystem, "gcj02");
  for (const patch of [{}, { latitude: 31.2 }, { longitude: 121.4 }]) {
    assert.equal(
      (
        await call(
          `/api/venues/${venue.id}`,
          "PUT",
          {
            revision: venue.revision,
            coordinateSystem: "wgs84",
            ...patch,
          },
          admin,
        )
      ).status,
      400,
    );
    assert.deepEqual(
      (await call(`/api/venues/${venue.id}`, "GET", undefined, admin)).body,
      venue,
    );
  }
  const player = (
    await call(
      "/api/players",
      "POST",
      { name: "虚构成年队员", positions: ["中场"] },
      admin,
    )
  ).body;
  await call(
    `/api/players/${player.id}/account`,
    "POST",
    { username: "player", password: "owner-password-123" },
    admin,
  );
  const playerCookie = (
    await call("/api/auth/login", "POST", {
      username: "player",
      password: "owner-password-123",
    })
  ).cookie;
  assert.equal((await call("/api/venues")).status, 401);
  assert.equal(
    (await call(`/api/venues/${venue.id}`, "GET", undefined, playerCookie)).body
      .coordinateSystem,
    "gcj02",
  );
  assert.equal(
    (
      await call(
        `/api/venues/${venue.id}`,
        "PUT",
        { revision: venue.revision, coordinateSystem: "wgs84" },
        playerCookie,
      )
    ).status,
    403,
  );
  const db = new DatabaseSync(path);
  db.exec(
    "INSERT INTO club_teams(id,name) VALUES(2,'另一虚构队'); INSERT INTO club_users(team_id,username,password_hash,role) SELECT 2,'other',password_hash,'admin' FROM club_users WHERE username='owner'",
  );
  db.close();
  const other = (
    await call("/api/auth/login", "POST", {
      username: "other",
      password: "owner-password-123",
    })
  ).cookie;
  assert.deepEqual(
    (await call("/api/venues", "GET", undefined, other)).body,
    [],
  );
  assert.equal(
    (
      await call(
        `/api/venues/${venue.id}`,
        "PUT",
        { revision: venue.revision, coordinateSystem: "wgs84" },
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        "/api/matches",
        "POST",
        { opponent: "跨队", date: "2030-01-01", venueId: venue.id },
        other,
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(`/api/venues/${venue.id}`, "GET", undefined, admin)).body
      .coordinateSystem,
    "gcj02",
  );
});

test("changing a populated venue coordinate system requires an explicit complete pair", async (t) => {
  const path = await fixture(t),
    db = openFootballStore(path),
    club = createClubStore(db.database, db);
  t.after(() => db.close());
  for (const original of ["wgs84", "gcj02"]) {
    const target = original === "wgs84" ? "gcj02" : "wgs84";
    let venue = club.saveVenue(1, null, {
      name: "显式坐标切换演练",
      coordinateSystem: original,
      latitude: 0,
      longitude: 0,
    });
    for (const patch of [
      {},
      { latitude: 0 },
      { longitude: 0 },
      { latitude: null },
      { longitude: null },
    ]) {
      throwsStatus(
        () =>
          club.saveVenue(1, venue.id, {
            revision: venue.revision,
            coordinateSystem: target,
            ...patch,
          }),
        400,
      );
      assert.deepEqual(club.getVenue(1, venue.id), venue);
    }
    venue = club.saveVenue(1, venue.id, {
      revision: venue.revision,
      coordinateSystem: target,
      latitude: 0,
      longitude: 0,
    });
    assert.equal(venue.coordinateSystem, target);
    assert.equal(venue.latitude, 0);
    assert.equal(venue.longitude, 0);
    venue = club.saveVenue(1, venue.id, {
      revision: venue.revision,
      coordinateSystem: original,
      latitude: null,
      longitude: null,
    });
    assert.equal(venue.latitude, null);
    assert.equal(venue.longitude, null);
    venue = club.saveVenue(1, venue.id, {
      revision: venue.revision,
      coordinateSystem: target,
    });
    assert.equal(venue.coordinateSystem, target);
    assert.equal(venue.latitude, null);
  }
});
