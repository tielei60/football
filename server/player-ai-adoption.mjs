import { createHash } from "node:crypto";
import { FootballError } from "./football-store.mjs";
const fail = (status, message) => {
  throw new FootballError(status, message);
};

// 仅供可信编排层在其 BEGIN IMMEDIATE 中调用；不得独立暴露为 HTTP 写入口。
// photo 必须已由候选层完整解码、清洗，所有权/同意/用途/候选CAS由调用层同事务校验。
export function applyPlayerAiAdoption({
  db,
  user,
  playerId,
  target,
  targetRevision,
  photo,
  provenance,
  requestId,
}) {
  const q = (sql) => db.prepare(sql);
  const fresh = q("SELECT * FROM club_users WHERE id=? AND team_id=?").get(
    user.id,
    user.team_id,
  );
  const player = q("SELECT * FROM club_players WHERE team_id=? AND id=?").get(
    user.team_id,
    playerId,
  );
  if (!fresh || fresh.role !== "admin") fail(403, "此操作需要有效管理员身份。");
  if (!player || player.status !== "active") fail(404, "未找到在队球员。");
  const kind = provenance?.originKind;
  if (!["local-simulation", "ai-generated"].includes(kind))
    fail(400, "生成来源标记无效。");
  if (
    !photo ||
    photo.mimeType !== "image/jpeg" ||
    !photo.dataUrl?.startsWith("data:image/jpeg;base64,") ||
    !Number.isSafeInteger(photo.byteSize) ||
    photo.byteSize < 1 ||
    photo.byteSize > 2 * 1024 * 1024
  )
    fail(400, "候选图片未完成安全处理。");
  if (!Number.isSafeInteger(targetRevision)) fail(400, "采用版本无效。");
  if (target === "avatar") {
    if (targetRevision !== player.revision)
      fail(409, "球员资料已变化，请重新核对。");
    q(
      "UPDATE club_players SET avatar=?,avatar_origin_kind=?,revision=revision+1 WHERE team_id=? AND id=?",
    ).run(photo.dataUrl, kind, user.team_id, playerId);
    if (user.team_id === 1) {
      q("UPDATE team_players SET portrait=? WHERE player_id=?").run(
        JSON.stringify(photo.dataUrl),
        playerId,
      );
      q(
        "UPDATE coaching_desks SET edition=edition+1,saved_at=? WHERE desk_id=1",
      ).run(Date.now());
    }
    return { target, revision: player.revision + 1, originKind: kind };
  }
  if (target !== "cover") fail(400, "不支持的采用目标。");
  const album = q(
    "SELECT * FROM club_player_albums WHERE team_id=? AND player_id=?",
  ).get(user.team_id, playerId) ?? { revision: 1 };
  if (targetRevision !== album.revision)
    fail(409, "照片集已变化，请重新核对。");
  const count = q(
    "SELECT COUNT(*) AS n,MAX(sort_order) AS last FROM club_player_photos WHERE team_id=? AND player_id=? AND is_deleted=0",
  ).get(user.team_id, playerId);
  if (count.n >= 9) fail(409, "照片集已达9张，请先整理后再采用。");
  if (typeof requestId !== "string" || requestId.length > 128 || !requestId)
    fail(400, "采用请求编号无效。");
  q(
    "INSERT OR IGNORE INTO club_player_albums(team_id,player_id) VALUES (?,?)",
  ).run(user.team_id, playerId);
  const caption = kind === "local-simulation" ? "本地模拟图" : "AI生成图片";
  const photoId = Number(
    q(
      "INSERT INTO club_player_photos(team_id,player_id,request_id,source_hash,original_caption,caption,mime_type,byte_size,width,height,data_url,created_at,sort_order,origin_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      user.team_id,
      playerId,
      `ai:${requestId}`,
      createHash("sha256").update(photo.dataUrl).digest("hex"),
      caption,
      caption,
      photo.mimeType,
      photo.byteSize,
      photo.width,
      photo.height,
      photo.dataUrl,
      Date.now(),
      count.last === null ? 0 : count.last + 1,
      kind,
    ).lastInsertRowid,
  );
  q(
    "UPDATE club_player_albums SET revision=revision+1,cover_photo_id=? WHERE team_id=? AND player_id=?",
  ).run(photoId, user.team_id, playerId);
  return { target, revision: album.revision + 1, photoId, originKind: kind };
}
