import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";
import {
  createPlayerMediaStore,
  sanitizePlayerPhoto,
} from "./player-media-store.mjs";
import { applyPlayerAiAdoption } from "./player-ai-adoption.mjs";
const sharp = createRequire(new URL("../app/package.json", import.meta.url))(
  "sharp",
);
async function fixture(t) {
  const store = openFootballStore(":memory:");
  t.after(() => store.close());
  const club = createClubStore(store.database, store, {
    bootstrapAdmin: {
      username: "fictional-owner",
      password: "fictional-password-only",
    },
  });
  const session = club.login(
    { username: "fictional-owner", password: "fictional-password-only" },
    "test",
  );
  const user = club.authenticate(session.token),
    player = club.savePlayer(user.team_id, null, {
      name: "合成队员",
      number: null,
    });
  const media = createPlayerMediaStore(store.database);
  const bytes = await sharp({
    create: { width: 10, height: 12, channels: 3, background: "#8844aa" },
  })
    .png()
    .toBuffer();
  const photo = await sanitizePlayerPhoto(
    "data:image/png;base64," + bytes.toString("base64"),
  );
  const apply = (target, revision, requestId = "fixture-adopt") => {
    store.database.exec("BEGIN IMMEDIATE");
    try {
      const result = applyPlayerAiAdoption({
        db: store.database,
        user,
        playerId: player.id,
        target,
        targetRevision: revision,
        photo,
        provenance: { originKind: "local-simulation" },
        requestId,
      });
      store.database.exec("COMMIT");
      return result;
    } catch (e) {
      store.database.exec("ROLLBACK");
      throw e;
    }
  };
  return { store, club, user, player, media, photo, apply };
}
test("模拟头像标记持久、目标CAS、普通替换清标且客户端无法伪造", async (t) => {
  const f = await fixture(t);
  f.apply("avatar", f.player.revision);
  let p = f.club.getPlayer(f.user.team_id, f.player.id);
  assert.equal(p.avatarSimulation, true);
  assert.equal(p.avatarAiGenerated, false);
  assert.equal(p.avatarOriginKind, "local-simulation");
  assert.throws(
    () => f.apply("avatar", f.player.revision),
    (e) => e.status === 409,
  );
  p = f.club.savePlayer(f.user.team_id, p.id, {
    ...p,
    name: "修改姓名保留来源",
  });
  assert.equal(p.avatarSimulation, true);
  p = f.club.savePlayer(f.user.team_id, p.id, {
    ...p,
    avatar: null,
    avatarOriginKind: "ai-generated",
  });
  assert.equal(p.avatarGenerated, false);
  assert.equal(p.avatarOriginKind, null);
});
test("明确cover采用新增并设封面、保留旧照片并执行容量及revision限制", async (t) => {
  const f = await fixture(t);
  const first = f.apply("cover", 1, "first");
  let album = f.media.list(f.user, f.player.id);
  assert.equal(album.coverPhotoId, first.photoId);
  assert.equal(album.photos[0].simulation, true);
  assert.equal(album.photos[0].aiGenerated, false);
  const next = f.apply("cover", album.revision, "second");
  album = f.media.list(f.user, f.player.id);
  assert.equal(album.photos.length, 2);
  assert.equal(album.coverPhotoId, next.photoId);
  assert.equal(f.club.getPlayer(f.user.team_id, f.player.id).avatar, null);
  assert.throws(
    () => f.apply("cover", 1, "stale"),
    (e) => e.status === 409,
  );
  for (let i = 2; i < 9; i++)
    f.apply("cover", f.media.list(f.user, f.player.id).revision, `cover-${i}`);
  assert.throws(
    () =>
      f.apply(
        "cover",
        f.media.list(f.user, f.player.id).revision,
        "over-limit",
      ),
    (e) => e.status === 409,
  );
  assert.equal(f.media.list(f.user, f.player.id).photos.length, 9);
});
test("采用事务回滚不留下头像或相册写入，归档目标拒绝", async (t) => {
  const f = await fixture(t);
  f.store.database.exec("BEGIN IMMEDIATE");
  applyPlayerAiAdoption({
    db: f.store.database,
    user: f.user,
    playerId: f.player.id,
    target: "cover",
    targetRevision: 1,
    photo: f.photo,
    provenance: { originKind: "local-simulation" },
    requestId: "rollback",
  });
  f.store.database.exec("ROLLBACK");
  assert.equal(f.media.list(f.user, f.player.id).photos.length, 0);
  f.club.savePlayer(f.user.team_id, f.player.id, {
    ...f.player,
    status: "inactive",
  });
  assert.throws(
    () => f.apply("avatar", 2),
    (e) => e.status === 404,
  );
});
