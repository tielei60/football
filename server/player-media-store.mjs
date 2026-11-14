import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { FootballError } from "./football-store.mjs";
const require = createRequire(new URL("../app/package.json", import.meta.url));
const MAX = 2 * 1024 * 1024,
  fail = (s, m) => {
    throw new FootballError(s, m);
  },
  hash = (b) => createHash("sha256").update(b).digest("hex");
const object = (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    fail(400, "照片参数不正确。");
};
const caption = (v) => {
  if (typeof v !== "string" || v.length > 200) fail(400, "照片说明最多200字。");
  return v.trim();
};
let activeDecodes = 0;
export async function sanitizePlayerPhoto(value) {
  if (typeof value !== "string" || value.length > Math.ceil(MAX / 3) * 4 + 40)
    fail(400, "照片不能超过2 MiB。");
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!m) fail(400, "仅支持静态PNG或JPG照片，不支持外部链接。");
  const bytes = Buffer.from(m[2], "base64");
  if (!bytes.length || bytes.length > MAX || bytes.toString("base64") !== m[2])
    fail(400, "照片编码或大小无效。");
  if (m[1] === "png") {
    if (
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      fail(400, "PNG照片内容无效。");
    let offset = 8,
      ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset),
        end = offset + 12 + length;
      if (end > bytes.length) fail(400, "PNG照片数据截断。");
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (type === "acTL") fail(400, "不支持APNG动画，请上传静态照片。");
      offset = end;
      if (type === "IEND") {
        if (length !== 0 || offset !== bytes.length)
          fail(400, "PNG照片结束数据无效。");
        ended = true;
        break;
      }
    }
    if (!ended) fail(400, "PNG照片数据不完整。");
  }
  if (activeDecodes >= 2) fail(429, "照片处理中，请稍后重试。");
  activeDecodes++;
  try {
    const sharp = require("sharp");
    const options = {
      failOn: "warning",
      limitInputPixels: 32000000,
      animated: false,
    };
    const meta = await sharp(bytes, options)
      .timeout({ seconds: 15 })
      .metadata();
    if (
      meta.format !== (m[1] === "jpeg" ? "jpeg" : "png") ||
      (meta.pages || 1) !== 1 ||
      !meta.width ||
      !meta.height ||
      meta.width > 8192 ||
      meta.height > 8192 ||
      meta.width * meta.height > 32000000
    )
      fail(400, "照片格式或尺寸不支持。");
    // 完整解码后以无元数据raw重新编码；透明像素固定白底，保留EXIF方向的视觉效果。
    const raw = await sharp(bytes, options)
      .timeout({ seconds: 15 })
      .rotate()
      .flatten({ background: "#ffffff" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const output = await sharp(raw.data, {
      raw: {
        width: raw.info.width,
        height: raw.info.height,
        channels: raw.info.channels,
      },
    })
      .timeout({ seconds: 15 })
      .jpeg({ quality: 88, mozjpeg: false })
      .toBuffer();
    if (output.length > MAX) fail(400, "处理后照片超过2 MiB，请缩小后重试。");
    return {
      dataUrl: "data:image/jpeg;base64," + output.toString("base64"),
      mimeType: "image/jpeg",
      byteSize: output.length,
      width: raw.info.width,
      height: raw.info.height,
      sourceHash: hash(bytes),
    };
  } catch (e) {
    if (e instanceof FootballError) throw e;
    fail(400, "照片无法完整解码，请使用有效的静态PNG或JPG。");
  } finally {
    activeDecodes--;
  }
}
export function createPlayerMediaStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS club_player_albums(team_id INTEGER NOT NULL,player_id TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,cover_photo_id INTEGER,PRIMARY KEY(team_id,player_id),FOREIGN KEY(team_id,player_id) REFERENCES club_players(team_id,id)) STRICT;
 CREATE TABLE IF NOT EXISTS club_player_photos(id INTEGER PRIMARY KEY,team_id INTEGER NOT NULL,player_id TEXT NOT NULL,request_id TEXT NOT NULL,source_hash TEXT NOT NULL,original_caption TEXT NOT NULL,caption TEXT NOT NULL,mime_type TEXT NOT NULL,byte_size INTEGER NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,data_url TEXT,created_at INTEGER NOT NULL,sort_order INTEGER NOT NULL,is_deleted INTEGER NOT NULL DEFAULT 0,UNIQUE(team_id,player_id,request_id),FOREIGN KEY(team_id,player_id) REFERENCES club_players(team_id,id)) STRICT;`);
  if (
    !db
      .prepare("PRAGMA table_info(club_player_photos)")
      .all()
      .some((c) => c.name === "origin_kind")
  )
    db.exec(
      "ALTER TABLE club_player_photos ADD COLUMN origin_kind TEXT CHECK(origin_kind IS NULL OR origin_kind IN ('local-simulation','ai-generated'))",
    );
  const q = (s) => db.prepare(s),
    tx = (fn) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const x = fn();
        db.exec("COMMIT");
        return x;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    };
  function allowed(u, id, write = false) {
    const user = q("SELECT * FROM club_users WHERE id=? AND team_id=?").get(
      u.id,
      u.team_id,
    );
    if (!user || user.role !== u.role) fail(401, "请重新登录。");
    if (
      user.player_id &&
      q("SELECT status FROM club_players WHERE id=? AND team_id=?").get(
        user.player_id,
        user.team_id,
      )?.status !== "active"
    )
      fail(403, "球员账户已停用。");
    if (write && user.role !== "admin") fail(403, "此操作需要管理员权限。");
    const target = q(
      "SELECT id,status FROM club_players WHERE id=? AND team_id=?",
    ).get(id, user.team_id);
    if (!target) fail(404, "未找到球员。");
    if (target.status !== "active" && user.role !== "admin")
      fail(404, "未找到可见的球员照片集。");
  }
  function album(u, id) {
    return (
      q(
        "SELECT revision,cover_photo_id FROM club_player_albums WHERE team_id=? AND player_id=?",
      ).get(u.team_id, id) || { revision: 1, cover_photo_id: null }
    );
  }
  function list(u, id) {
    allowed(u, id);
    const a = album(u, id);
    return {
      player: q(
        "SELECT id,name,number,status FROM club_players WHERE team_id=? AND id=?",
      ).get(u.team_id, id),
      revision: a.revision,
      coverPhotoId: a.cover_photo_id,
      photos: q(
        "SELECT id,caption,mime_type AS mimeType,byte_size AS byteSize,width,height,created_at AS createdAt,sort_order AS sortOrder,origin_kind AS originKind FROM club_player_photos WHERE team_id=? AND player_id=? AND is_deleted=0 ORDER BY sort_order,id",
      )
        .all(u.team_id, id)
        .map((p) => ({
          ...p,
          generated: Boolean(p.originKind),
          aiGenerated: p.originKind === "ai-generated",
          simulation: p.originKind === "local-simulation",
        })),
    };
  }
  function row(u, id, pid) {
    const p = q(
      "SELECT * FROM club_player_photos WHERE team_id=? AND player_id=? AND id=? AND is_deleted=0",
    ).get(u.team_id, id, pid);
    if (!p) fail(404, "未找到球员照片。");
    return p;
  }
  function mutate(u, id, b, fn) {
    object(b);
    return tx(() => {
      allowed(u, id, true);
      const a = album(u, id);
      if (!Number.isSafeInteger(b.revision) || b.revision !== a.revision)
        fail(409, "照片集已更新，请重新载入核对。");
      q(
        "INSERT OR IGNORE INTO club_player_albums(team_id,player_id) VALUES (?,?)",
      ).run(u.team_id, id);
      fn(a);
      q(
        "UPDATE club_player_albums SET revision=revision+1 WHERE team_id=? AND player_id=?",
      ).run(u.team_id, id);
      return list(u, id);
    });
  }
  function replay(u, id, b, sourceHash, c) {
    const old = q(
      "SELECT * FROM club_player_photos WHERE team_id=? AND player_id=? AND request_id=?",
    ).get(u.team_id, id, b.requestId);
    if (!old) return null;
    if (
      old.source_hash !== sourceHash ||
      old.original_caption !== c ||
      old.is_deleted
    )
      fail(409, "上传任务已使用或照片已删除，请核对照片集。");
    return list(u, id);
  }
  return {
    list,
    get(u, id, pid) {
      allowed(u, id);
      return { dataUrl: row(u, id, pid).data_url };
    },
    async add(u, id, b, reauthenticate) {
      object(b);
      allowed(u, id, true);
      if (
        typeof b.requestId !== "string" ||
        !/^[-a-zA-Z0-9]{16,100}$/.test(b.requestId)
      )
        fail(400, "缺少有效上传任务编号。");
      const c = caption(b.caption ?? "");
      const photo = await sanitizePlayerPhoto(b.dataUrl);
      u = reauthenticate();
      allowed(u, id, true);
      return tx(() => {
        const prior = replay(u, id, b, photo.sourceHash, c);
        if (prior) return prior;
        const a = album(u, id);
        if (!Number.isSafeInteger(b.revision) || b.revision !== a.revision)
          fail(409, "照片集已更新，请重新载入核对。");
        const all = list(u, id).photos;
        if (all.length >= 9) fail(400, "最多保存9张球员照片。");
        q(
          "INSERT OR IGNORE INTO club_player_albums(team_id,player_id) VALUES (?,?)",
        ).run(u.team_id, id);
        const pid = Number(
          q(
            "INSERT INTO club_player_photos(team_id,player_id,request_id,source_hash,original_caption,caption,mime_type,byte_size,width,height,data_url,created_at,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          ).run(
            u.team_id,
            id,
            b.requestId,
            photo.sourceHash,
            c,
            c,
            photo.mimeType,
            photo.byteSize,
            photo.width,
            photo.height,
            photo.dataUrl,
            Date.now(),
            all.length ? Math.max(...all.map((p) => p.sortOrder)) + 1 : 0,
          ).lastInsertRowid,
        );
        q(
          "UPDATE club_player_albums SET revision=revision+1,cover_photo_id=COALESCE(cover_photo_id,?) WHERE team_id=? AND player_id=?",
        ).run(pid, u.team_id, id);
        return list(u, id);
      });
    },
    caption(u, id, pid, b) {
      const c = caption(b?.caption);
      return mutate(u, id, b, () => {
        row(u, id, pid);
        q("UPDATE club_player_photos SET caption=? WHERE id=?").run(c, pid);
      });
    },
    cover(u, id, b) {
      return mutate(u, id, b, () => {
        if (b.photoId !== null) {
          if (!Number.isSafeInteger(b.photoId)) fail(400, "封面编号无效。");
          row(u, id, b.photoId);
        }
        q(
          "UPDATE club_player_albums SET cover_photo_id=? WHERE team_id=? AND player_id=?",
        ).run(b.photoId, u.team_id, id);
      });
    },
    order(u, id, b) {
      return mutate(u, id, b, () => {
        const all = list(u, id).photos.map((p) => p.id);
        if (
          !Array.isArray(b.photoIds) ||
          b.photoIds.length !== all.length ||
          new Set(b.photoIds).size !== all.length ||
          b.photoIds.some((p) => !Number.isSafeInteger(p) || !all.includes(p))
        )
          fail(400, "请提供完整且不重复的照片顺序。");
        b.photoIds.forEach((p, i) =>
          q("UPDATE club_player_photos SET sort_order=? WHERE id=?").run(i, p),
        );
      });
    },
    remove(u, id, pid, b) {
      return mutate(u, id, b, (a) => {
        row(u, id, pid);
        q(
          "UPDATE club_player_photos SET is_deleted=1,data_url=NULL,caption='',original_caption='',source_hash='' WHERE id=?",
        ).run(pid);
        if (a.cover_photo_id === pid) {
          const next = q(
            "SELECT id FROM club_player_photos WHERE team_id=? AND player_id=? AND is_deleted=0 ORDER BY sort_order,id LIMIT 1",
          ).get(u.team_id, id);
          q(
            "UPDATE club_player_albums SET cover_photo_id=? WHERE team_id=? AND player_id=?",
          ).run(next?.id ?? null, u.team_id, id);
        }
      });
    },
  };
}
