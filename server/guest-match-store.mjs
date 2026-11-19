import { randomBytes, randomUUID, createHash } from "node:crypto";
import { FootballError } from "./football-store.mjs";
import { sanitizePlayerPhoto } from "./player-media-store.mjs";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const fail = (s, message, code) => {
  const error = new FootballError(s, message);
  if (code) error.code = code;
  throw error;
};
const fields = (input, allowed, required = allowed) => {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !allowed.includes(k)) ||
    required.some((k) => input[k] === undefined)
  )
    fail(400, "比赛登记参数不正确。");
};
const text = (value, max) => {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    fail(400, "请填写有效的姓名、昵称与请求编号。");
  return value.trim();
};
const credential = (v) => {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) fail(404, "比赛分享入口无效。");
  return v;
};
export function migrateGuestMatches(db) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const columns = new Set(
      db
        .prepare("PRAGMA table_info(club_players)")
        .all()
        .map((c) => c.name)
    );
    if (!columns.has("membership_kind"))
      db.exec(
        "ALTER TABLE club_players ADD COLUMN membership_kind TEXT NOT NULL DEFAULT 'member' CHECK(membership_kind IN ('member','guest'))"
      );
    if (!columns.has("nickname")) db.exec("ALTER TABLE club_players ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
    db.exec(`CREATE TABLE IF NOT EXISTS club_match_shares (
      match_id INTEGER PRIMARY KEY REFERENCES club_matches(id), token TEXT NOT NULL UNIQUE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS club_guest_match_access (
      team_id INTEGER NOT NULL,match_id INTEGER NOT NULL,player_id TEXT NOT NULL,created_at INTEGER NOT NULL,
      PRIMARY KEY(match_id,player_id),
      FOREIGN KEY(team_id,match_id) REFERENCES club_matches(team_id,id),
      FOREIGN KEY(team_id,player_id) REFERENCES club_players(team_id,id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS club_guest_registration (
      token_hash TEXT PRIMARY KEY,match_id INTEGER NOT NULL REFERENCES club_matches(id),app_id TEXT NOT NULL,openid TEXT NOT NULL,
      identity_epoch INTEGER NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER,request_id TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS club_guest_registration_expiry ON club_guest_registration(expires_at);
    INSERT OR IGNORE INTO app_migrations(migration_name,applied_at) VALUES('club-guest-matches-v1',unixepoch()*1000);`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
export function createGuestMatchStore(
  db,
  { provider, appId, authenticate, issueSession, getPlayer, getTeam, now = Date.now }
) {
  const q = (sql) => db.prepare(sql);
  const tx = (work) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  const buckets = new Map(),
    receipts = new Map();
  let inFlight = 0;
  const limit = (type, key, maximum = 30) => {
    const time = now();
    for (const [k, b] of buckets) if (b.until <= time) buckets.delete(k);
    const k = type + ":" + hash(String(key));
    let b = buckets.get(k);
    if (!b) {
      if (buckets.size >= 10000) fail(429, "请求过多，请稍后重试。");
      b = { count: 0, until: time + 60000 };
      buckets.set(k, b);
    }
    if (++b.count > maximum) fail(429, "请求过多，请稍后重试。");
  };
  const enabled = () => {
    if (!provider?.enabled) fail(503, "微信认证尚未启用。");
  };
  const epoch = () => q("SELECT revision FROM club_wechat_epoch WHERE id=1").get().revision;
  const checkEpoch = (expected) => {
    if (epoch() !== expected) fail(409, "微信认证状态已变化，请重新登录。");
  };
  const user = (id) =>
    q(
      "SELECT u.*,p.membership_kind FROM club_users u LEFT JOIN club_players p ON p.id=u.player_id AND p.team_id=u.team_id WHERE u.id=?"
    ).get(id);
  const bound = (identity, teamId) => {
    const binding = q("SELECT * FROM club_wechat_identities WHERE app_id=? AND openid=?").get(appId, identity.openid);
    if (!binding) return null;
    const u = user(binding.user_id);
    if (
      binding.revoked_at !== null ||
      !u ||
      !u.player_id ||
      u.account_enabled !== 1 ||
      u.is_system_admin === 1 ||
      !["player", "admin"].includes(u.role) ||
      u.team_id !== teamId ||
      getPlayer(teamId, u.player_id).status !== "active"
    )
      fail(403, "该微信身份不能进入此比赛，请联系管理员核对。");
    return { u, binding };
  };
  const requireNoPendingClaim = (openid) => {
    if (
      q(
        "SELECT 1 FROM wechat_invites_foundation WHERE app_id=? AND claim_openid=? AND status='claimed' AND expires_at>?"
      ).get(appId, openid, now())
    )
      fail(409, "此微信已有待审核的球队身份，请先完成原邀请审核，避免重复球员。");
  };
  const matchFor = (token) => {
    credential(token);
    const m = q("SELECT m.* FROM club_matches m JOIN club_match_shares s ON s.match_id=m.id WHERE s.token=?").get(
      token
    );
    if (!m || m.status === "draft") fail(404, "比赛分享入口无效或比赛尚未发布。");
    return m;
  };
  const closes = (m) => Date.parse(m.match_date + "T" + (m.kickoff ? m.kickoff + ":00" : "23:59:59.999") + "+08:00");
  const open = (m) => m.status === "published" && now() < closes(m);
  const requireOpen = (m) => {
    if (!open(m)) fail(409, "本场临时报名已截止或比赛已关闭。");
  };
  const grant = (m, u) => {
    if (u.team_id !== m.team_id) fail(403, "没有此比赛的访问权限。");
    if (
      u.membership_kind === "guest" &&
      !q("SELECT 1 FROM club_guest_match_access WHERE match_id=? AND player_id=? AND team_id=?").get(
        m.id,
        u.player_id,
        u.team_id
      )
    )
      fail(403, "请从此比赛的分享入口完成微信登录。");
  };
  const view = (m, token, u = null) => {
    const rows = q("SELECT response,COUNT(*) n FROM club_rsvps WHERE match_id=? GROUP BY response").all(m.id);
    const counts = Object.fromEntries(rows.map((r) => [r.response, r.n]));
    const team = getTeam(m.team_id),
      venue = m.venue_snapshot ? JSON.parse(m.venue_snapshot) : null;
    const mine = u?.player_id
      ? (q("SELECT response FROM club_rsvps WHERE match_id=? AND player_id=?").get(m.id, u.player_id)?.response ?? null)
      : null;
    const opponent = m.opponent_snapshot ? JSON.parse(m.opponent_snapshot) : null;
    const out = {
      id: m.id,
      team: { id: team.id, name: team.name, crest: team.crest },
      opponent: m.opponent,
      opponentSnapshot: opponent
        ? {
            name: typeof opponent.name === "string" ? opponent.name : m.opponent,
            logo: typeof opponent.logo === "string" ? opponent.logo : null,
          }
        : null,
      competition: m.competition,
      date: m.match_date,
      kickoff: m.kickoff,
      format: m.format,
      side: m.side,
      location: m.location,
      venueSnapshot: venue
        ? Object.fromEntries(
            ["name", "fieldNumber", "address", "latitude", "longitude", "coordinateSystem"]
              .filter((k) => venue[k] !== undefined)
              .map((k) => [k, venue[k]])
          )
        : null,
      status: m.status,
      notice: m.notice,
      maxParticipants: m.max_participants,
      yesCount: counts.yes || 0,
      noCount: counts.no || 0,
      maybeCount: counts.maybe || 0,
      signupClosesAt: new Date(closes(m)).toISOString(),
      canRegister: open(m),
      shareToken: token,
    };
    if (u)
      Object.assign(out, {
        myResponse: mine,
        membershipKind: u.membership_kind || "member",
        canReply: !!u.player_id && m.status === "published",
        canJoin:
          !!u.player_id && m.status === "published" && (u.membership_kind !== "guest" || open(m) || mine === "yes"),
      });
    return out;
  };
  const session = (u, binding, m, token) => ({
    needsProfile: false,
    ...issueSession(u, "native", binding),
    match: view(m, token, u),
  });
  const currentActor = (actor) => authenticate(actor?.token, actor?.transport);
  return {
    shareLink(u, id) {
      if (u.membership_kind === "guest") fail(403, "临时球员只能使用已授权的比赛入口。");
      const m = q("SELECT * FROM club_matches WHERE team_id=? AND id=?").get(u.team_id, id);
      if (!m || m.status !== "published") fail(404, "只能分享已发布的比赛。");
      let saved = q("SELECT token FROM club_match_shares WHERE match_id=?").get(id);
      if (!saved) {
        q("INSERT OR IGNORE INTO club_match_shares(match_id,token) VALUES(?,?)").run(
          id,
          randomBytes(32).toString("hex")
        );
        saved = q("SELECT token FROM club_match_shares WHERE match_id=?").get(id);
      }
      return { shareToken: saved.token };
    },
    preview(token, ip) {
      limit("preview", ip || "unknown", 120);
      return view(matchFor(token), token);
    },
    own(actor, token) {
      const u = currentActor(actor),
        m = matchFor(token);
      grant(m, u);
      return view(m, token, u);
    },
    async entry(input, ip) {
      enabled();
      fields(input, ["code", "shareToken"]);
      credential(input.shareToken);
      text(input.code, 512);
      if (/\s/.test(input.code)) fail(400, "微信登录凭据不正确。");
      limit("entry-ip", ip || "unknown");
      const before = matchFor(input.shareToken),
        expected = epoch();
      if (inFlight >= 16) fail(429, "微信认证繁忙，请稍后重试。");
      let identity;
      inFlight++;
      try {
        identity = await provider.exchange(input.code);
      } finally {
        inFlight--;
      }
      if (!provider.isVerifiedIdentity(identity) || identity.appId !== appId) fail(401, "微信身份验证未通过。");
      limit("entry-identity", identity.appId + "\0" + identity.openid);
      return tx(() => {
        checkEpoch(expected);
        const m = matchFor(input.shareToken);
        if (m.id !== before.id) fail(409, "比赛入口已变化。");
        const existing = bound(identity, m.team_id);
        if (existing) {
          if (existing.u.membership_kind === "guest") {
            const access = q("SELECT 1 FROM club_guest_match_access WHERE match_id=? AND player_id=?").get(
              m.id,
              existing.u.player_id
            );
            if (!access) {
              requireOpen(m);
              q("INSERT INTO club_guest_match_access VALUES(?,?,?,?)").run(
                m.team_id,
                m.id,
                existing.u.player_id,
                now()
              );
            }
          }
          return session(existing.u, existing.binding, m, input.shareToken);
        }
        requireOpen(m);
        requireNoPendingClaim(identity.openid);
        q("DELETE FROM club_guest_registration WHERE expires_at<=?").run(now());
        if (q("SELECT COUNT(*) n FROM club_guest_registration").get().n >= 1000)
          fail(429, "登记请求较多，请稍后重试。");
        const registrationToken = randomBytes(32).toString("hex"),
          expiresAt = now() + 10 * 60000;
        q(
          "INSERT INTO club_guest_registration(token_hash,match_id,app_id,openid,identity_epoch,expires_at) VALUES(?,?,?,?,?,?)"
        ).run(hash(registrationToken), m.id, appId, identity.openid, expected, expiresAt);
        return { needsProfile: true, registrationToken, expiresAt, match: view(m, input.shareToken) };
      });
    },
    async register(input, ip) {
      enabled();
      fields(
        input,
        ["registrationToken", "requestId", "realName", "nickname", "avatar", "response"],
        ["registrationToken", "requestId", "realName", "nickname", "avatar"]
      );
      credential(input.registrationToken);
      if (input.response !== undefined && input.response !== "yes") fail(400, "首次登记须确认参加比赛。");
      const name = text(input.realName, 200),
        nickname = text(input.nickname, 100),
        requestId = text(input.requestId, 128);
      const key = hash(input.registrationToken),
        payloadHash = hash(JSON.stringify({ name, nickname, requestId, avatar: input.avatar, response: "yes" }));
      for (const [k, r] of receipts) if (r.expiresAt <= now()) receipts.delete(k);
      limit("register-ip", ip || "unknown");
      limit("register-ticket", input.registrationToken, 10);
      const read = () => {
        const pending = q("SELECT * FROM club_guest_registration WHERE token_hash=?").get(
          hash(input.registrationToken)
        );
        if (!pending || pending.app_id !== appId || pending.expires_at <= now())
          fail(401, "登记已过期或应用已变化，请重新微信登录。");
        if (pending.consumed_at !== null) {
          const receipt = receipts.get(key);
          if (!receipt || receipt.requestId !== requestId || receipt.payloadHash !== payloadHash)
            fail(409, "登记已完成或请求内容已变化，请重新微信登录核对。");
          let current;
          try {
            current = authenticate(receipt.token, "native");
          } catch {
            fail(409, "登记会话已失效，请重新微信登录。");
          }
          if (current.membership_kind !== "guest" || current.id !== receipt.userId)
            fail(409, "身份已变化，请重新微信登录。");
          const token = q("SELECT token FROM club_match_shares WHERE match_id=?").get(pending.match_id)?.token;
          const m = matchFor(token);
          grant(m, current);
          return {
            replay: {
              needsProfile: false,
              token: receipt.token,
              expiresAt: receipt.sessionExpiresAt,
              user: receipt.user,
              team: getTeam(current.team_id),
              match: view(m, token, current),
            },
          };
        }
        checkEpoch(pending.identity_epoch);
        const token = q("SELECT token FROM club_match_shares WHERE match_id=?").get(pending.match_id)?.token;
        const m = matchFor(token);
        requireOpen(m);
        return { pending, m, token };
      };
      const initial = read();
      if (initial.replay) return initial.replay;
      const avatar = (await sanitizePlayerPhoto(input.avatar)).dataUrl;
      const result = tx(() => {
        const state = read();
        if (state.replay) return state.replay;
        const { pending, m, token } = state;
        if (
          m.max_participants !== null &&
          q("SELECT COUNT(*) n FROM club_rsvps WHERE match_id=? AND response='yes'").get(m.id).n >= m.max_participants
        )
          fail(409, "报名人数已满，可稍后再试。");
        // Never attach a self-declared name to an existing player or resurrect a
        // revoked identity. Only provider-verified onboarding created this ticket.
        if (q("SELECT 1 FROM club_wechat_identities WHERE app_id=? AND openid=?").get(appId, pending.openid))
          fail(409, "微信身份已变化，请重新登录核对。");
        requireNoPendingClaim(pending.openid);
        const playerId = randomUUID();
        q(
          "INSERT INTO club_players(id,team_id,name,number,positions,status,membership_confirmed,membership_kind,nickname,avatar) VALUES(?,?,?,NULL,?,'active',1,'guest',?,?)"
        ).run(playerId, m.team_id, name, JSON.stringify(["待定"]), nickname, avatar);
        const uid = q(
          "INSERT INTO club_users(team_id,username,password_hash,password_enabled,role,player_id) VALUES(?,?,?,0,'player',?)"
        ).run(
          m.team_id,
          "guest_" + randomBytes(24).toString("hex"),
          "disabled_" + randomBytes(32).toString("hex"),
          playerId
        ).lastInsertRowid;
        const wid = q("INSERT INTO club_wechat_identities(app_id,openid,user_id,created_at) VALUES(?,?,?,?)").run(
          appId,
          pending.openid,
          uid,
          now()
        ).lastInsertRowid;
        q("INSERT INTO club_guest_match_access VALUES(?,?,?,?)").run(m.team_id, m.id, playerId, now());
        q("UPDATE club_guest_registration SET consumed_at=?,request_id=? WHERE token_hash=?").run(
          now(),
          requestId,
          hash(input.registrationToken)
        );
        q("INSERT INTO club_rsvps(team_id,match_id,player_id,response) VALUES(?,?,?,'yes')").run(
          m.team_id,
          m.id,
          playerId
        );
        if (m.team_id === 1) q("UPDATE coaching_desks SET edition=edition+1,saved_at=? WHERE desk_id=1").run(now());
        return session(user(Number(uid)), q("SELECT * FROM club_wechat_identities WHERE id=?").get(wid), m, token);
      });
      receipts.set(key, {
        requestId,
        payloadHash,
        token: result.token,
        userId: result.user.id,
        user: result.user,
        sessionExpiresAt: result.expiresAt,
        expiresAt: initial.pending.expires_at,
      });
      return result;
    },
    rsvp(actor, token, input) {
      fields(input, ["response"]);
      if (!["yes", "no", "maybe"].includes(input.response)) fail(400, "报名状态不正确。");
      return tx(() => {
        const u = currentActor(actor),
          m = matchFor(token);
        grant(m, u);
        if (!u.player_id) fail(403, "管理员账户未绑定球员，不能代替球员报名。");
        if (m.status !== "published") fail(409, "仅已发布的比赛可以报名。");
        const existing = q("SELECT response FROM club_rsvps WHERE match_id=? AND player_id=?").get(m.id, u.player_id);
        if (input.response === "yes" && existing?.response !== "yes") {
          if (u.membership_kind === "guest") requireOpen(m);
          if (
            m.max_participants !== null &&
            q("SELECT COUNT(*) n FROM club_rsvps WHERE match_id=? AND response='yes'").get(m.id).n >= m.max_participants
          )
            fail(409, "报名人数已满，可选择待定或请假。");
        }
        q(
          "INSERT INTO club_rsvps(team_id,match_id,player_id,response) VALUES(?,?,?,?) ON CONFLICT(match_id,player_id) DO UPDATE SET response=excluded.response"
        ).run(m.team_id, m.id, u.player_id, input.response);
        return view(m, token, u);
      });
    },
    promote(actor, id, input) {
      fields(input, ["revision"], []);
      return tx(() => {
        const u = currentActor(actor);
        if (u.role !== "admin" || u.membership_kind === "guest" || u.must_change_password === 1)
          fail(403, "此操作需要管理员权限。");
        const p = getPlayer(u.team_id, id);
        if (!Number.isSafeInteger(input.revision) || input.revision < 1) fail(428, "请提供有效版本号。");
        if (input.revision !== p.revision) fail(409, "球员已变化，请刷新后核对。");
        if (p.status !== "active") fail(409, "请先恢复球员再转正。");
        if (p.membershipKind === "member") return p;
        q(
          "UPDATE club_players SET membership_kind='member',membership_confirmed=1,revision=revision+1 WHERE team_id=? AND id=?"
        ).run(u.team_id, id);
        q("UPDATE club_users SET account_revision=account_revision+1 WHERE team_id=? AND player_id=?").run(
          u.team_id,
          id
        );
        q("DELETE FROM club_sessions WHERE user_id IN(SELECT id FROM club_users WHERE team_id=? AND player_id=?)").run(
          u.team_id,
          id
        );
        q("UPDATE club_wechat_epoch SET revision=revision+1 WHERE id=1").run();
        if (u.team_id === 1) q("UPDATE coaching_desks SET edition=edition+1,saved_at=? WHERE desk_id=1").run(now());
        return getPlayer(u.team_id, id);
      });
    },
  };
}
