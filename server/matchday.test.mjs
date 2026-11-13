import test from "node:test";
import { createRequire } from "node:module";
import { validateMatchPhotoUploads } from "./match-photo-decode.mjs";
const require = createRequire(new URL("../app/package.json", import.meta.url));
const sharp = require("sharp");
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { deflateSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { createFootballServer } from "./index.mjs";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";
import { validateMatchPhoto } from "./match-images.mjs";

function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const b = Buffer.alloc(data.length + 12);
  b.writeUInt32BE(data.length);
  b.write(type, 4);
  data.copy(b, 8);
  b.writeUInt32BE(crc(b.subarray(4, -4)), b.length - 4);
  return b;
}
function png({ width = 1, height = 1, padding = 0 } = {}) {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(width);
  h.writeUInt32BE(height, 4);
  h[8] = 8;
  h[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", h),
    ...(padding ? [chunk("tEXt", Buffer.alloc(padding, 65))] : []),
    chunk("IDAT", deflateSync(Buffer.from([0, 80, 20, 120, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const dataUrl = (bytes) => `data:image/png;base64,${bytes.toString("base64")}`;
const photo = dataUrl(png());
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "football-matchday-"));
  const path = join(dir, "test.sqlite");
  let server, base;
  async function start() {
    server = createFootballServer({
      databasePath: path,
      bootstrapAdmin: { username: "owner", password: "owner-password-123" },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await start();
  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  async function call(route, method = "GET", body, cookie, headers = {}) {
    const r = await fetch(base + route, {
      method,
      headers: {
        Origin: base,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: r.status,
      body:
        r.status === 204
          ? null
          : r.headers.get("content-type")?.startsWith("application/json")
            ? await r.json()
            : Buffer.from(await r.arrayBuffer()),
      headers: r.headers,
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(username = "owner") {
    const r = await call("/api/auth/login", "POST", {
      username,
      password: "owner-password-123",
    });
    assert.equal(r.status, 200);
    return r.cookie;
  }
  const cookie = await login();
  const admin = (route, method, body, headers) =>
    call(route, method, body, cookie, headers);
  async function player() {
    const p = (
      await admin("/api/players", "POST", {
        name: "虚构成年球员",
        positions: ["中场"],
      })
    ).body;
    await admin(`/api/players/${p.id}/account`, "POST", {
      username: "player",
      password: "owner-password-123",
    });
    return { p, cookie: await login("player") };
  }
  return {
    path,
    call,
    admin,
    login,
    player,
    restart: async () => {
      await stop();
      await start();
    },
  };
}

test("venue and match schedule preserve legacy unknowns, immutable location snapshots and revisions", async (t) => {
  const f = await fixture(t);
  const legacy = (
    await f.admin("/api/matches", "POST", {
      opponent: "虚构客队",
      date: "2028-12-31",
      location: "旧地点",
    })
  ).body;
  assert.equal(legacy.durationMinutes, null);
  assert.equal(legacy.venueId, null);
  assert.equal(legacy.venueSnapshot, null);
  assert.equal(legacy.notice, "");
  let venue = (
    await f.admin("/api/venues", "POST", {
      name: " 虚构公共球场 ",
      address: "演练路",
      latitude: 31.2,
      longitude: 121.4,
      note: "入口A",
    })
  ).body;
  assert.equal(venue.name, "虚构公共球场");
  assert.equal(venue.revision, 1);
  let m = (
    await f.admin(`/api/matches/${legacy.id}`, "PUT", {
      revision: legacy.revision,
      venueId: venue.id,
      kickoff: "23:30",
      durationMinutes: 120,
      notice: "请提前到场。\n自备饮水。",
      venueSnapshot: { name: "伪造" },
    })
  ).body;
  assert.equal(m.date, "2028-12-31");
  assert.equal(m.kickoff, "23:30");
  assert.equal(m.durationMinutes, 120);
  assert.equal(m.location, venue.name);
  assert.deepEqual(m.venueSnapshot, {
    name: venue.name,
    address: venue.address,
    latitude: 31.2,
    longitude: 121.4,
    coordinateSystem: "wgs84",
  });
  const snap = m.venueSnapshot;
  venue = (
    await f.admin(`/api/venues/${venue.id}`, "PUT", {
      revision: venue.revision,
      name: "后来改名",
      latitude: 32,
      longitude: 122,
      status: "archived",
    })
  ).body;
  m = (
    await f.admin(`/api/matches/${m.id}`, "PUT", {
      revision: m.revision,
      analysis: "只修改分析",
      location: "客户端改名企图",
      venueSnapshot: { name: "客户端刷新企图" },
    })
  ).body;
  assert.deepEqual(m.venueSnapshot, snap);
  assert.equal(
    (
      await f.admin("/api/matches", "POST", {
        opponent: "另场",
        date: "2028-12-31",
        venueId: venue.id,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.admin(`/api/venues/${venue.id}`, "PUT", {
        revision: 1,
        name: "旧客户端",
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.admin(`/api/venues/${venue.id}`, "PUT", { name: "无版本" }))
      .status,
    428,
  );
  for (const invalid of [
    { latitude: 91, longitude: 1 },
    { latitude: 0, longitude: null },
    { latitude: "0", longitude: 0 },
    { latitude: 0, longitude: 181 },
  ])
    assert.equal(
      (await f.admin("/api/venues", "POST", { name: "无效", ...invalid }))
        .status,
      400,
    );
  for (const durationMinutes of [0, -1, 1441, 1.5, "90"])
    assert.equal(
      (
        await f.admin(`/api/matches/${m.id}`, "PUT", {
          revision: m.revision,
          durationMinutes,
        })
      ).status,
      400,
    );
  assert.equal(
    (
      await f.admin(`/api/matches/${m.id}`, "PUT", {
        revision: m.revision,
        notice: "x".repeat(10001),
      })
    ).status,
    400,
  );
  m = (
    await f.admin(`/api/matches/${m.id}`, "PUT", {
      revision: m.revision,
      venueId: null,
      location: "临时自行输入",
      durationMinutes: null,
    })
  ).body;
  assert.equal(m.venueSnapshot, null);
  assert.equal(m.location, "临时自行输入");
  await f.restart();
  assert.equal(
    (await f.admin(`/api/matches/${m.id}`)).body.location,
    "临时自行输入",
  );
  assert.equal((await f.admin("/api/venues")).body[0].status, "archived");
});

test("matchday routes enforce anonymous, player, draft, cross-team and CSRF boundaries", async (t) => {
  const f = await fixture(t);
  const { cookie: playerCookie } = await f.player();
  const venue = (await f.admin("/api/venues", "POST", { name: "本队球场" }))
    .body;
  let m = (
    await f.admin("/api/matches", "POST", {
      opponent: "虚构对手",
      date: "2028-01-01",
    })
  ).body;
  m = (
    await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
      revision: m.revision,
      photos: [{ data: photo, caption: "虚构合影" }],
      coverIndex: 0,
    })
  ).body;
  assert.equal((await f.call("/api/venues")).status, 401);
  assert.equal(
    (await f.call("/api/venues", "GET", undefined, playerCookie)).status,
    200,
  );
  assert.equal(
    (await f.call("/api/venues", "POST", { name: "无权" }, playerCookie))
      .status,
    403,
  );
  assert.equal(
    (
      await f.call(
        `/api/venues/${venue.id}`,
        "PUT",
        { revision: venue.revision, name: "无权" },
        playerCookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call(
        `/api/matches/${m.id}/photos`,
        "PUT",
        { revision: m.revision, photos: [] },
        playerCookie,
      )
    ).status,
    403,
  );
  assert.equal((await f.call(m.photos[0].url)).status, 401);
  assert.equal(
    (await f.call(m.photos[0].url, "GET", undefined, playerCookie)).status,
    404,
  );
  assert.equal(
    (
      await f.admin(
        `/api/matches/${m.id}/photos`,
        "PUT",
        { revision: m.revision, photos: [] },
        { Origin: "https://other.invalid" },
      )
    ).status,
    403,
  );
  const db = new DatabaseSync(f.path);
  db.exec(
    "INSERT INTO club_teams(id,name) VALUES(2,'其他虚构队'); INSERT INTO club_users(team_id,username,password_hash,role) SELECT 2,'other',password_hash,'admin' FROM club_users WHERE username='owner'",
  );
  db.close();
  const other = await f.login("other");
  assert.deepEqual(
    (await f.call("/api/venues", "GET", undefined, other)).body,
    [],
  );
  assert.equal(
    (await f.call(`/api/venues/${venue.id}`, "GET", undefined, other)).status,
    404,
  );
  assert.equal(
    (await f.call(m.photos[0].url, "GET", undefined, other)).status,
    404,
  );
  assert.equal(
    (
      await f.call(
        "/api/matches",
        "POST",
        { opponent: "跨队伪造", date: "2028-01-01", venueId: venue.id },
        other,
      )
    ).status,
    404,
  );
  m = (
    await f.admin(`/api/matches/${m.id}`, "PUT", {
      revision: m.revision,
      status: "published",
    })
  ).body;
  const image = await f.call(m.photos[0].url, "GET", undefined, playerCookie);
  assert.equal(image.status, 200);
  assert.deepEqual(image.body, png());
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("cache-control"), "private, no-store");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
});

test("photo ordering, explicit cover, metadata, optimistic concurrency and rollback survive restart", async (t) => {
  const f = await fixture(t);
  let m = (
    await f.admin("/api/matches", "POST", {
      opponent: "相册对手",
      date: "2029-01-01",
    })
  ).body;
  assert.deepEqual(m.photos, []);
  assert.equal(m.photoCount, 0);
  m = (
    await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
      revision: m.revision,
      photos: [
        { data: photo, caption: "第一张", url: "https://evil.invalid" },
        { data: photo, caption: "第二张" },
      ],
      coverIndex: 1,
    })
  ).body;
  const ids = m.photos.map((p) => p.id);
  assert.equal(m.coverPhotoId, ids[1]);
  assert.equal(m.coverPhotoUrl, m.photos[1].url);
  assert.equal(m.photos[0].byteSize, png().length);
  assert.match(m.photos[0].url, /^\/api\/matches\/\d+\/photos\/[a-f0-9-]+$/);
  const summary = (await f.admin("/api/matches")).body[0];
  assert.equal(summary.photos, undefined);
  assert.equal(summary.photoCount, 2);
  assert.equal(summary.coverPhotoUrl, m.coverPhotoUrl);
  const revision = m.revision;
  m = (
    await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
      revision,
      photos: [{ id: ids[1] }, { id: ids[0], caption: "重排后说明" }],
      coverIndex: 0,
    })
  ).body;
  assert.deepEqual(
    m.photos.map((p) => p.id),
    ids.toReversed(),
  );
  assert.equal(m.photos[0].caption, "第二张");
  assert.equal(m.photos[1].caption, "重排后说明");
  assert.equal(
    (
      await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
        revision,
        photos: [],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.admin(`/api/matches/${m.id}`, "PUT", {
        revision,
        notice: "相册之前的表单",
      })
    ).status,
    409,
  );
  for (const patch of [
    { photos: [{ id: ids[0] }, { id: ids[0] }] },
    { photos: [{ id: "foreign" }] },
    { photos: [{ data: "data:image/svg+xml;base64,PHN2Zy8+" }] },
    { photos: m.photos, coverIndex: 9 },
    { photos: Array.from({ length: 11 }, () => ({ data: photo })) },
  ]) {
    assert.equal(
      (
        await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
          revision: m.revision,
          ...patch,
        })
      ).status,
      400,
    );
    assert.deepEqual((await f.admin(`/api/matches/${m.id}`)).body, m);
  }
  assert.equal(
    (await f.admin(`/api/matches/${m.id}/photos`, "PUT", { photos: [] }))
      .status,
    428,
  );
  await f.restart();
  assert.deepEqual((await f.admin(`/api/matches/${m.id}`)).body, m);
  m = (
    await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
      revision: m.revision,
      photos: [{ id: ids[0] }],
      coverIndex: null,
    })
  ).body;
  assert.equal(m.coverPhotoUrl, null);
  assert.equal(m.photoCount, 1);
  assert.equal(
    (await f.admin(`/api/matches/${m.id}/photos/${ids[1]}`)).status,
    404,
  );
  m = (
    await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
      revision: m.revision,
      photos: [],
      coverIndex: null,
    })
  ).body;
  assert.equal(m.photoCount, 0);
});

test("photo validation rejects fake encodings, corruption, dimensions, truncation and total quota atomically", async (t) => {
  const f = await fixture(t);
  let m = (
    await f.admin("/api/matches", "POST", {
      opponent: "容量演练",
      date: "2029-01-01",
    })
  ).body;
  const corrupt = png();
  corrupt[corrupt.length - 1] ^= 1;
  for (const image of [
    "https://example.invalid/p.png",
    photo + "=",
    dataUrl(corrupt),
    dataUrl(png().subarray(0, -12)),
    dataUrl(png({ width: 16384, height: 16384 })),
    dataUrl(png({ padding: 2 * 1024 * 1024 })),
  ])
    assert.throws(() => validateMatchPhoto(image), /照片须/);
  const large = dataUrl(png({ padding: 1900000 }));
  assert.ok(validateMatchPhoto(large).bytes.length < 2 * 1024 * 1024);
  const r = await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
    revision: m.revision,
    photos: Array.from({ length: 9 }, () => ({ data: large })),
    coverIndex: 0,
  });
  assert.equal(r.status, 413);
  assert.deepEqual((await f.admin(`/api/matches/${m.id}`)).body, m);
});

test("RSVP withdrawal is a distinct unanswered state and cannot alter other players or completed matches", async (t) => {
  const f = await fixture(t);
  const { p, cookie } = await f.player();
  let m = (
    await f.admin("/api/matches", "POST", {
      opponent: "报名演练",
      date: "2029-01-01",
      status: "published",
    })
  ).body;
  for (const response of ["yes", "no", "maybe"]) {
    const r = await f.call(
      `/api/matches/${m.id}/rsvp`,
      "PUT",
      { response, playerId: "ignored" },
      cookie,
    );
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.rsvps, [{ playerId: p.id, response }]);
  }
  assert.equal(
    (
      await f.call(
        `/api/matches/${m.id}/rsvp`,
        "PUT",
        { response: null },
        cookie,
      )
    ).status,
    200,
  );
  assert.deepEqual((await f.admin(`/api/matches/${m.id}`)).body.rsvps, []);
  const stats = (
    await f.call("/api/statistics?year=2029", "GET", undefined, cookie)
  ).body.players.find((x) => x.playerId === p.id);
  assert.deepEqual(stats.registration, {
    yes: 0,
    no: 0,
    maybe: 0,
    unanswered: 1,
  });
  assert.equal(
    (await f.admin(`/api/matches/${m.id}/rsvp`, "PUT", { response: "yes" }))
      .status,
    403,
  );
  m = (
    await f.admin(`/api/matches/${m.id}`, "PUT", {
      revision: m.revision,
      status: "completed",
    })
  ).body;
  assert.equal(
    (
      await f.call(
        `/api/matches/${m.id}/rsvp`,
        "PUT",
        { response: null },
        cookie,
      )
    ).status,
    409,
  );
});

test("old database migration keeps date, location, unknown duration and photo-free records unchanged", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "football-matchday-migration-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "old.sqlite");
  let store = openFootballStore(path);
  let club = createClubStore(store.database, store);
  const u = { team_id: 1, role: "admin" };
  const m = club.saveMatch(u, null, {
    date: "2025-12-31",
    opponent: "历史虚构队",
    location: "老球场",
  });
  store.close();
  const db = new DatabaseSync(path);
  db.exec(
    "DROP TABLE club_match_photos; ALTER TABLE club_matches DROP COLUMN cover_photo_id; ALTER TABLE club_matches DROP COLUMN venue_snapshot; ALTER TABLE club_matches DROP COLUMN venue_id; ALTER TABLE club_matches DROP COLUMN notice; ALTER TABLE club_matches DROP COLUMN duration_minutes; DROP TABLE club_venues; DELETE FROM app_migrations WHERE migration_name='club-matchday-v6'",
  );
  db.close();
  store = openFootballStore(path);
  club = createClubStore(store.database, store);
  const read = club.getMatch(u, m.id);
  assert.equal(read.location, "老球场");
  assert.equal(read.date, "2025-12-31");
  assert.equal(read.kickoff, "");
  assert.equal(read.durationMinutes, null);
  assert.equal(read.venueSnapshot, null);
  assert.equal(read.notice, "");
  assert.deepEqual(read.photos, []);
  assert.equal(read.revision, m.revision);
  store.close();
});

// Real encoded 2×2 fictional solid-color fixtures, generated offline.
test("album accepts supported static image formats and rejects truncated alternatives", async (t) => {
  const images = {
    jpeg: "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmqKKK909k/9k=",
    webp: "UklGRjYAAABXRUJQVlA4ICoAAACQAQCdASoCAAIAAUAmJaACdLoAA5gA/vAb3/8Q50OdDmYz/VeIMz1kAAA=",
    gif: "R0lGODdhAgACAIEAAII8lgAAAAAAAAAAACwAAAAAAgACAAAIBgABCAQQEAA7",
  };
  const f = await fixture(t);
  let m = (
    await f.admin("/api/matches", "POST", {
      opponent: "四格式演练",
      date: "2030-01-01",
    })
  ).body;
  images.png = png().toString("base64");
  for (const [kind, base64] of Object.entries(images)) {
    const raw = Buffer.from(base64, "base64");
    const out = validateMatchPhoto(`data:image/${kind};base64,${base64}`);
    assert.equal(out.mime, `image/${kind}`);
    assert.deepEqual(out.bytes, raw);
    const saved = await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
      revision: m.revision,
      photos: [{ data: `data:image/${kind};base64,${base64}` }],
      coverIndex: 0,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    m = saved.body;
    assert.deepEqual((await f.admin(m.photos[0].url)).body, raw);
    assert.throws(() =>
      validateMatchPhoto(
        `data:image/${kind};base64,${raw.subarray(0, -3).toString("base64")}`,
      ),
    );
  }
});

test("public album API fully decodes pixels and atomically rejects four fake image containers", async (t) => {
  const f = await fixture(t);
  let m = (
    await f.admin("/api/matches", "POST", {
      opponent: "坏图防护演练",
      date: "2030-01-01",
    })
  ).body;
  m = (
    await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
      revision: m.revision,
      photos: [{ data: photo, caption: "原图保留" }],
      coverIndex: 0,
    })
  ).body;
  const h = Buffer.alloc(13);
  h.writeUInt32BE(1);
  h.writeUInt32BE(1, 4);
  h[8] = 8;
  h[9] = 6;
  const brokenPng = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", h),
    chunk("IDAT", deflateSync(Buffer.from([0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const brokenJpeg = Buffer.from([
    255, 216, 255, 192, 0, 8, 8, 0, 1, 0, 1, 0, 255, 218, 0, 2, 255, 217,
  ]);
  const brokenWebp = Buffer.alloc(26);
  brokenWebp.write("RIFF");
  brokenWebp.writeUInt32LE(18, 4);
  brokenWebp.write("WEBP", 8);
  brokenWebp.write("VP8L", 12);
  brokenWebp.writeUInt32LE(5, 16);
  brokenWebp[20] = 47;
  const brokenGif = Buffer.from(
    "474946383961010001000000002c00000000010001000002003b",
    "hex",
  );
  for (const [kind, bytes] of Object.entries({
    png: brokenPng,
    jpeg: brokenJpeg,
    webp: brokenWebp,
    gif: brokenGif,
  })) {
    const data = `data:image/${kind};base64,${bytes.toString("base64")}`;
    // These pass container preflight; full decode is a separate mandatory API boundary.
    if (kind !== "gif") assert.doesNotThrow(() => validateMatchPhoto(data));
    const result = await f.admin(`/api/matches/${m.id}/photos`, "PUT", {
      revision: m.revision,
      photos: [{ id: m.photos[0].id }, { data }],
      coverIndex: 1,
    });
    assert.equal(result.status, 400, kind);
    assert.match(result.body.message, /完整读取|照片须/);
    assert.deepEqual((await f.admin(`/api/matches/${m.id}`)).body, m);
    assert.deepEqual((await f.admin(m.photos[0].url)).body, png());
  }
});

test("GIF recovery cannot hide missing, truncated or wrong-length pixel streams", () => {
  const encode = (data) =>
    Buffer.from([
      71,
      73,
      70,
      56,
      57,
      97,
      1,
      0,
      1,
      0,
      128,
      0,
      0,
      0,
      0,
      0,
      255,
      255,
      255,
      44,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      2,
      ...(data.length ? [data.length, ...data] : []),
      0,
      59,
    ]);
  for (const pixels of [[], [0], [0, 0], [0x4c]])
    assert.throws(() =>
      validateMatchPhoto(
        `data:image/gif;base64,${encode(pixels).toString("base64")}`,
      ),
    );
  for (const pixels of [
    [0x4c, 1],
    [0x44, 1],
  ])
    assert.doesNotThrow(() =>
      validateMatchPhoto(
        `data:image/gif;base64,${encode(pixels).toString("base64")}`,
      ),
    );
});

test("static GIF dictionary growth remains compatible with full decoder validation", async () => {
  const pixels = Buffer.alloc(80 * 64 * 3);
  let seed = 4;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  const gif = await sharp(pixels, {
    raw: { width: 80, height: 64, channels: 3 },
  })
    .gif({ colours: 256 })
    .toBuffer();
  await validateMatchPhotoUploads({
    photos: [{ data: `data:image/gif;base64,${gif.toString("base64")}` }],
  });
});

for (const event of ["logout", "concurrent edit"])
  test(`asynchronous image decoding rechecks ${event} before committing`, async (t) => {
    const f = await fixture(t),
      cookie = await f.login();
    let m = (
      await f.admin("/api/matches", "POST", {
        opponent: "异步边界演练",
        date: "2030-01-01",
      })
    ).body;
    let signalEntered, release;
    const entered = new Promise((resolve) => {
        signalEntered = resolve;
      }),
      gate = new Promise((resolve) => {
        release = resolve;
      });
    const original = sharp.prototype.toBuffer;
    t.mock.method(sharp.prototype, "toBuffer", async function (...args) {
      signalEntered();
      await gate;
      return original.apply(this, args);
    });
    const pending = f.call(
      `/api/matches/${m.id}/photos`,
      "PUT",
      { revision: m.revision, photos: [{ data: photo }], coverIndex: 0 },
      cookie,
    );
    await entered;
    if (event === "logout")
      assert.equal(
        (await f.call("/api/auth/logout", "POST", undefined, cookie)).status,
        204,
      );
    else
      m = (
        await f.admin(`/api/matches/${m.id}`, "PUT", {
          revision: m.revision,
          notice: "解码期间新的修改",
        })
      ).body;
    release();
    const result = await pending;
    assert.equal(result.status, event === "logout" ? 401 : 409);
    assert.deepEqual((await f.admin(`/api/matches/${m.id}`)).body, m);
  });
