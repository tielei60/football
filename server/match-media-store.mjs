import { createHash } from "node:crypto";
import { FootballError } from "./football-store.mjs";
const fail = (status, message) => {
  throw new FootballError(status, message);
};
const MAX_BYTES = 2 * 1024 * 1024;
const metadata = (r) => ({
  id: r.id,
  caption: r.caption,
  mimeType: r.mime_type,
  byteSize: r.byte_size,
  createdAt: r.created_at,
});
function image(value) {
  if (
    typeof value !== "string" ||
    value.length > 4 * Math.ceil(MAX_BYTES / 3) + 40
  )
    fail(400, "照片不能超过 2 MiB。");
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!m) fail(400, "照片仅支持 PNG 或 JPG，不支持外部链接。");
  const b = Buffer.from(m[2], "base64");
  if (!b.length || b.length > MAX_BYTES || b.toString("base64") !== m[2])
    fail(400, "照片编码或大小不正确。");
  let width = 0,
    height = 0;
  if (m[1] === "png") {
    if (
      b.length < 33 ||
      !b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      b.toString("ascii", 12, 16) !== "IHDR"
    )
      fail(400, "PNG 照片内容无效。");
    width = b.readUInt32BE(16);
    height = b.readUInt32BE(20);
  } else {
    if (
      b.length < 4 ||
      b[0] !== 255 ||
      b[1] !== 216 ||
      b[b.length - 2] !== 255 ||
      b[b.length - 1] !== 217
    )
      fail(400, "JPG 照片内容无效。");
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i++] !== 255) break;
      while (b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 2 > b.length) break;
      const n = b.readUInt16BE(i);
      if (n < 2 || i + n > b.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        n >= 8
      ) {
        height = b.readUInt16BE(i + 3);
        width = b.readUInt16BE(i + 5);
        break;
      }
      i += n;
    }
  }
  if (
    !width ||
    !height ||
    width > 8192 ||
    height > 8192 ||
    width * height > 32000000
  )
    fail(400, "照片尺寸无效或过大，请缩小后上传。");
  return {
    mimeType: "image/" + m[1],
    byteSize: b.length,
    hash: createHash("sha256").update(b).digest("hex"),
  };
}
export function createMatchMediaStore(db, getMatch) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const cols = new Set(
      db
        .prepare("PRAGMA table_info(club_matches)")
        .all()
        .map((r) => r.name),
    );
    if (!cols.has("notice"))
      db.exec(
        "ALTER TABLE club_matches ADD COLUMN notice TEXT NOT NULL DEFAULT ''",
      );
    if (!cols.has("cover_photo_id"))
      db.exec("ALTER TABLE club_matches ADD COLUMN cover_photo_id INTEGER");
    db.exec(`CREATE TABLE IF NOT EXISTS club_match_photos (
   id INTEGER PRIMARY KEY,team_id INTEGER NOT NULL,match_id INTEGER NOT NULL,request_id TEXT NOT NULL,
   caption TEXT NOT NULL,mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,content_hash TEXT NOT NULL,
   data_url TEXT,created_at INTEGER NOT NULL,is_deleted INTEGER NOT NULL DEFAULT 0,
   UNIQUE(team_id,match_id,request_id),FOREIGN KEY(team_id,match_id) REFERENCES club_matches(team_id,id)
  ) STRICT; CREATE INDEX IF NOT EXISTS club_match_photos_match ON club_match_photos(team_id,match_id,is_deleted,id);`);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  function allowed(u, id, write = false) {
    if (write && u.role !== "admin") fail(403, "此操作需要管理员权限。");
    return getMatch(u, id, { includeTacticSnapshots: false });
  }
  function list(u, id) {
    const m = allowed(u, id);
    return {
      revision: m.revision,
      coverPhotoId: m.coverPhotoId,
      photos: db
        .prepare(
          "SELECT id,caption,mime_type,byte_size,created_at FROM club_match_photos WHERE team_id=? AND match_id=? AND is_deleted=0 ORDER BY id",
        )
        .all(u.team_id, id)
        .map(metadata),
    };
  }
  function row(u, id, photoId) {
    const r = db
      .prepare(
        "SELECT * FROM club_match_photos WHERE team_id=? AND match_id=? AND id=? AND is_deleted=0",
      )
      .get(u.team_id, id, photoId);
    if (!r) fail(404, "未找到比赛照片。");
    return r;
  }
  function revision(body, m) {
    if (!Number.isSafeInteger(body.revision) || body.revision < 1)
      fail(428, "请携带比赛当前版本号。");
    if (body.revision !== m.revision)
      fail(409, "比赛已更新，请重新载入后操作。");
  }
  function object(v) {
    if (!v || typeof v !== "object" || Array.isArray(v))
      fail(400, "照片资料格式不正确。");
  }
  function tx(work) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = work();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return {
    listMatchPhotos: list,
    getMatchPhoto(u, id, photoId) {
      allowed(u, id);
      const r = row(u, id, photoId);
      return { ...metadata(r), dataUrl: r.data_url };
    },
    addMatchPhoto(u, id, body) {
      allowed(u, id, true);
      object(body);
      if (
        typeof body.requestId !== "string" ||
        !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId)
      )
        fail(400, "请提供有效的照片上传请求编号。");
      const caption = body.caption === undefined ? "" : body.caption;
      if (typeof caption !== "string" || caption.length > 200)
        fail(400, "照片说明不能超过 200 字。");
      const info = image(body.dataUrl);
      return tx(() => {
        const m = allowed(u, id, true);
        const old = db
          .prepare(
            "SELECT * FROM club_match_photos WHERE team_id=? AND match_id=? AND request_id=?",
          )
          .get(u.team_id, id, body.requestId);
        if (old) {
          if (
            old.is_deleted ||
            old.content_hash !== info.hash ||
            old.caption !== caption.trim()
          )
            fail(409, "该上传请求已处理且内容不同或照片已移除，请重新核对。");
          return {
            revision: m.revision,
            coverPhotoId: m.coverPhotoId,
            photo: metadata(old),
          };
        }
        revision(body, m);
        if (list(u, id).photos.length >= 9)
          fail(400, "每场比赛最多保存 9 张照片。");
        const photoId = Number(
          db
            .prepare(
              "INSERT INTO club_match_photos(team_id,match_id,request_id,caption,mime_type,byte_size,content_hash,data_url,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              u.team_id,
              id,
              body.requestId,
              caption.trim(),
              info.mimeType,
              info.byteSize,
              info.hash,
              body.dataUrl,
              Date.now(),
            ).lastInsertRowid,
        );
        db.prepare(
          "UPDATE club_matches SET revision=revision+1,cover_photo_id=coalesce(cover_photo_id,?) WHERE team_id=? AND id=?",
        ).run(photoId, u.team_id, id);
        const current = allowed(u, id);
        return {
          revision: current.revision,
          coverPhotoId: current.coverPhotoId,
          photo: metadata(row(u, id, photoId)),
        };
      });
    },
    removeMatchPhoto(u, id, photoId, body) {
      allowed(u, id, true);
      object(body);
      return tx(() => {
        const m = allowed(u, id, true);
        revision(body, m);
        row(u, id, photoId);
        db.prepare(
          "UPDATE club_match_photos SET is_deleted=1,data_url=NULL WHERE team_id=? AND match_id=? AND id=?",
        ).run(u.team_id, id, photoId);
        const next =
          m.coverPhotoId === photoId
            ? (db
                .prepare(
                  "SELECT id FROM club_match_photos WHERE team_id=? AND match_id=? AND is_deleted=0 ORDER BY id LIMIT 1",
                )
                .get(u.team_id, id)?.id ?? null)
            : m.coverPhotoId;
        db.prepare(
          "UPDATE club_matches SET revision=revision+1,cover_photo_id=? WHERE team_id=? AND id=?",
        ).run(next, u.team_id, id);
        return list(u, id);
      });
    },
    setMatchCover(u, id, body) {
      allowed(u, id, true);
      object(body);
      return tx(() => {
        const m = allowed(u, id, true);
        revision(body, m);
        if (body.photoId !== null) {
          if (!Number.isSafeInteger(body.photoId) || body.photoId < 1)
            fail(400, "封面照片编号不正确。");
          row(u, id, body.photoId);
        }
        db.prepare(
          "UPDATE club_matches SET revision=revision+1,cover_photo_id=? WHERE team_id=? AND id=?",
        ).run(body.photoId, u.team_id, id);
        return list(u, id);
      });
    },
  };
}
