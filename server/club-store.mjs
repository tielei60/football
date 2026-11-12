import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  FootballError,
  MAX_PLAYER_AVATAR_CHARACTERS,
} from "./football-store.mjs";

const fail = (status, message) => {
  throw new FootballError(status, message);
};
const object = (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    fail(400, "请提交有效资料。");
  return v;
};
const text = (v, max = 200, required = false) => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    fail(400, "文字为空或超过长度限制。");
  return v.trim();
};
const integer = (v, max = 9999) => {
  if (v !== null && (!Number.isSafeInteger(v) || v < 0 || v > max))
    fail(400, "请输入有效非负整数，未知数据请留空。");
  return v;
};
const date = (v) => {
  if (
    typeof v !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    fail(400, "请输入有效日期 YYYY-MM-DD。");
  return v;
};
const oneOf = (v, values) => {
  if (!values.includes(v)) fail(400, "状态不正确。");
  return v;
};
const password = (v) => {
  if (typeof v !== "string" || v.length < 10 || v.length > 200)
    fail(400, "密码须为 10 至 200 个字符。");
  return v;
};
const hashPassword = (v) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password(v), salt, 64).toString("hex")}`;
};
const verify = (value, hash) => {
  if (typeof value !== "string" || value.length > 200) return false;
  const [salt, expected] = hash.split(":");
  return timingSafeEqual(
    scryptSync(value, salt, 64),
    Buffer.from(expected, "hex"),
  );
};
const tokenHash = (value) => createHash("sha256").update(value).digest("hex");
const positionsAllowed = [
  "门将",
  "后卫",
  "中后卫",
  "边后卫",
  "后腰",
  "中场",
  "前腰",
  "边前卫",
  "左边前",
  "右边前",
  "中锋",
  "前锋",
  "待定",
];
const positions = (v) => {
  if (
    !Array.isArray(v) ||
    !v.length ||
    v.length > 15 ||
    v.some((p) => !positionsAllowed.includes(p))
  )
    fail(400, "请选择有效球员位置。");
  return [...new Set(v)];
};
const MAX_CREST_BYTES = 2 * 1024 * 1024;
function validateCrest(value) {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 4 * Math.ceil(MAX_CREST_BYTES / 3) + 40
  )
    fail(400, "队徽须为不超过 2 MiB 的 PNG、JPEG、WebP 或 GIF 图片。");
  const match =
    /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match) fail(400, "队徽仅支持 PNG、JPEG、WebP 或 GIF 的 base64 图片。");
  const bytes = Buffer.from(match[2], "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_CREST_BYTES ||
    bytes.toString("base64") !== match[2]
  )
    fail(400, "队徽图片编码或大小不正确。");
  const kind = match[1];
  const valid =
    kind === "png"
      ? bytes.length >= 33 &&
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString("ascii", 12, 16) === "IHDR" &&
        bytes.readUInt32BE(16) > 0 &&
        bytes.readUInt32BE(20) > 0
      : kind === "jpeg"
        ? bytes.length >= 4 &&
          bytes[0] === 255 &&
          bytes[1] === 216 &&
          bytes[2] === 255 &&
          bytes[bytes.length - 2] === 255 &&
          bytes[bytes.length - 1] === 217
        : kind === "gif"
          ? bytes.length >= 14 &&
            ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)) &&
            bytes.readUInt16LE(6) > 0 &&
            bytes.readUInt16LE(8) > 0 &&
            bytes[bytes.length - 1] === 59
          : bytes.length >= 20 &&
            bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP" &&
            bytes.readUInt32LE(4) === bytes.length - 8 &&
            ["VP8 ", "VP8L", "VP8X"].includes(bytes.toString("ascii", 12, 16));
  if (!valid) fail(400, "队徽图片内容与格式不符。");
  return value;
}
const userView = (r) => ({
  id: r.id,
  username: r.username,
  role: r.role,
  playerId: r.player_id,
  teamId: r.team_id,
});

export function createClubStore(database, legacy, { bootstrapAdmin } = {}) {
  const q = (sql) => database.prepare(sql);
  const tx = (work) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      database.exec("COMMIT");
      return result;
    } catch (e) {
      database.exec("ROLLBACK");
      throw e;
    }
  };
  tx(() =>
    database.exec(`
    CREATE TABLE IF NOT EXISTS club_teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL) STRICT;
    INSERT OR IGNORE INTO club_teams (id,name) VALUES (1,'我的球队');
    CREATE TABLE IF NOT EXISTS club_players (
      id TEXT PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES club_teams(id), name TEXT NOT NULL,
      number INTEGER, positions TEXT NOT NULL, preferred_foot TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')), note TEXT NOT NULL DEFAULT '', avatar TEXT,
      UNIQUE(team_id,id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS club_users (
      id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES club_teams(id), username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','player')), player_id TEXT UNIQUE,
      FOREIGN KEY(team_id,player_id) REFERENCES club_players(team_id,id),
      CHECK(role='admin' OR player_id IS NOT NULL)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS club_sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES club_users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS club_seasons (
      id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES club_teams(id), name TEXT NOT NULL,
      start_date TEXT NOT NULL,end_date TEXT NOT NULL,CHECK(start_date<=end_date)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS club_matches (
      id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES club_teams(id), opponent TEXT NOT NULL,
      match_date TEXT NOT NULL,kickoff TEXT NOT NULL DEFAULT '',location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','completed','cancelled')),
      home_score INTEGER,away_score INTEGER,analysis TEXT NOT NULL DEFAULT '', UNIQUE(team_id,id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS club_matches_date ON club_matches(team_id,match_date);
    CREATE TABLE IF NOT EXISTS club_rsvps (
      team_id INTEGER NOT NULL, match_id INTEGER NOT NULL, player_id TEXT NOT NULL,
      response TEXT NOT NULL CHECK(response IN ('yes','no','maybe')), PRIMARY KEY(match_id,player_id),
      FOREIGN KEY(team_id,match_id) REFERENCES club_matches(team_id,id), FOREIGN KEY(team_id,player_id) REFERENCES club_players(team_id,id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS club_roster (
      team_id INTEGER NOT NULL, match_id INTEGER NOT NULL, player_id TEXT NOT NULL, position TEXT NOT NULL DEFAULT '',
      appeared INTEGER CHECK(appeared IN (0,1)),goals INTEGER CHECK(goals>=0),assists INTEGER CHECK(assists>=0),
      PRIMARY KEY(match_id,player_id), FOREIGN KEY(team_id,match_id) REFERENCES club_matches(team_id,id),
      FOREIGN KEY(team_id,player_id) REFERENCES club_players(team_id,id),
      CHECK(appeared=1 OR (goals IS NULL AND assists IS NULL))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS club_match_tactics (
      match_id INTEGER NOT NULL REFERENCES club_matches(id), tactic_id INTEGER NOT NULL REFERENCES tactics(tactic_id) ON DELETE CASCADE,
      PRIMARY KEY(match_id,tactic_id)
    ) STRICT;
    INSERT OR IGNORE INTO app_migrations(migration_name,applied_at) VALUES ('club-management-v1',unixepoch()*1000);
  `),
  );
  tx(() => {
    for (const table of ["club_players", "club_matches", "club_seasons"]) {
      if (
        !q(`PRAGMA table_info(${table})`)
          .all()
          .some((column) => column.name === "revision")
      )
        database.exec(
          `ALTER TABLE ${table} ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`,
        );
    }
    q(
      "INSERT OR IGNORE INTO app_migrations(migration_name,applied_at) VALUES ('club-revisions-v2',?)",
    ).run(Date.now());
  });
  tx(() => {
    const columns = new Set(
      q("PRAGMA table_info(club_teams)")
        .all()
        .map((column) => column.name),
    );
    if (!columns.has("crest"))
      database.exec("ALTER TABLE club_teams ADD COLUMN crest TEXT");
    if (!columns.has("revision"))
      database.exec(
        "ALTER TABLE club_teams ADD COLUMN revision INTEGER NOT NULL DEFAULT 1",
      );
    q(
      "INSERT OR IGNORE INTO app_migrations(migration_name,applied_at) VALUES ('club-team-profile-v3',?)",
    ).run(Date.now());
  });
  function checkRevision(input, current) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 1)
      fail(428, "请携带当前版本号保存，重新加载后再试。");
    if (input.revision !== current.revision)
      fail(409, "资料已在其他页面更新，请重新加载后再保存。");
  }
  function syncLegacy({ overwrite = false, reactivate = false } = {}) {
    for (const p of legacy.getDesk().desk?.players ?? []) {
      const previous = q("SELECT * FROM club_players WHERE id=?").get(
        p.playerId,
      );
      if (!previous)
        q(
          "INSERT INTO club_players (id,team_id,name,number,positions,preferred_foot,note,avatar) VALUES (?,1,?,?,?,?,?,?)",
        ).run(
          p.playerId,
          p.name,
          p.number,
          JSON.stringify(p.positions),
          p.preferredFoot,
          p.note,
          p.avatar ?? null,
        );
      else if (
        overwrite &&
        (previous.name !== p.name ||
          previous.number !==
            (previous.number === null && p.number === 0 ? null : p.number) ||
          previous.positions !== JSON.stringify(p.positions) ||
          previous.preferred_foot !== p.preferredFoot ||
          previous.note !== p.note ||
          previous.avatar !== (p.avatar ?? null))
      )
        q(
          "UPDATE club_players SET name=?,number=?,positions=?,preferred_foot=?,note=?,avatar=?,revision=revision+1 WHERE id=? AND team_id=1",
        ).run(
          p.name,
          previous.number === null && p.number === 0 ? null : p.number,
          JSON.stringify(p.positions),
          p.preferredFoot,
          p.note,
          p.avatar ?? null,
          p.playerId,
        );
      if (reactivate)
        q(
          "UPDATE club_players SET status='active',revision=revision+1 WHERE id=? AND team_id=1 AND status!='active'",
        ).run(p.playerId);
    }
  }
  tx(() =>
    syncLegacy({
      overwrite: legacy.appliedMigrations?.includes(
        "berlin-garden-roster-csv-positions-v2",
      ),
    }),
  );
  if (
    bootstrapAdmin?.username &&
    bootstrapAdmin?.password &&
    !q("SELECT id FROM club_users WHERE role='admin'").get()
  ) {
    const username = text(bootstrapAdmin.username, 100, true);
    const hash = hashPassword(bootstrapAdmin.password);
    tx(() => {
      if (!q("SELECT id FROM club_users WHERE role='admin'").get())
        q(
          "INSERT INTO club_users (team_id,username,password_hash,role) VALUES (1,?,?,'admin')",
        ).run(username, hash);
    });
  }
  const getPlayer = (teamId, id) => {
    const r = q(
      "SELECT p.*, EXISTS(SELECT 1 FROM club_users u WHERE u.player_id=p.id) AS has_account FROM club_players p WHERE p.team_id=? AND p.id=?",
    ).get(teamId, id);
    if (!r) fail(404, "未找到球员。");
    return {
      id: r.id,
      revision: r.revision,
      name: r.name,
      number: r.number,
      positions: JSON.parse(r.positions),
      preferredFoot: r.preferred_foot,
      status: r.status,
      note: r.note,
      avatar: r.avatar,
      hasAccount: Boolean(r.has_account),
    };
  };
  const listPlayers = (teamId) =>
    q(
      "SELECT id FROM club_players WHERE team_id=? ORDER BY number IS NULL,number,name",
    )
      .all(teamId)
      .map((r) => getPlayer(teamId, r.id));
  function savePlayer(teamId, id, input) {
    object(input);
    const old = id
      ? getPlayer(teamId, id)
      : {
          name: "",
          number: null,
          positions: ["待定"],
          preferredFoot: "",
          status: "active",
          note: "",
          avatar: null,
        };
    const p = { ...old, ...input };
    p.name = text(p.name, 200, true);
    p.number = integer(p.number);
    p.positions = positions(p.positions);
    p.preferredFoot = text(p.preferredFoot, 40);
    p.status = oneOf(p.status, ["active", "inactive"]);
    p.note = text(p.note, 20000);
    if (
      p.avatar !== null &&
      (typeof p.avatar !== "string" ||
        p.avatar.length > MAX_PLAYER_AVATAR_CHARACTERS)
    )
      fail(400, "球员头像超过长度限制。");
    const updating = Boolean(id);
    id ||= randomUUID();
    return tx(() => {
      if (updating) checkRevision(input, getPlayer(teamId, id));
      q(`INSERT INTO club_players(id,team_id,name,number,positions,preferred_foot,status,note,avatar) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,number=excluded.number,positions=excluded.positions,preferred_foot=excluded.preferred_foot,status=excluded.status,note=excluded.note,avatar=excluded.avatar,revision=club_players.revision+1`).run(
        id,
        teamId,
        p.name,
        p.number,
        JSON.stringify(p.positions),
        p.preferredFoot,
        p.status,
        p.note,
        p.avatar,
      );
      if (p.status === "inactive")
        q(
          "DELETE FROM club_sessions WHERE user_id IN (SELECT id FROM club_users WHERE player_id=? AND team_id=?)",
        ).run(id, teamId);
      // Preserve board placement and injury status; match history always refers to stable club IDs.
      if (teamId === 1)
        q(
          "UPDATE coaching_desks SET edition=edition+1,saved_at=? WHERE desk_id=1",
        ).run(Date.now());
      if (teamId === 1)
        q(
          "UPDATE team_players SET name=?,shirt_number=?,position=?,preferred_foot=?,note=?,portrait=? WHERE player_id=?",
        ).run(
          p.name,
          p.number ?? 0,
          JSON.stringify(p.positions),
          p.preferredFoot,
          p.note,
          p.avatar === null ? null : JSON.stringify(p.avatar),
          id,
        );
      return getPlayer(teamId, id);
    });
  }
  const getTeam = (teamId) => {
    const team = q(
      "SELECT id,name,crest,revision FROM club_teams WHERE id=?",
    ).get(teamId);
    if (!team) fail(404, "未找到球队。");
    return team;
  };
  function saveTeam(teamId, input) {
    object(input);
    return tx(() => {
      const current = getTeam(teamId);
      checkRevision(input, current);
      const name = text(
        input.name === undefined ? current.name : input.name,
        200,
        true,
      );
      const crest = validateCrest(
        input.crest === undefined ? current.crest : input.crest,
      );
      q(
        "UPDATE club_teams SET name=?,crest=?,revision=revision+1 WHERE id=?",
      ).run(name, crest, teamId);
      return getTeam(teamId);
    });
  }
  const sessionView = (u) => ({ user: userView(u), team: getTeam(u.team_id) });
  const dummyHash = hashPassword(randomBytes(20).toString("hex"));
  const loginAttempts = new Map();
  function login(input, remoteAddress) {
    object(input);
    const username = text(input.username, 100, true);
    const normalizedUsername = username.toLowerCase();
    const key = `pair\0${normalizedUsername}\0${remoteAddress || "unknown"}`;
    const accountKey = `account\0${normalizedUsername}`;
    const now = Date.now();
    for (const [k, v] of loginAttempts)
      if (v.until < now) loginAttempts.delete(k);
    const attempt = loginAttempts.get(key) ?? {
      count: 0,
      until: now + 15 * 60 * 1000,
    };
    const accountAttempt = loginAttempts.get(accountKey) ?? {
      count: 0,
      until: now + 15 * 60 * 1000,
    };
    if (attempt.count >= 30 || accountAttempt.count >= 100)
      fail(429, "登录尝试过多，请稍后再试。");
    attempt.count++;
    loginAttempts.set(key, attempt);
    while (loginAttempts.size > 20000)
      loginAttempts.delete(loginAttempts.keys().next().value);
    const u = q("SELECT * FROM club_users WHERE username=? COLLATE NOCASE").get(
      username,
    );
    const valid = verify(input.password, u?.password_hash ?? dummyHash);
    if (!u || !valid) {
      accountAttempt.count++;
      loginAttempts.set(accountKey, accountAttempt);
      fail(401, "用户名或密码不正确。");
    }
    if (u.player_id && getPlayer(u.team_id, u.player_id).status !== "active")
      fail(403, "此球员账户已停用。");
    loginAttempts.delete(key);
    const token = randomBytes(32).toString("hex");
    q("DELETE FROM club_sessions WHERE expires_at<=?").run(now);
    q("INSERT INTO club_sessions VALUES (?,?,?)").run(
      tokenHash(token),
      u.id,
      now + 7 * 86400000,
    );
    return { token, ...sessionView(u) };
  }
  function authenticate(token) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) fail(401, "请先登录。");
    const u = q(
      "SELECT u.* FROM club_sessions s JOIN club_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
    ).get(tokenHash(token), Date.now());
    if (!u) fail(401, "登录已过期，请重新登录。");
    if (u.player_id && getPlayer(u.team_id, u.player_id).status !== "active")
      fail(403, "此球员账户已停用。");
    return u;
  }
  function createAccount(teamId, playerId, input) {
    object(input);
    getPlayer(teamId, playerId);
    const username = text(input.username, 100, true),
      hash = hashPassword(input.password);
    if (
      q(
        "SELECT id FROM club_users WHERE username=? COLLATE NOCASE OR player_id=?",
      ).get(username, playerId)
    )
      fail(409, "用户名或球员账户已存在。");
    const result = q(
      "INSERT INTO club_users(team_id,username,password_hash,role,player_id) VALUES (?,?,?,'player',?)",
    ).run(teamId, username, hash, playerId);
    return userView(
      q("SELECT * FROM club_users WHERE id=?").get(result.lastInsertRowid),
    );
  }
  function resetPassword(teamId, playerId, input) {
    object(input);
    getPlayer(teamId, playerId);
    const u = q("SELECT * FROM club_users WHERE team_id=? AND player_id=?").get(
      teamId,
      playerId,
    );
    if (!u) fail(404, "该球员尚未创建账户。");
    const hash = hashPassword(input.newPassword);
    tx(() => {
      q("UPDATE club_users SET password_hash=? WHERE id=?").run(hash, u.id);
      q("DELETE FROM club_sessions WHERE user_id=?").run(u.id);
    });
  }
  function changePassword(u, input) {
    object(input);
    if (!verify(input.currentPassword, u.password_hash))
      fail(403, "当前密码不正确。");
    const hash = hashPassword(input.newPassword);
    tx(() => {
      q("UPDATE club_users SET password_hash=? WHERE id=?").run(hash, u.id);
      q("DELETE FROM club_sessions WHERE user_id=?").run(u.id);
    });
  }
  const seasonView = (r) => ({
    id: r.id,
    revision: r.revision,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
  });
  const getSeason = (teamId, id) => {
    const r = q("SELECT * FROM club_seasons WHERE team_id=? AND id=?").get(
      teamId,
      id,
    );
    if (!r) fail(404, "未找到赛季。");
    return seasonView(r);
  };
  function saveSeason(teamId, id, input) {
    object(input);
    const s = { ...(id ? getSeason(teamId, id) : {}), ...input };
    s.name = text(s.name, 200, true);
    date(s.startDate);
    date(s.endDate);
    if (s.startDate > s.endDate) fail(400, "赛季结束日期不能早于开始日期。");
    return tx(() => {
      if (id) checkRevision(input, getSeason(teamId, id));
      if (id)
        q(
          "UPDATE club_seasons SET name=?,start_date=?,end_date=?,revision=revision+1 WHERE id=? AND team_id=?",
        ).run(s.name, s.startDate, s.endDate, id, teamId);
      else
        id = Number(
          q(
            "INSERT INTO club_seasons(team_id,name,start_date,end_date) VALUES (?,?,?,?)",
          ).run(teamId, s.name, s.startDate, s.endDate).lastInsertRowid,
        );
      return getSeason(teamId, id);
    });
  }
  function getMatch(u, id) {
    const r = q("SELECT * FROM club_matches WHERE team_id=? AND id=?").get(
      u.team_id,
      id,
    );
    if (!r || (u.role !== "admin" && r.status === "draft"))
      fail(404, "未找到比赛。");
    return {
      id: r.id,
      revision: r.revision,
      opponent: r.opponent,
      date: r.match_date,
      kickoff: r.kickoff,
      location: r.location,
      status: r.status,
      homeScore: r.home_score,
      awayScore: r.away_score,
      analysis: r.analysis,
      tacticIds: q(
        "SELECT tactic_id FROM club_match_tactics WHERE match_id=? ORDER BY tactic_id",
      )
        .all(id)
        .map((t) => t.tactic_id),
      rsvps: q(
        "SELECT player_id AS playerId,response FROM club_rsvps WHERE match_id=?",
      ).all(id),
      roster: q(
        "SELECT player_id AS playerId,position,appeared,goals,assists FROM club_roster WHERE match_id=?",
      )
        .all(id)
        .map((p) => ({
          ...p,
          appeared: p.appeared === null ? null : Boolean(p.appeared),
        })),
    };
  }
  function validateTotals(score, roster) {
    if (score === null) return;
    for (const metric of ["goals", "assists"]) {
      if (roster.reduce((sum, p) => sum + (p[metric] ?? 0), 0) > score)
        fail(400, "球员进球或助攻合计不能超过本队比分。");
    }
  }
  function saveMatch(u, id, input) {
    object(input);
    const m = {
      ...(id
        ? getMatch(u, id)
        : {
            opponent: "",
            date: "",
            kickoff: "",
            location: "",
            status: "draft",
            homeScore: null,
            awayScore: null,
            analysis: "",
            tacticIds: [],
          }),
      ...input,
    };
    m.opponent = text(m.opponent, 200, true);
    date(m.date);
    m.kickoff = text(m.kickoff, 5);
    if (m.kickoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.kickoff))
      fail(400, "开球时间须为 HH:mm。");
    m.location = text(m.location, 500);
    oneOf(m.status, ["draft", "published", "completed", "cancelled"]);
    integer(m.homeScore);
    integer(m.awayScore);
    m.analysis = text(m.analysis, 50000);
    if (
      !Array.isArray(m.tacticIds) ||
      m.tacticIds.length > 100 ||
      m.tacticIds.some((v) => !Number.isSafeInteger(v) || v < 1)
    )
      fail(400, "请选择有效战术。");
    if (m.tacticIds.length && u.team_id !== 1)
      fail(403, "无权关联其他球队的战术。");
    for (const tacticId of m.tacticIds) legacy.getTactic(tacticId);
    validateTotals(m.homeScore, id ? getMatch(u, id).roster : []);
    return tx(() => {
      if (id) checkRevision(input, getMatch(u, id));
      if (id)
        q(
          "UPDATE club_matches SET opponent=?,match_date=?,kickoff=?,location=?,status=?,home_score=?,away_score=?,analysis=?,revision=revision+1 WHERE id=? AND team_id=?",
        ).run(
          m.opponent,
          m.date,
          m.kickoff,
          m.location,
          m.status,
          m.homeScore,
          m.awayScore,
          m.analysis,
          id,
          u.team_id,
        );
      else
        id = Number(
          q(
            "INSERT INTO club_matches(team_id,opponent,match_date,kickoff,location,status,home_score,away_score,analysis) VALUES (?,?,?,?,?,?,?,?,?)",
          ).run(
            u.team_id,
            m.opponent,
            m.date,
            m.kickoff,
            m.location,
            m.status,
            m.homeScore,
            m.awayScore,
            m.analysis,
          ).lastInsertRowid,
        );
      q("DELETE FROM club_match_tactics WHERE match_id=?").run(id);
      for (const tacticId of new Set(m.tacticIds))
        q("INSERT INTO club_match_tactics VALUES (?,?)").run(id, tacticId);
      return getMatch(u, id);
    });
  }
  function saveRsvp(u, id, input) {
    object(input);
    const m = getMatch(u, id);
    if (!u.player_id) fail(403, "管理员账户未绑定球员，不能代替球员报名。");
    if (m.status !== "published") fail(409, "仅已发布的比赛可以报名。");
    oneOf(input.response, ["yes", "no", "maybe"]);
    q(
      "INSERT INTO club_rsvps(team_id,match_id,player_id,response) VALUES (?,?,?,?) ON CONFLICT(match_id,player_id) DO UPDATE SET response=excluded.response",
    ).run(u.team_id, id, u.player_id, input.response);
    return getMatch(u, id);
  }
  function saveRoster(u, id, input) {
    object(input);
    getMatch(u, id);
    if (!Array.isArray(input.roster) || input.roster.length > 1000)
      fail(400, "请提供比赛名单。");
    const ids = new Set();
    const rows = input.roster.map((p) => {
      object(p);
      if (typeof p.playerId !== "string" || ids.has(p.playerId))
        fail(400, "名单球员不能重复。");
      ids.add(p.playerId);
      getPlayer(u.team_id, p.playerId);
      const position = text(p.position ?? "", 100);
      const appeared = p.appeared ?? null;
      if (appeared !== null && typeof appeared !== "boolean")
        fail(400, "出场须为是、否或未知。");
      const goals = integer(p.goals ?? null),
        assists = integer(p.assists ?? null);
      if (appeared !== true && (goals !== null || assists !== null))
        fail(400, "仅确认出场的球员可记录进球和助攻。");
      return { ...p, position, appeared, goals, assists };
    });
    validateTotals(getMatch(u, id).homeScore, rows);
    return tx(() => {
      checkRevision(input, getMatch(u, id));
      q(
        "UPDATE club_matches SET revision=revision+1 WHERE id=? AND team_id=?",
      ).run(id, u.team_id);
      q("DELETE FROM club_roster WHERE match_id=?").run(id);
      for (const p of rows)
        q("INSERT INTO club_roster VALUES (?,?,?,?,?,?,?)").run(
          u.team_id,
          id,
          p.playerId,
          p.position,
          p.appeared === null ? null : Number(p.appeared),
          p.goals,
          p.assists,
        );
      return getMatch(u, id);
    });
  }
  function statistics(u, params) {
    let startDate, endDate, label;
    if (params.has("year") && params.has("seasonId"))
      fail(400, "请选择赛季或自然年其中一种统计范围。");
    if (params.has("seasonId")) {
      const id = Number(params.get("seasonId"));
      if (!Number.isSafeInteger(id) || id < 1) fail(400, "赛季编号不正确。");
      const s = getSeason(u.team_id, id);
      ({ startDate, endDate } = s);
      label = s.name;
    } else {
      const year = params.has("year")
        ? Number(params.get("year"))
        : new Date().getUTCFullYear();
      if (!Number.isInteger(year) || year < 1900 || year > 9999)
        fail(400, "年份不正确。");
      startDate = `${year}-01-01`;
      endDate = `${year}-12-31`;
      label = String(year);
    }
    const rows = q(
      `SELECT r.* FROM club_roster r JOIN club_matches m ON m.id=r.match_id WHERE m.team_id=? AND m.status='completed' AND m.match_date BETWEEN ? AND ?`,
    ).all(u.team_id, startDate, endDate);
    const completed = q(
      "SELECT opponent,home_score,away_score FROM club_matches WHERE team_id=? AND status='completed' AND match_date BETWEEN ? AND ?",
    ).all(u.team_id, startDate, endDate);
    const matches = completed.length;
    function summarizeScores(records) {
      const scored = records.filter(
        (match) => match.home_score !== null && match.away_score !== null,
      );
      const goalsForRecords = records.filter(
        (match) => match.home_score !== null,
      );
      const goalsAgainstRecords = records.filter(
        (match) => match.away_score !== null,
      );
      return {
        matches: records.length,
        scoredMatches: scored.length,
        wins: scored.filter((match) => match.home_score > match.away_score)
          .length,
        draws: scored.filter((match) => match.home_score === match.away_score)
          .length,
        losses: scored.filter((match) => match.home_score < match.away_score)
          .length,
        goalsFor: goalsForRecords.length
          ? goalsForRecords.reduce((sum, match) => sum + match.home_score, 0)
          : null,
        goalsAgainst: goalsAgainstRecords.length
          ? goalsAgainstRecords.reduce(
              (sum, match) => sum + match.away_score,
              0,
            )
          : null,
        goalsForKnownMatches: goalsForRecords.length,
        goalsAgainstKnownMatches: goalsAgainstRecords.length,
      };
    }
    const team = summarizeScores(completed);
    const groups = new Map();
    for (const match of completed) {
      const name = match.opponent.trim();
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(match);
    }
    const opponents = [...groups]
      .map(([opponent, records]) => ({ opponent, ...summarizeScores(records) }))
      .sort(
        (a, b) => b.matches - a.matches || a.opponent.localeCompare(b.opponent),
      );
    const matchesWithoutRoster =
      matches - new Set(rows.map((r) => r.match_id)).size;
    const players = listPlayers(u.team_id).map((p) => {
      const records = rows.filter((r) => r.player_id === p.id),
        played = records.filter((r) => r.appeared === 1),
        goals = played.filter((r) => r.goals !== null),
        assists = played.filter((r) => r.assists !== null);
      return {
        playerId: p.id,
        name: p.name,
        appearances: played.length,
        unknownAppearances: records.filter((r) => r.appeared === null).length,
        unrecordedMatches: matches - records.length,
        goals: goals.length ? goals.reduce((n, r) => n + r.goals, 0) : null,
        assists: assists.length
          ? assists.reduce((n, r) => n + r.assists, 0)
          : null,
        goalsKnownMatches: goals.length,
        assistsKnownMatches: assists.length,
      };
    });
    return {
      filter: { startDate, endDate, label },
      matches,
      matchesWithoutRoster,
      team,
      opponents,
      players,
    };
  }
  function saveTacticalDesk(request) {
    const previousIds = (tacticalDesk().desk?.players ?? []).map(
      (p) => p.playerId,
    );
    legacy.saveDesk(request, () => {
      syncLegacy({ overwrite: true, reactivate: true });
      // A null desk resets the board, not club membership. A non-null roster
      // removes members from the previous canonical roster. Profile edits bump
      // the desk edition, so clients unaware of appended profiles cannot remove them.
      // Before initial board creation the previous roster is empty.
      if (request.desk !== null) {
        const supplied = new Set(request.desk.players.map((p) => p.playerId));
        for (const id of previousIds) {
          if (supplied.has(id)) continue;
          q(
            "UPDATE club_players SET status='inactive',revision=revision+1 WHERE id=? AND team_id=1 AND status!='inactive'",
          ).run(id);
          q(
            "DELETE FROM club_sessions WHERE user_id IN (SELECT id FROM club_users WHERE player_id=? AND team_id=1)",
          ).run(id);
        }
      }
    });
    return tacticalDesk();
  }
  function tacticalDesk() {
    const result = legacy.getDesk();
    if (!result.desk) return result;
    const existing = new Map(result.desk.players.map((p) => [p.playerId, p]));
    const active = new Map(
      listPlayers(1)
        .filter((p) => p.status === "active")
        .map((p) => [p.id, p]),
    );
    const ordered = [];
    for (const id of existing.keys()) {
      if (!active.has(id)) continue;
      ordered.push(active.get(id));
      active.delete(id);
    }
    ordered.push(...active.values());
    result.desk.players = ordered.map((p) => ({
      ...existing.get(p.id),
      playerId: p.id,
      name: p.name,
      number: p.number ?? 0,
      positions: p.positions,
      preferredFoot: p.preferredFoot,
      status: existing.get(p.id)?.status ?? "ok",
      note: p.note,
      avatar: p.avatar,
      fieldPieceId: existing.get(p.id)?.fieldPieceId ?? null,
    }));
    return result;
  }
  function assertTacticDeletable(tacticId) {
    const linked = q(
      "SELECT m.id,m.opponent FROM club_match_tactics t JOIN club_matches m ON m.id=t.match_id WHERE t.tactic_id=? ORDER BY m.id",
    ).all(tacticId);
    if (linked.length)
      fail(
        409,
        `该战术仍关联 ${linked.length} 场比赛（${linked
          .slice(0, 3)
          .map((m) => `${m.id}: ${m.opponent}`)
          .join("、")}），请先解除比赛关联后再删除。`,
      );
  }
  return {
    assertTacticDeletable,
    getTeam,
    saveTeam,
    login,
    authenticate,
    sessionView,
    changePassword,
    createAccount,
    resetPassword,
    listPlayers,
    getPlayer,
    savePlayer,
    getSeason,
    saveSeason,
    getMatch,
    saveMatch,
    saveRsvp,
    saveRoster,
    statistics,
    syncLegacy,
    tacticalDesk,
    saveTacticalDesk,
    logout: (token) => {
      if (token)
        q("DELETE FROM club_sessions WHERE token_hash=?").run(tokenHash(token));
    },
    listSeasons: (teamId) =>
      q(
        "SELECT * FROM club_seasons WHERE team_id=? ORDER BY start_date DESC,id DESC",
      )
        .all(teamId)
        .map(seasonView),
    listMatches: (u) =>
      q(
        `SELECT id FROM club_matches WHERE team_id=? ${u.role === "admin" ? "" : "AND status!='draft'"} ORDER BY match_date DESC,id DESC`,
      )
        .all(u.team_id)
        .map((r) => getMatch(u, r.id)),
  };
}
