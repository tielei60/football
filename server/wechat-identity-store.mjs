import { randomBytes } from "node:crypto";
import { FootballError } from "./football-store.mjs";
import { createWechatInviteStore } from "./wechat-invite-store.mjs";
const fail = (status, message) => {
  throw new FootballError(status, message);
};

// 与 club_users 共用同一数据库及事务；即使功能关闭也保留撤销与旧库迁移能力。
export function migrateWechatIdentity(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const add = (table, name, definition) => {
      if (
        !db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((c) => c.name === name)
      )
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    add(
      "club_users",
      "password_enabled",
      "INTEGER NOT NULL DEFAULT 1 CHECK(password_enabled IN (0,1))",
    );
    add(
      "club_sessions",
      "auth_method",
      "TEXT NOT NULL DEFAULT 'password' CHECK(auth_method IN ('password','wechat'))",
    );
    add("club_sessions", "wechat_identity_id", "INTEGER");
    add("club_sessions", "wechat_revision", "INTEGER");
    db.exec(`CREATE TABLE IF NOT EXISTS club_wechat_identities (
      id INTEGER PRIMARY KEY, app_id TEXT NOT NULL, openid TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES club_users(id), revision INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL, revoked_at INTEGER, UNIQUE(app_id,openid)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS club_wechat_active_user ON club_wechat_identities(app_id,user_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS club_wechat_epoch (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL) STRICT;
    INSERT OR IGNORE INTO club_wechat_epoch VALUES(1,1);
    INSERT OR IGNORE INTO app_migrations(migration_name,applied_at) VALUES('club-wechat-identity-v1',unixepoch()*1000);`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function revokeWechatPlayer(db, teamId, playerId) {
  // 调用方已处于 club 归档事务。全局代次也覆盖交换前尚未知 openid 的 ABA。
  db.prepare(
    "UPDATE club_wechat_epoch SET revision=revision+1 WHERE id=1",
  ).run();
  db.prepare(
    `UPDATE club_wechat_identities SET revoked_at=?,revision=revision+1 WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM club_users WHERE team_id=? AND player_id=?)`,
  ).run(Date.now(), teamId, playerId);
  if (
    db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='wechat_invites_foundation'",
      )
      .get()
  )
    db.prepare(
      "UPDATE wechat_invites_foundation SET status='revoked',revision=revision+1 WHERE team_id=? AND player_id=? AND status IN ('pending','claimed')",
    ).run(teamId, playerId);
  db.prepare(
    "DELETE FROM club_sessions WHERE user_id IN (SELECT id FROM club_users WHERE team_id=? AND player_id=?)",
  ).run(teamId, playerId);
}
export function createWechatIdentityStore(
  db,
  { provider, appId, authenticate, issueSession, getPlayer },
) {
  const enabled = provider?.enabled === true;
  const q = (sql) => db.prepare(sql);
  const guard = () => {
    if (!enabled) fail(503, "微信认证尚未启用。");
  };
  const epoch = () =>
    q("SELECT revision FROM club_wechat_epoch WHERE id=1").get().revision;
  const checkEpoch = (expected) => {
    if (expected !== epoch()) fail(409, "微信认证状态已变化，请重新操作。");
  };
  const tx = (work) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = work();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const admin = (actor, playerId, active = true) => {
    const u = authenticate(actor?.token, actor?.transport);
    if (u.role !== "admin") fail(403, "此操作需要管理员权限。");
    const p = getPlayer(u.team_id, playerId);
    if (active && p.status !== "active") fail(409, "该球员已归档。");
    return u;
  };
  const verified = (identity) => {
    if (!provider.isVerifiedIdentity(identity) || identity.appId !== appId)
      fail(401, "微信身份验证未通过。");
  };
  const invites = enabled
    ? createWechatInviteStore(db, {
        enabled,
        isVerifiedIdentity: provider.isVerifiedIdentity,
        authorize: ({ actor, teamId, playerId }) => {
          const u = admin(actor, playerId);
          if (u.team_id !== teamId) fail(403, "没有管理该球员邀请的权限。");
          return {
            actorId: u.id,
            teamId: u.team_id,
            playerId,
            role: u.role,
            active: true,
          };
        },
        bindIdentity: ({ appId: app, openid, teamId, playerId }) => {
          if (app !== appId || getPlayer(teamId, playerId).status !== "active")
            fail(409, "绑定对象已变化。");
          let user = q(
            "SELECT * FROM club_users WHERE team_id=? AND player_id=?",
          ).get(teamId, playerId);
          if (user && user.role !== "player")
            fail(409, "不能变更管理员的身份绑定。");
          const existing = q(
            "SELECT * FROM club_wechat_identities WHERE app_id=? AND openid=?",
          ).get(appId, openid);
          if (
            existing &&
            (existing.revoked_at === null ||
              !user ||
              existing.user_id !== user.id)
          )
            fail(409, "该微信身份不可绑定此球员。");
          if (
            user &&
            q(
              "SELECT 1 FROM club_wechat_identities WHERE app_id=? AND user_id=? AND revoked_at IS NULL",
            ).get(appId, user.id)
          )
            fail(409, "该球员已有微信绑定。");
          if (!user) {
            const result = q(
              "INSERT INTO club_users(team_id,username,password_hash,password_enabled,role,player_id) VALUES(?,?,?,0,'player',?)",
            ).run(
              teamId,
              `wechat_${randomBytes(24).toString("hex")}`,
              `disabled_${randomBytes(32).toString("hex")}`,
              playerId,
            );
            user = q("SELECT * FROM club_users WHERE id=?").get(
              result.lastInsertRowid,
            );
          }
          const nextRevision = q(
            "SELECT COALESCE(MAX(revision),0)+1 AS n FROM club_wechat_identities WHERE app_id=? AND user_id=?",
          ).get(appId, user.id).n;
          if (existing)
            q(
              "UPDATE club_wechat_identities SET revoked_at=NULL,revision=?,created_at=? WHERE id=?",
            ).run(nextRevision, Date.now(), existing.id);
          else
            q(
              "INSERT INTO club_wechat_identities(app_id,openid,user_id,created_at,revision) VALUES(?,?,?,?,?)",
            ).run(appId, openid, user.id, Date.now(), nextRevision);
          q(
            "UPDATE club_wechat_epoch SET revision=revision+1 WHERE id=1",
          ).run();
          return { userId: user.id };
        },
      })
    : null;
  if (invites) invites.initialize();
  return {
    enabled,
    epoch,
    checkEpoch,
    create(actor, playerId, input) {
      guard();
      const u = admin(actor, playerId);
      const replay =
        typeof input.requestId === "string" &&
        q(
          "SELECT 1 FROM wechat_invites_foundation WHERE actor_id=? AND request_id=?",
        ).get(u.id, input.requestId);
      if (
        !replay &&
        q(
          "SELECT 1 FROM club_wechat_identities w JOIN club_users u ON u.id=w.user_id WHERE w.app_id=? AND w.revoked_at IS NULL AND u.team_id=? AND u.player_id=?",
        ).get(appId, u.team_id, playerId)
      )
        fail(409, "该球员已有微信绑定，请先核对解绑。");
      return invites.create(actor, {
        ...input,
        teamId: u.team_id,
        playerId,
        appId,
      });
    },
    list(actor, playerId, input) {
      guard();
      const u = admin(actor, playerId);
      return invites.list(actor, {
        ...input,
        teamId: u.team_id,
        playerId,
        appId,
      });
    },
    decide(actor, playerId, id, input, action) {
      guard();
      const u = admin(actor, playerId);
      const target = invites.inspect(actor, id);
      if (
        target.playerId !== playerId ||
        target.teamId !== u.team_id ||
        target.appId !== appId
      )
        fail(404, "邀请不存在。");
      return invites.decide(actor, { ...input, id, action });
    },
    claim(identity, input, expected) {
      guard();
      verified(identity);
      checkEpoch(expected);
      return invites.claim(identity, input);
    },
    status(identity, id, expected) {
      guard();
      verified(identity);
      checkEpoch(expected);
      return invites.claimStatus(identity, id);
    },
    login(identity, expected) {
      guard();
      verified(identity);
      return tx(() => {
        checkEpoch(expected);
        const binding = q(
          "SELECT * FROM club_wechat_identities WHERE app_id=? AND openid=? AND revoked_at IS NULL",
        ).get(appId, identity.openid);
        if (!binding) fail(403, "尚未绑定，请联系管理员完成邀请审核。");
        const user = q("SELECT * FROM club_users WHERE id=?").get(
          binding.user_id,
        );
        if (
          !user ||
          !user.player_id ||
          !["player", "admin"].includes(user.role) ||
          user.is_system_admin === 1 ||
          user.account_enabled !== 1 ||
          getPlayer(user.team_id, user.player_id).status !== "active"
        )
          fail(403, "该球员账户不可用。");
        return issueSession(user, "native", binding);
      });
    },
    binding(actor, playerId) {
      guard();
      const u = admin(actor, playerId, false);
      const row = q(
        "SELECT w.* FROM club_wechat_identities w JOIN club_users u ON u.id=w.user_id WHERE w.app_id=? AND u.team_id=? AND u.player_id=? ORDER BY (w.revoked_at IS NULL) DESC,w.revision DESC,w.id DESC LIMIT 1",
      ).get(appId, u.team_id, playerId);
      const account = q(
        "SELECT password_enabled FROM club_users WHERE team_id=? AND player_id=?",
      ).get(u.team_id, playerId);
      return {
        accountExists: !!account,
        passwordEnabled: account?.password_enabled === 1,
        bound: !!row && row.revoked_at === null,
        revision: row?.revision ?? 0,
        ...(row ? { createdAt: row.created_at } : {}),
      };
    },
    unbind(actor, playerId, input) {
      guard();
      return tx(() => {
        const u = admin(actor, playerId, false),
          current = this.binding(actor, playerId);
        if (
          !Number.isSafeInteger(input.revision) ||
          input.revision !== current.revision
        )
          fail(409, "绑定已变化，请刷新核对。");
        revokeWechatPlayer(db, u.team_id, playerId);
        return this.binding(actor, playerId);
      });
    },
  };
}
