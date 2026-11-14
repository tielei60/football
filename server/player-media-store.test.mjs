import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPlayerMediaStore,
  sanitizePlayerPhoto,
} from "./player-media-store.mjs";
const sharp = createRequire(new URL("../app/package.json", import.meta.url))(
  "sharp",
);
const admin = { id: 1, team_id: 1, role: "admin" },
  member = { id: 2, team_id: 1, role: "player" },
  other = { id: 3, team_id: 2, role: "admin" };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "player-media-test-"));
  const file = join(dir, "isolated.sqlite");
  const db = new DatabaseSync(file);
  db.exec(
    `PRAGMA foreign_keys=ON;CREATE TABLE club_players(id TEXT PRIMARY KEY,team_id INTEGER NOT NULL,status TEXT,avatar TEXT,name TEXT,number INTEGER,UNIQUE(team_id,id));CREATE TABLE club_users(id INTEGER PRIMARY KEY,team_id INTEGER,role TEXT,player_id TEXT);INSERT INTO club_players VALUES('p',1,'active','unchanged','合成目标',8),('reader',1,'active',NULL,'合成读者',9),('foreign',2,'active',NULL,'合成外队',10);INSERT INTO club_users VALUES(1,1,'admin',NULL),(2,1,'player','reader'),(3,2,'admin',NULL);`,
  );
  t.after(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const image =
    "data:image/png;base64," +
    (
      await sharp({
        create: {
          width: 16,
          height: 12,
          channels: 4,
          background: { r: 80, g: 40, b: 100, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer()
    ).toString("base64");
  return { db, file, store: createPlayerMediaStore(db), image };
}
const upload = (
  f,
  revision,
  id = "upload-request-0001",
  caption = "合成测试",
) =>
  f.store.add(
    admin,
    "p",
    { revision, requestId: id, dataUrl: f.image, caption },
    () => admin,
  );
test("full decode rejects fake/truncated images and strips metadata with white alpha background", async () => {
  const source = await sharp({
    create: { width: 16, height: 12, channels: 3, background: "#8845a0" },
  })
    .withMetadata({ exif: { IFD0: { Artist: "PRIVATE-TEST" } } })
    .jpeg()
    .toBuffer();
  const out = await sanitizePlayerPhoto(
    "data:image/jpeg;base64," + source.toString("base64"),
  );
  const b = Buffer.from(out.dataUrl.split(",")[1], "base64"),
    m = await sharp(b).metadata();
  assert.equal(m.exif, undefined);
  assert.equal(m.icc, undefined);
  assert.equal(b.includes(Buffer.from("PRIVATE-TEST")), false);
  assert.equal(m.format, "jpeg");
  await assert.rejects(
    sanitizePlayerPhoto("data:image/png;base64," + source.toString("base64")),
    (e) => e.status === 400,
  );
  await assert.rejects(
    sanitizePlayerPhoto(
      "data:image/jpeg;base64," +
        source.subarray(0, source.length - 30).toString("base64"),
    ),
    (e) => e.status === 400,
  );
  await assert.rejects(
    sanitizePlayerPhoto("https://example.test/a.jpg"),
    (e) => e.status === 400,
  );
});
test("metadata only, caption order cover deletion and restart preserve album independently from avatar", async (t) => {
  const f = await fixture(t);
  let a = await upload(f, 1);
  assert.equal(a.player.name, "合成目标");
  assert.equal(a.player.number, 8);
  assert.deepEqual(Object.keys(a.player).sort(), [
    "id",
    "name",
    "number",
    "status",
  ]);
  const first = a.photos[0].id;
  assert.equal(a.coverPhotoId, first);
  assert.equal(a.photos[0].dataUrl, undefined);
  a = await upload(f, a.revision, "upload-request-0002");
  const second = a.photos[1].id;
  a = f.store.order(admin, "p", {
    revision: a.revision,
    photoIds: [second, first],
  });
  assert.equal(a.photos[0].id, second);
  a = f.store.caption(admin, "p", first, {
    revision: a.revision,
    caption: "新说明",
  });
  a = f.store.cover(admin, "p", { revision: a.revision, photoId: first });
  a = f.store.remove(admin, "p", first, { revision: a.revision });
  assert.equal(a.coverPhotoId, second);
  assert.throws(
    () => f.store.get(admin, "p", first),
    (e) => e.status === 404,
  );
  assert.equal(
    f.db
      .prepare("SELECT data_url FROM club_player_photos WHERE id=?")
      .get(first).data_url,
    null,
  );
  assert.equal(
    f.db.prepare("SELECT avatar FROM club_players WHERE id='p'").get().avatar,
    "unchanged",
  );
  const reopened = new DatabaseSync(f.file);
  try {
    const s = createPlayerMediaStore(reopened);
    assert.deepEqual(s.list(admin, "p"), a);
  } finally {
    reopened.close();
  }
});
test("same request replay precedes revision; changed caption or deleted upload cannot replay", async (t) => {
  const f = await fixture(t);
  let a = await upload(f, 1);
  assert.deepEqual(await upload(f, 1), a);
  await assert.rejects(
    upload(f, 1, "upload-request-0001", "不同"),
    (e) => e.status === 409,
  );
  f.store.remove(admin, "p", a.photos[0].id, { revision: a.revision });
  await assert.rejects(upload(f, 1), (e) => e.status === 409);
});
test("same-team reads, cross-team and player writes denied, archived readers denied", async (t) => {
  const f = await fixture(t);
  const a = await upload(f, 1);
  assert.equal(f.store.list(member, "p").photos.length, 1);
  assert.ok(f.store.get(member, "p", a.photos[0].id).dataUrl);
  assert.throws(
    () => f.store.list(other, "p"),
    (e) => e.status === 404,
  );
  await assert.rejects(
    f.store.add(
      member,
      "p",
      {
        revision: a.revision,
        requestId: "upload-player-0001",
        dataUrl: f.image,
      },
      () => member,
    ),
    (e) => e.status === 403,
  );
  assert.throws(
    () => f.store.cover(member, "p", { revision: a.revision, photoId: null }),
    (e) => e.status === 403,
  );
  f.db
    .prepare("UPDATE club_players SET status='inactive' WHERE id='reader'")
    .run();
  assert.throws(
    () => f.store.list(member, "p"),
    (e) => e.status === 403,
  );
});
test("reauthentication after async decode prevents revoked-session write", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.store.add(
      admin,
      "p",
      { revision: 1, requestId: "upload-request-0001", dataUrl: f.image },
      () => {
        throw Object.assign(new Error("revoked"), { status: 401 });
      },
    ),
    (e) => e.status === 401,
  );
  assert.equal(f.store.list(admin, "p").photos.length, 0);
});
test("concurrent uploads CAS one success; invalid order rollback; nine photo cap", async (t) => {
  const f = await fixture(t);
  const r = await Promise.allSettled([
    upload(f, 1, "upload-request-0001"),
    upload(f, 1, "upload-request-0002"),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(r.find((x) => x.status === "rejected").reason.status, 409);
  let a = f.store.list(admin, "p");
  assert.throws(
    () => f.store.order(admin, "p", { revision: a.revision, photoIds: [] }),
    (e) => e.status === 400,
  );
  assert.deepEqual(f.store.list(admin, "p"), a);
  for (let i = 2; i <= 9; i++)
    a = await upload(f, a.revision, "extra-upload-request-" + i);
  await assert.rejects(
    upload(f, a.revision, "extra-upload-request-10"),
    (e) => e.status === 400,
  );
  assert.equal(f.store.list(admin, "p").photos.length, 9);
});

test("archived target is hidden from members but remains administrable; deletion clears captions", async (t) => {
  const f = await fixture(t);
  let a = await upload(f, 1);
  const pid = a.photos[0].id;
  f.db.prepare("UPDATE club_players SET status='inactive' WHERE id='p'").run();
  assert.throws(
    () => f.store.list(member, "p"),
    (e) => e.status === 404,
  );
  assert.throws(
    () => f.store.get(member, "p", pid),
    (e) => e.status === 404,
  );
  assert.equal(f.store.list(admin, "p").photos.length, 1);
  f.store.remove(admin, "p", pid, { revision: a.revision });
  const r = f.db
    .prepare(
      "SELECT data_url,caption,original_caption,source_hash FROM club_player_photos WHERE id=?",
    )
    .get(pid);
  assert.equal(r.data_url, null);
  for (const k of ["caption", "original_caption", "source_hash"])
    assert.equal(r[k], "");
});

test("write rechecks administrator identity after decode", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.store.add(
      admin,
      "p",
      { revision: 1, requestId: "revoked-admin-upload", dataUrl: f.image },
      () => {
        f.db.prepare("DELETE FROM club_users WHERE id=1").run();
        return admin;
      },
    ),
    (e) => e.status === 401,
  );
  assert.equal(
    f.db.prepare("SELECT COUNT(*) AS n FROM club_player_photos").get().n,
    0,
  );
});

function pngChunk(type, data) {
  const name = Buffer.from(type),
    payload = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const b of payload) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
const pngUrl = (b) => "data:image/png;base64," + b.toString("base64");
async function tinyPng() {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 1, g: 2, b: 3, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
}
test("transparent source becomes actual white pixels and oversized input is rejected", async () => {
  const src = await tinyPng(),
    clean = await sanitizePlayerPhoto(pngUrl(src));
  const pixels = await sharp(Buffer.from(clean.dataUrl.split(",")[1], "base64"))
    .raw()
    .toBuffer();
  assert.ok([...pixels].every((v) => v >= 250));
  await assert.rejects(
    sanitizePlayerPhoto(pngUrl(Buffer.alloc(2 * 1024 * 1024 + 1))),
    (e) => e.status === 400,
  );
  const wide = await sharp({
    create: { width: 8193, height: 1, channels: 3, background: "#000" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    sanitizePlayerPhoto(pngUrl(wide)),
    (e) => e.status === 400,
  );
});
test("CRC-correct two-frame APNG is rejected; huge declared pixels and chunk truncation are rejected", async () => {
  const src = await tinyPng(),
    chunks = [];
  for (let i = 8; i < src.length; ) {
    const n = src.readUInt32BE(i);
    chunks.push({
      type: src.toString("ascii", i + 4, i + 8),
      data: src.subarray(i + 8, i + 8 + n),
    });
    i += n + 12;
  }
  const ihdr = chunks.find((c) => c.type === "IHDR").data,
    idat = Buffer.concat(
      chunks.filter((c) => c.type === "IDAT").map((c) => c.data),
    );
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2);
  function frame(seq) {
    const b = Buffer.alloc(26);
    b.writeUInt32BE(seq);
    b.writeUInt32BE(2, 4);
    b.writeUInt32BE(2, 8);
    b.writeUInt16BE(1, 20);
    b.writeUInt16BE(10, 22);
    return b;
  }
  const seq = Buffer.alloc(4);
  seq.writeUInt32BE(2);
  const apng = Buffer.concat([
    src.subarray(0, 8),
    pngChunk("IHDR", ihdr),
    pngChunk("acTL", actl),
    pngChunk("fcTL", frame(0)),
    pngChunk("IDAT", idat),
    pngChunk("fcTL", frame(1)),
    pngChunk("fdAT", Buffer.concat([seq, idat])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  await assert.rejects(
    sanitizePlayerPhoto(pngUrl(apng)),
    (e) => e.status === 400 && /APNG/.test(e.message),
  );
  const huge = Buffer.from(ihdr);
  huge.writeUInt32BE(6000, 0);
  huge.writeUInt32BE(6000, 4);
  await assert.rejects(
    sanitizePlayerPhoto(
      pngUrl(
        Buffer.concat([
          src.subarray(0, 8),
          pngChunk("IHDR", huge),
          pngChunk("IDAT", idat),
          pngChunk("IEND", Buffer.alloc(0)),
        ]),
      ),
    ),
    (e) => e.status === 400,
  );
  await assert.rejects(
    sanitizePlayerPhoto(pngUrl(src.subarray(0, src.length - 2))),
    (e) => e.status === 400,
  );
});
test("third decode receives 429 and capacity is released after both success and decoder error", async () => {
  const url = pngUrl(await tinyPng());
  const first = sanitizePlayerPhoto(url),
    second = sanitizePlayerPhoto(url);
  await assert.rejects(sanitizePlayerPhoto(url), (e) => e.status === 429);
  await Promise.all([first, second]);
  await sanitizePlayerPhoto(url);
  const invalid =
    "data:image/jpeg;base64," +
    Buffer.from([255, 216, 0, 1, 2, 3, 255, 217]).toString("base64");
  await assert.rejects(sanitizePlayerPhoto(invalid), (e) => e.status === 400);
  assert.equal(
    (await Promise.all([sanitizePlayerPhoto(url), sanitizePlayerPhoto(url)]))
      .length,
    2,
  );
});
