import {
  migrateWechatIdentity,
  revokeWechatPlayer,
  createWechatIdentityStore,
} from "./wechat-identity-store.mjs";
import { createMatchMediaStore } from "./match-media-store.mjs";
import { createVenueStore } from "./venue-store.mjs";
import { createClubCatalogStore } from "./club-catalog-store.mjs";
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
  if (typeof hash !== "string" || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash))
    return false;
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
function validateChangedAvatar(value, allowLocal = false) {
  if (value === null) return;
  if (
    allowLocal &&
    typeof value === "string" &&
    value.length <= 2048 &&
    /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/.test(
      value,
    )
  )
    return;
  try {
    validateCrest(value);
  } catch (error) {
    if (error instanceof FootballError)
      error.message = error.message.replaceAll("队徽", "头像");
    throw error;
  }
}
function validateClubImage(value) {
  if (
    value !== null &&
    (typeof value !== "string" || !/^data:image\/(png|jpeg);base64,/.test(value))
  )
    fail(400, "图标和图片仅支持静态 PNG 或 JPG，清除请传 null。");
  return validateCrest(value);
}
const MAX_MATCH_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const userView = (r) => ({
  id: r.id,
  username: r.username,
  role: r.role,
  playerId: r.player_id,
  teamId: r.team_id,
  passwordEnabled: r.password_enabled !== 0,
  systemAdmin: r.is_system_admin === 1,
  mustChangePassword: r.must_change_password === 1,
  accountEnabled: r.account_enabled !== 0,
  accountRevision: r.account_revision,
});

export function createClubStore(
  database,
  legacy,
  { bootstrapAdmin, wechatProvider, wechatAppId } = {},
) {
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
  migrateWechatIdentity(database);
  tx(() => {
    const columns = new Set(
      q("PRAGMA table_info(club_users)")
        .all()
        .map((c) => c.name),
    );
    for (const [name, definition] of [
      [
        "is_system_admin",
        "INTEGER NOT NULL DEFAULT 0 CHECK(is_system_admin IN (0,1))",
      ],
      [
        "must_change_password",
        "INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1))",
      ],
      [
        "account_enabled",
        "INTEGER NOT NULL DEFAULT 1 CHECK(account_enabled IN (0,1))",
      ],
      [
        "account_revision",
        "INTEGER NOT NULL DEFAULT 1 CHECK(account_revision>0)",
      ],
    ])
      if (!columns.has(name))
        database.exec(
          `ALTER TABLE club_users ADD COLUMN ${name} ${definition}`,
        );
    database.exec(`CREATE TRIGGER IF NOT EXISTS system_admin_role_guard_update
      BEFORE UPDATE ON club_users WHEN NEW.is_system_admin=1 AND NEW.role!='admin'
      BEGIN SELECT RAISE(ABORT,'system administrator must retain admin role'); END;
      CREATE TRIGGER IF NOT EXISTS system_admin_role_guard_insert
      BEFORE INSERT ON club_users WHEN NEW.is_system_admin=1 AND NEW.role!='admin'
      BEGIN SELECT RAISE(ABORT,'system administrator must retain admin role'); END;
      CREATE TRIGGER IF NOT EXISTS last_system_admin_guard_update
      BEFORE UPDATE ON club_users WHEN OLD.is_system_admin=1 AND OLD.account_enabled=1
      AND (NEW.is_system_admin=0 OR NEW.account_enabled=0 OR NEW.team_id!=OLD.team_id)
      AND NOT EXISTS(SELECT 1 FROM club_users WHERE team_id=OLD.team_id AND id!=OLD.id AND is_system_admin=1 AND account_enabled=1)
      BEGIN SELECT RAISE(ABORT,'last system administrator must remain enabled'); END;
      CREATE TRIGGER IF NOT EXISTS last_system_admin_guard_delete
      BEFORE DELETE ON club_users WHEN OLD.is_system_admin=1 AND OLD.account_enabled=1
      AND NOT EXISTS(SELECT 1 FROM club_users WHERE team_id=OLD.team_id AND id!=OLD.id AND is_system_admin=1 AND account_enabled=1)
      BEGIN SELECT RAISE(ABORT,'last system administrator cannot be deleted'); END;`);
  });
  tx(() => {
    if (!q("PRAGMA table_info(club_players)").all().some(c => c.name === "membership_confirmed"))
      database.exec("ALTER TABLE club_players ADD COLUMN membership_confirmed INTEGER NOT NULL DEFAULT 1 CHECK(membership_confirmed IN (0,1))");
  });
  tx(() => {
    if (
      !q("PRAGMA table_info(club_players)")
        .all()
        .some((c) => c.name === "avatar_origin_kind")
    )
      database.exec(
        "ALTER TABLE club_players ADD COLUMN avatar_origin_kind TEXT CHECK(avatar_origin_kind IS NULL OR avatar_origin_kind IN ('local-simulation','ai-generated'))",
      );
  });
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
  tx(() => {
    const columns = new Set(
      q("PRAGMA table_info(club_matches)")
        .all()
        .map((c) => c.name),
    );
    if (!columns.has("season_id"))
      database.exec(
        "ALTER TABLE club_matches ADD COLUMN season_id INTEGER REFERENCES club_seasons(id)",
      );
    if (!columns.has("competition"))
      database.exec(
        "ALTER TABLE club_matches ADD COLUMN competition TEXT NOT NULL DEFAULT ''",
      );
    if (!columns.has("format"))
      database.exec(
        "ALTER TABLE club_matches ADD COLUMN format INTEGER CHECK(format IN (5,6,7,8,9,11))",
      );
    if (!columns.has("max_participants"))
      database.exec("ALTER TABLE club_matches ADD COLUMN max_participants INTEGER CHECK(max_participants IS NULL OR max_participants BETWEEN 1 AND 10000)");
    if (!columns.has("side"))
      database.exec(
        "ALTER TABLE club_matches ADD COLUMN side TEXT NOT NULL DEFAULT 'unknown' CHECK(side IN ('home','away','neutral','unknown'))",
      );
    if (
      !q("PRAGMA table_info(club_roster)")
        .all()
        .some((c) => c.name === "selection")
    )
      database.exec(
        "ALTER TABLE club_roster ADD COLUMN selection TEXT NOT NULL DEFAULT 'unknown' CHECK(selection IN ('starter','bench','unknown'))",
      );
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS club_seasons_team_id ON club_seasons(team_id,id);
      CREATE TABLE IF NOT EXISTS club_season_roster (
      team_id INTEGER NOT NULL,season_id INTEGER NOT NULL,player_id TEXT NOT NULL,name TEXT NOT NULL,number INTEGER,positions TEXT NOT NULL,
      PRIMARY KEY(season_id,player_id),
      FOREIGN KEY(team_id,season_id) REFERENCES club_seasons(team_id,id) ON DELETE CASCADE,
      FOREIGN KEY(team_id,player_id) REFERENCES club_players(team_id,id)
    ) STRICT`);
    q(
      "INSERT OR IGNORE INTO app_migrations(migration_name,applied_at) VALUES ('club-season-membership-v5',?)",
    ).run(Date.now());
  });
  const venues = createVenueStore(database);
  const catalogs = createClubCatalogStore(database, validateClubImage);
  const matchMedia = createMatchMediaStore(database, getMatch);
  function checkRevision(input, current) {
    if (!Number.isSafeInteger(input.revision) || input.revision < 1)
      fail(428, "请携带当前版本号保存，重新加载后再试。");
    if (input.revision !== current.revision)
      fail(409, "资料已在其他页面更新，请重新加载后再保存。");
  }
  function syncLegacy({
    overwrite = false,
    reactivate = false,
    validateChanges = false,
  } = {}) {
    for (const p of legacy.getDesk().desk?.players ?? []) {
      const previous = q("SELECT * FROM club_players WHERE id=?").get(
        p.playerId,
      );
      if (validateChanges && (p.avatar ?? null) !== (previous?.avatar ?? null))
        validateChangedAvatar(p.avatar ?? null, true);
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
          previous.number !== p.number ||
          previous.positions !== JSON.stringify(p.positions) ||
          previous.preferred_foot !== p.preferredFoot ||
          previous.note !== p.note ||
          previous.avatar !== (p.avatar ?? null))
      )
        q(
          "UPDATE club_players SET name=?,number=?,positions=?,preferred_foot=?,note=?,avatar_origin_kind=CASE WHEN avatar IS ? THEN avatar_origin_kind ELSE NULL END,avatar=?,revision=revision+1 WHERE id=? AND team_id=1",
        ).run(
          p.name,
          p.number,
          JSON.stringify(p.positions),
          p.preferredFoot,
          p.note,
          p.avatar ?? null,
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
      "SELECT p.*, EXISTS(SELECT 1 FROM club_users u WHERE u.team_id=p.team_id AND u.player_id=p.id) AS has_account, EXISTS(SELECT 1 FROM club_users u WHERE u.team_id=p.team_id AND u.player_id=p.id AND u.password_enabled=1) AS password_enabled FROM club_players p WHERE p.team_id=? AND p.id=?",
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
      membershipConfirmed: Boolean(r.membership_confirmed),
      note: r.note,
      avatar: r.avatar,
      avatarOriginKind: r.avatar_origin_kind ?? null,
      avatarGenerated: Boolean(r.avatar_origin_kind),
      avatarAiGenerated: r.avatar_origin_kind === "ai-generated",
      avatarSimulation: r.avatar_origin_kind === "local-simulation",
      hasAccount: Boolean(r.has_account),
      passwordEnabled: Boolean(r.password_enabled),
    };
  };
  const listPlayers = (teamId) =>
    q(
      "SELECT id FROM club_players WHERE team_id=? ORDER BY number IS NULL,number,name",
    )
      .all(teamId)
      .map((r) => getPlayer(teamId, r.id));
  function assertPlayerArchivable(teamId, playerId) {
    if (
      q(
        "SELECT 1 FROM club_users WHERE team_id=? AND player_id=? AND is_system_admin=1 AND account_enabled=1",
      ).get(teamId, playerId)
    )
      fail(
        409,
        "该球员关联可用的系统管理员，不能归档或从战术名单移除。当前没有自助解绑入口，请保留此身份以免失去系统管理权限。",
      );
  }
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
          membershipConfirmed: true,
          note: "",
          avatar: null,
        };
    const p = { ...old, ...input };
    p.name = text(p.name, 200, true);
    p.number = integer(p.number);
    p.positions = positions(p.positions);
    p.preferredFoot = text(p.preferredFoot, 40);
    p.status = oneOf(p.status, ["active", "inactive"]);
    if (typeof p.membershipConfirmed !== "boolean")
      fail(400, "成员归属确认必须为布尔值。");
    p.note = text(p.note, 20000);
    if (
      p.avatar !== null &&
      (typeof p.avatar !== "string" ||
        p.avatar.length > MAX_PLAYER_AVATAR_CHARACTERS)
    )
      fail(400, "球员头像超过长度限制。");
    if (p.avatar !== old.avatar) validateChangedAvatar(p.avatar);
    const updating = Boolean(id);
    id ||= randomUUID();
    return tx(() => {
      if (updating) checkRevision(input, getPlayer(teamId, id));
      if (p.status === "inactive") assertPlayerArchivable(teamId, id);
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
      q("UPDATE club_players SET membership_confirmed=? WHERE team_id=? AND id=?").run(
        p.membershipConfirmed ? 1 : 0, teamId, id,
      );
      if (p.avatar !== old.avatar)
        q(
          "UPDATE club_players SET avatar_origin_kind=NULL WHERE team_id=? AND id=?",
        ).run(teamId, id);
      if (p.status === "inactive") revokeWechatPlayer(database, teamId, id);
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
          p.number,
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
  const playerSnapshot = (player) => ({
    id: player.id,
    name: player.name,
    number: player.number,
    positions: player.positions,
  });
  tx(() => {
    database.exec(`CREATE TABLE IF NOT EXISTS club_match_tactic_snapshots (
      match_id INTEGER NOT NULL REFERENCES club_matches(id) ON DELETE CASCADE,
      source_tactic_id INTEGER NOT NULL, tactic TEXT NOT NULL,
      captured_at INTEGER NOT NULL, capture_source TEXT NOT NULL CHECK(capture_source IN ('association','migration')),
      PRIMARY KEY(match_id,source_tactic_id)
    ) STRICT`);
    const columns = new Set(
      q("PRAGMA table_info(club_roster)")
        .all()
        .map((column) => column.name),
    );
    if (!columns.has("player_snapshot"))
      database.exec("ALTER TABLE club_roster ADD COLUMN player_snapshot TEXT");
    if (!columns.has("snapshot_captured_at"))
      database.exec(
        "ALTER TABLE club_roster ADD COLUMN snapshot_captured_at INTEGER",
      );
    if (!columns.has("snapshot_source"))
      database.exec(
        "ALTER TABLE club_roster ADD COLUMN snapshot_source TEXT CHECK(snapshot_source IN ('roster','migration'))",
      );
    // Older databases never stored historical contents. Capture current values,
    // explicitly labelled migration, once rather than pretending to recover history.
    const capturedAt = Date.now();
    for (const link of q(`SELECT t.match_id,t.tactic_id FROM club_match_tactics t JOIN club_matches m ON m.id=t.match_id
      LEFT JOIN club_match_tactic_snapshots s ON s.match_id=t.match_id AND s.source_tactic_id=t.tactic_id
      WHERE s.match_id IS NULL AND m.team_id=1`).all()) {
      q(
        "INSERT INTO club_match_tactic_snapshots VALUES (?,?,?,?,'migration')",
      ).run(
        link.match_id,
        link.tactic_id,
        JSON.stringify(legacy.getTactic(link.tactic_id)),
        capturedAt,
      );
    }
    for (const row of q(
      "SELECT team_id,match_id,player_id FROM club_roster WHERE player_snapshot IS NULL",
    ).all()) {
      q(
        "UPDATE club_roster SET player_snapshot=?,snapshot_captured_at=?,snapshot_source='migration' WHERE match_id=? AND player_id=?",
      ).run(
        JSON.stringify(playerSnapshot(getPlayer(row.team_id, row.player_id))),
        capturedAt,
        row.match_id,
        row.player_id,
      );
    }
    q(
      "INSERT OR IGNORE INTO app_migrations(migration_name,applied_at) VALUES ('club-match-snapshots-v4',?)",
    ).run(capturedAt);
  });
  const dummyHash = hashPassword(randomBytes(20).toString("hex"));
  const loginAttempts = new Map();
  function login(input, remoteAddress, transport = "cookie") {
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
    const valid = verify(
      input.password,
      u?.password_enabled === 1 ? u.password_hash : dummyHash,
    );
    if (!u || u.account_enabled !== 1 || u.password_enabled !== 1 || !valid) {
      accountAttempt.count++;
      loginAttempts.set(accountKey, accountAttempt);
      fail(401, "用户名或密码不正确。");
    }
    if (u.player_id && getPlayer(u.team_id, u.player_id).status !== "active")
      fail(403, "此球员账户已停用。");
    loginAttempts.delete(key);
    return issueSession(u, transport);
  }
  function issueSession(u, transport = "cookie", binding = null) {
    u = q("SELECT * FROM club_users WHERE id=?").get(u.id);
    if (!u || u.account_enabled !== 1) fail(403, "此账户已停用。");
    const now = Date.now();
    const token = `${transport === "native" ? "native_" : ""}${randomBytes(32).toString("hex")}`;
    const expiresAt = now + 7 * 86400000;
    q("DELETE FROM club_sessions WHERE expires_at<=?").run(now);
    q(
      "INSERT INTO club_sessions(token_hash,user_id,expires_at,auth_method,wechat_identity_id,wechat_revision) VALUES (?,?,?,?,?,?)",
    ).run(
      tokenHash(token),
      u.id,
      expiresAt,
      binding ? "wechat" : "password",
      binding?.id ?? null,
      binding?.revision ?? null,
    );
    return {
      token,
      ...(transport === "native" ? { expiresAt } : {}),
      ...sessionView(u),
    };
  }
  function authenticate(token, transport = "cookie") {
    const tokenPattern =
      transport === "native" ? /^native_[a-f0-9]{64}$/ : /^[a-f0-9]{64}$/;
    if (typeof token !== "string" || !tokenPattern.test(token))
      fail(401, "请先登录。");
    const u = q(
      "SELECT u.* FROM club_sessions s JOIN club_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND (s.auth_method='password' OR EXISTS (SELECT 1 FROM club_wechat_identities w WHERE w.id=s.wechat_identity_id AND w.user_id=u.id AND w.revoked_at IS NULL AND w.revision=s.wechat_revision AND w.app_id=? AND ?=1))",
    ).get(
      tokenHash(token),
      Date.now(),
      wechatAppId ?? "",
      wechatProvider?.enabled === true ? 1 : 0,
    );
    if (!u || u.account_enabled !== 1) fail(401, "登录已过期，请重新登录。");
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
    const hash = hashPassword(input.newPassword);
    tx(() => {
      getPlayer(teamId, playerId);
      const u = q(
        "SELECT * FROM club_users WHERE team_id=? AND player_id=?",
      ).get(teamId, playerId);
      if (!u) fail(404, "该球员尚未创建账户。");
      if (u.is_system_admin === 1)
        fail(403, "不能通过球员密码重置修改系统管理员。");
      if (u.password_enabled !== 1)
        fail(409, "此账户仅使用微信登录，不能通过密码重置隐式启用密码。");
      q(
        "UPDATE club_users SET password_hash=?,account_revision=account_revision+1 WHERE id=?",
      ).run(hash, u.id);
      q("DELETE FROM club_sessions WHERE user_id=?").run(u.id);
    });
  }
  function changePassword(u, input) {
    object(input);
    const hash = hashPassword(input.newPassword);
    tx(() => {
      const current = q("SELECT * FROM club_users WHERE id=?").get(u.id);
      if (
        !current ||
        current.account_enabled !== 1 ||
        current.account_revision !== u.account_revision
      )
        fail(409, "账户已变更，请重新登录。");
      if (
        current.password_enabled !== 1 ||
        !verify(input.currentPassword, current.password_hash)
      )
        fail(403, "当前密码不正确。");
      if (
        current.must_change_password === 1 &&
        input.newPassword === input.currentPassword
      )
        fail(400, "新密码不能与初始密码相同。");
      q(
        "UPDATE club_users SET password_hash=?,must_change_password=0,account_revision=account_revision+1 WHERE id=?",
      ).run(hash, u.id);
      q("DELETE FROM club_sessions WHERE user_id=?").run(u.id);
    });
  }
  const accountView = (r) => ({
    id: r.id,
    username: r.username,
    role: r.role,
    playerId: r.player_id,
    systemAdmin: r.is_system_admin === 1,
    enabled: r.account_enabled === 1,
    revision: r.account_revision,
    passwordEnabled: r.password_enabled === 1,
    mustChangePassword: r.must_change_password === 1,
  });
  function systemActor(actor) {
    const current = q("SELECT * FROM club_users WHERE id=?").get(actor.id);
    if (
      !current ||
      current.team_id !== actor.team_id ||
      current.role !== "admin" ||
      current.is_system_admin !== 1 ||
      current.account_enabled !== 1 ||
      current.must_change_password === 1 ||
      current.account_revision !== actor.account_revision
    )
      fail(403, "此操作需要有效的系统管理员权限。");
    return current;
  }
  function listSystemAccounts(actor) {
    return tx(() => {
      const a = systemActor(actor);
      return q("SELECT * FROM club_users WHERE team_id=? ORDER BY id")
        .all(a.team_id)
        .map(accountView);
    });
  }
  function createSystemAccount(actor, input) {
    object(input);
    if (Object.keys(input).some((k) => !["username", "password"].includes(k)))
      fail(400, "只能创建普通管理员账户。");
    const username = text(input.username, 100, true),
      hash = hashPassword(input.password);
    return tx(() => {
      const a = systemActor(actor);
      if (
        q("SELECT id FROM club_users WHERE username=? COLLATE NOCASE").get(
          username,
        )
      )
        fail(409, "用户名已存在，请核对账户列表。");
      const result = q(
        "INSERT INTO club_users(team_id,username,password_hash,role,must_change_password) VALUES(?,?,?,'admin',1)",
      ).run(a.team_id, username, hash);
      return accountView(
        q("SELECT * FROM club_users WHERE id=?").get(result.lastInsertRowid),
      );
    });
  }
  function bindOwnPlayer(actor, input) {
    object(input);
    if (Object.keys(input).some(k => !['playerId', 'revision'].includes(k)) || typeof input.playerId !== 'string' || !input.playerId)
      fail(400, '请选择本人的球员身份。');
    return tx(() => {
      const a = systemActor(actor);
      if (!Number.isSafeInteger(input.revision) || input.revision !== a.account_revision)
        fail(409, '账户已变更，请重新登录后核对。');
      if (a.player_id) {
        if (a.player_id !== input.playerId) fail(409, '已有球员身份，不可更换。');
        return accountView(a);
      }
      const player = q('SELECT * FROM club_players WHERE id=? AND team_id=?').get(input.playerId, a.team_id);
      if (!player || player.status !== 'active' || player.membership_confirmed !== 1)
        fail(400, '只能关联本队已确认的在册球员。');
      if (q('SELECT id FROM club_users WHERE player_id=?').get(player.id))
        fail(409, '该球员已关联其他账户。');
      q('UPDATE club_users SET player_id=?,account_revision=account_revision+1 WHERE id=?').run(player.id,a.id);
      q('DELETE FROM club_sessions WHERE user_id=?').run(a.id);
      q('UPDATE club_wechat_epoch SET revision=revision+1 WHERE id=1').run();
      return accountView(q('SELECT * FROM club_users WHERE id=?').get(a.id));
    });
  }
  function updateSystemAccount(actor, id, input) {
    object(input);
    if (
      Object.keys(input).some(
        (k) => !["revision", "role", "enabled"].includes(k),
      )
    )
      fail(400, "不支持修改此账户字段。");
    return tx(() => {
      const a = systemActor(actor),
        target = q("SELECT * FROM club_users WHERE id=? AND team_id=?").get(
          id,
          a.team_id,
        );
      if (!target) fail(404, "账户不存在。");
      if (target.is_system_admin === 1)
        fail(403, "系统管理员账户不可在此修改。");
      if (
        !Number.isSafeInteger(input.revision) ||
        input.revision !== target.account_revision
      )
        fail(409, "账户已变更，请刷新后重试。");
      const role =
        input.role === undefined
          ? target.role
          : oneOf(input.role, ["admin", "player"]);
      const enabled =
        input.enabled === undefined
          ? target.account_enabled === 1
          : input.enabled;
      if (typeof enabled !== "boolean") fail(400, "账户启用状态不正确。");
      if (role === "player" && !target.player_id)
        fail(400, "独立管理员没有关联球员，请使用停用账户。");
      q(
        "UPDATE club_users SET role=?,account_enabled=?,account_revision=account_revision+1 WHERE id=?",
      ).run(role, enabled ? 1 : 0, id);
      q("DELETE FROM club_sessions WHERE user_id=?").run(id);
      // 使在途微信交换跨过授权/停用/重新启用的旧代次失效，避免ABA重新签发。
      q("UPDATE club_wechat_epoch SET revision=revision+1 WHERE id=1").run();
      return accountView(q("SELECT * FROM club_users WHERE id=?").get(id));
    });
  }
  const seasonView = (r) => ({
    id: r.id,
    revision: r.revision,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
    icon: r.icon,
    image: r.image,
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
    const s = {
      ...(id ? getSeason(teamId, id) : { icon: null, image: null }),
      ...input,
    };
    s.name = text(s.name, 200, true);
    date(s.startDate);
    date(s.endDate);
    s.icon = validateClubImage(s.icon);
    s.image = validateClubImage(s.image);
    if (s.startDate > s.endDate) fail(400, "赛季结束日期不能早于开始日期。");
    return tx(() => {
      if (id) {
        checkRevision(input, getSeason(teamId, id));
        if (
          q(
            "SELECT 1 FROM club_matches WHERE team_id=? AND season_id=? AND (match_date<? OR match_date>?) LIMIT 1",
          ).get(teamId, id, s.startDate, s.endDate)
        )
          fail(
            409,
            "新的赛季日期范围会排除已归属比赛，请先调整比赛归属或日期。",
          );
      }
      if (id)
        q(
          "UPDATE club_seasons SET name=?,start_date=?,end_date=?,icon=?,image=?,revision=revision+1 WHERE id=? AND team_id=?",
        ).run(s.name, s.startDate, s.endDate, s.icon, s.image, id, teamId);
      else
        id = Number(
          q(
            "INSERT INTO club_seasons(team_id,name,start_date,end_date,icon,image) VALUES (?,?,?,?,?,?)",
          ).run(teamId, s.name, s.startDate, s.endDate, s.icon, s.image)
            .lastInsertRowid,
        );
      return getSeason(teamId, id);
    });
  }
  function getSeasonRoster(teamId, id) {
    const season = getSeason(teamId, id);
    const roster = q(
      "SELECT player_id AS playerId,name,number,positions FROM club_season_roster WHERE team_id=? AND season_id=? ORDER BY number IS NULL,number,player_id",
    )
      .all(teamId, id)
      .map((p) => ({ ...p, positions: JSON.parse(p.positions) }));
    return { season, roster };
  }
  function saveSeasonRoster(teamId, id, input) {
    object(input);
    return tx(() => {
      const old = getSeasonRoster(teamId, id);
      checkRevision(input, old.season);
      if (!Array.isArray(input.roster) || input.roster.length > 1000)
        fail(400, "请提供赛季名单。");
      const seen = new Set(),
        previous = new Map(old.roster.map((p) => [p.playerId, p]));
      const rows = input.roster.map((row) => {
        object(row);
        if (typeof row.playerId !== "string" || seen.has(row.playerId))
          fail(400, "赛季名单球员不能重复。");
        seen.add(row.playerId);
        const current = getPlayer(teamId, row.playerId),
          saved = previous.get(row.playerId);
        return {
          playerId: row.playerId,
          name: saved?.name ?? current.name,
          number:
            row.number === undefined
              ? saved
                ? saved.number
                : current.number
              : integer(row.number),
          positions: saved?.positions ?? current.positions,
        };
      });
      q("DELETE FROM club_season_roster WHERE season_id=?").run(id);
      for (const row of rows)
        q("INSERT INTO club_season_roster VALUES (?,?,?,?,?,?)").run(
          teamId,
          id,
          row.playerId,
          row.name,
          row.number,
          JSON.stringify(row.positions),
        );
      q(
        "UPDATE club_seasons SET revision=revision+1 WHERE id=? AND team_id=?",
      ).run(id, teamId);
      return getSeasonRoster(teamId, id);
    });
  }
  function getMatch(u, id, { includeTacticSnapshots = true } = {}) {
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
      competition: r.competition,
      competitionId: r.competition_id,
      competitionSnapshot: r.competition_snapshot
        ? JSON.parse(r.competition_snapshot)
        : null,
      opponentId: r.opponent_id,
      opponentSnapshot: r.opponent_snapshot
        ? JSON.parse(r.opponent_snapshot)
        : null,
      noticeTemplateId: r.notice_template_id,
      format: r.format,
      maxParticipants: r.max_participants,
      side: r.side,
      seasonId: r.season_id,
      date: r.match_date,
      kickoff: r.kickoff,
      location: r.location,
      venueId: r.venue_id,
      venueSnapshot: r.venue_snapshot ? JSON.parse(r.venue_snapshot) : null,
      status: r.status,
      homeScore: r.home_score,
      awayScore: r.away_score,
      analysis: r.analysis,
      notice: r.notice,
      coverPhotoId: r.cover_photo_id,
      tacticIds: q(
        "SELECT source_tactic_id FROM club_match_tactic_snapshots WHERE match_id=? ORDER BY source_tactic_id",
      )
        .all(id)
        .map((t) => t.source_tactic_id),
      ...(includeTacticSnapshots
        ? {
            tacticSnapshots: q(
              "SELECT * FROM club_match_tactic_snapshots WHERE match_id=? ORDER BY source_tactic_id",
            )
              .all(id)
              .map((t) => ({
                sourceTacticId: t.source_tactic_id,
                tactic: JSON.parse(t.tactic),
                capturedAt: t.captured_at,
                captureSource: t.capture_source,
              })),
          }
        : {}),
      rsvps: q(
        "SELECT player_id AS playerId,response FROM club_rsvps WHERE match_id=?",
      ).all(id),
      roster: q(
        "SELECT player_id AS playerId,position,selection,appeared,goals,assists,player_snapshot,snapshot_captured_at,snapshot_source FROM club_roster WHERE match_id=?",
      )
        .all(id)
        .map(
          ({
            player_snapshot,
            snapshot_captured_at,
            snapshot_source,
            ...p
          }) => ({
            ...p,
            appeared: p.appeared === null ? null : Boolean(p.appeared),
            playerSnapshot:
              player_snapshot === null ? null : JSON.parse(player_snapshot),
            snapshotCapturedAt: snapshot_captured_at,
            snapshotSource: snapshot_source,
          }),
        ),
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
            competition: "",
            competitionId: null,
            opponentId: null,
            noticeTemplateId: null,
            format: null,
            maxParticipants: null,
            side: "unknown",
            seasonId: null,
            date: "",
            kickoff: "",
            location: "",
            venueId: null,
            venueSnapshot: null,
            status: "draft",
            homeScore: null,
            awayScore: null,
            analysis: "",
            notice: "",
            tacticIds: [],
          }),
      ...input,
    };
    for (const field of ["competitionId", "opponentId", "noticeTemplateId"])
      if (m[field] !== null && (!Number.isSafeInteger(m[field]) || m[field] < 1))
        fail(400, "请选择有效的赛事、对手或须知模板。");
    if (m.format !== null) oneOf(m.format, [5, 6, 7, 8, 9, 11]);
    if (m.maxParticipants !== null && (!Number.isSafeInteger(m.maxParticipants) || m.maxParticipants < 1 || m.maxParticipants > 10000))
      fail(400, "报名人数须为 1 至 10000 的整数，或留空表示不限。");
    oneOf(m.side, ["home", "away", "neutral", "unknown"]);
    if (
      m.seasonId !== null &&
      (!Number.isSafeInteger(m.seasonId) || m.seasonId < 1)
    )
      fail(400, "赛季编号不正确。");
    date(m.date);
    m.kickoff = text(m.kickoff, 5);
    if (m.kickoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(m.kickoff))
      fail(400, "开球时间须为 HH:mm。");
    m.location = text(m.location, 500);
    if (
      m.venueId !== null &&
      (!Number.isSafeInteger(m.venueId) || m.venueId < 1)
    )
      fail(400, "球场编号不正确。");
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

    validateTotals(m.homeScore, id ? getMatch(u, id).roster : []);
    return tx(() => {
      const previousMatch = id ? getMatch(u, id) : null;
      if (id) checkRevision(input, previousMatch);
      // References are conveniences, not live joins. Capture only on an explicit
      // new association; metadata edits and later catalog changes keep history.
      const referenceSnapshots = {};
      for (const [kind, field, textField, sourceField, snapshotField] of [
        ["competitions", "competitionId", "competition", "name", "competitionSnapshot"],
        ["opponents", "opponentId", "opponent", "name", "opponentSnapshot"],
        ["notice-templates", "noticeTemplateId", "notice", "content", null],
      ]) {
        const changed = m[field] !== (previousMatch?.[field] ?? null);
        let snapshot = snapshotField ? previousMatch?.[snapshotField] ?? null : null;
        if (m[field] === null) snapshot = null;
        else if (changed || (snapshotField && !snapshot)) {
          const entry = catalogs.getCatalogEntry(kind, u.team_id, m[field]);
          if (entry.status !== "active") fail(400, "已停用资料不能用于新的比赛关联。");
          if (input[textField] === undefined) m[textField] = entry[sourceField];
          if (snapshotField) {
            // Match readers only need display identity, not the catalog's
            // administrator-only introduction or player notes.
            snapshot = { name: entry.name, logo: entry.logo };
          }
        }
        if (snapshotField) referenceSnapshots[snapshotField] = snapshot;
      }
      m.opponent = text(m.opponent, 200, true);
      m.competition = text(m.competition, 200);
      m.notice = text(m.notice, 10000);
      if (m.maxParticipants !== null && previousMatch && previousMatch.rsvps.filter(r => r.response === "yes").length > m.maxParticipants)
        fail(409, "报名人数不能小于已参加人数。");
      // Never trust client snapshots. Reusing the same venue retains history;
      // omission preserves older clients, explicit null detaches the venue.
      const changedVenue = m.venueId !== (previousMatch?.venueId ?? null);
      let venueSnapshot = previousMatch?.venueSnapshot ?? null;
      if (m.venueId === null) venueSnapshot = null;
      else if (changedVenue || !venueSnapshot) {
        const venue = venues.getVenue(u.team_id, m.venueId);
        if (venue.status !== "active")
          fail(400, "已停用球场不能用于新的比赛关联。");
        venueSnapshot = {
          name: venue.name,
          fieldNumber: venue.fieldNumber,
          address: venue.address,
          latitude: venue.latitude,
          longitude: venue.longitude,
          coordinateSystem: "gcj02",
        };
        if (input.location === undefined)
          m.location = [venue.name, venue.fieldNumber, venue.address]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 500);
      }
      if (m.seasonId !== null) {
        const season = getSeason(u.team_id, m.seasonId);
        if (m.date < season.startDate || m.date > season.endDate)
          fail(400, "比赛日期必须落在所属赛季的日期范围内。");
      }
      if (id)
        q(
          "UPDATE club_matches SET opponent=?,match_date=?,kickoff=?,location=?,status=?,home_score=?,away_score=?,analysis=?,competition=?,format=?,max_participants=?,side=?,season_id=?,revision=revision+1 WHERE id=? AND team_id=?",
        ).run(
          m.opponent,
          m.date,
          m.kickoff,
          m.location,
          m.status,
          m.homeScore,
          m.awayScore,
          m.analysis,
          m.competition,
          m.format,
          m.maxParticipants,
          m.side,
          m.seasonId,
          id,
          u.team_id,
        );
      else
        id = Number(
          q(
            "INSERT INTO club_matches(team_id,opponent,match_date,kickoff,location,status,home_score,away_score,analysis,competition,format,max_participants,side,season_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
            m.competition,
            m.format,
            m.maxParticipants,
            m.side,
            m.seasonId,
          ).lastInsertRowid,
        );
      q(
        "UPDATE club_matches SET venue_id=?,venue_snapshot=? WHERE id=? AND team_id=?",
      ).run(
        m.venueId,
        venueSnapshot ? JSON.stringify(venueSnapshot) : null,
        id,
        u.team_id,
      );
      q("UPDATE club_matches SET notice=? WHERE id=? AND team_id=?").run(
        m.notice,
        id,
        u.team_id,
      );
      q(
        "UPDATE club_matches SET competition_id=?,opponent_id=?,notice_template_id=?,competition_snapshot=?,opponent_snapshot=? WHERE id=? AND team_id=?",
      ).run(
        m.competitionId,
        m.opponentId,
        m.noticeTemplateId,
        referenceSnapshots.competitionSnapshot
          ? JSON.stringify(referenceSnapshots.competitionSnapshot)
          : null,
        referenceSnapshots.opponentSnapshot
          ? JSON.stringify(referenceSnapshots.opponentSnapshot)
          : null,
        id,
        u.team_id,
      );
      const wanted = new Set(m.tacticIds);
      const previous = q(
        "SELECT source_tactic_id FROM club_match_tactic_snapshots WHERE match_id=?",
      ).all(id);
      for (const old of previous)
        if (!wanted.has(old.source_tactic_id))
          q(
            "DELETE FROM club_match_tactic_snapshots WHERE match_id=? AND source_tactic_id=?",
          ).run(id, old.source_tactic_id);
      let snapshotBytes = q(
        "SELECT coalesce(sum(length(CAST(tactic AS BLOB))),0) AS bytes FROM club_match_tactic_snapshots WHERE match_id=?",
      ).get(id).bytes;
      for (const tacticId of wanted) {
        if (
          !q(
            "SELECT 1 FROM club_match_tactic_snapshots WHERE match_id=? AND source_tactic_id=?",
          ).get(id, tacticId)
        ) {
          const captured = JSON.stringify(legacy.getTactic(tacticId));
          snapshotBytes += Buffer.byteLength(captured, "utf8");
          if (snapshotBytes > MAX_MATCH_SNAPSHOT_BYTES)
            fail(
              413,
              "单场比赛的战术快照总量不能超过 32 MiB，请减少关联战术。",
            );
          q(
            "INSERT INTO club_match_tactic_snapshots VALUES (?,?,?,?,'association')",
          ).run(id, tacticId, captured, Date.now());
        }
      }
      // Compatibility links can disappear with a template; independent snapshots cannot.
      q("DELETE FROM club_match_tactics WHERE match_id=?").run(id);
      for (const tacticId of wanted)
        if (q("SELECT 1 FROM tactics WHERE tactic_id=?").get(tacticId))
          q("INSERT INTO club_match_tactics VALUES (?,?)").run(id, tacticId);
      return getMatch(u, id);
    });
  }
  function saveRsvp(u, id, input) {
    object(input);
    return tx(() => {
      const m = getMatch(u, id);
      if (!u.player_id) fail(403, "管理员账户未绑定球员，不能代替球员报名。");
      if (m.status !== "published") fail(409, "仅已发布的比赛可以报名。");
      oneOf(input.response, ["yes", "no", "maybe"]);
      const existing = m.rsvps.find(r => r.playerId === u.player_id);
      if (input.response === "yes" && existing?.response !== "yes" && m.maxParticipants !== null &&
          m.rsvps.filter(r => r.response === "yes").length >= m.maxParticipants)
        fail(409, "报名人数已满，可选择待定或请假。");
      q("INSERT INTO club_rsvps(team_id,match_id,player_id,response) VALUES (?,?,?,?) ON CONFLICT(match_id,player_id) DO UPDATE SET response=excluded.response")
        .run(u.team_id, id, u.player_id, input.response);
      return getMatch(u, id);
    });
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
      const selection = oneOf(p.selection ?? "unknown", [
        "starter",
        "bench",
        "unknown",
      ]);
      const appeared = p.appeared ?? null;
      if (appeared !== null && typeof appeared !== "boolean")
        fail(400, "出场须为是、否或未知。");
      const goals = integer(p.goals ?? null),
        assists = integer(p.assists ?? null);
      if (appeared !== true && (goals !== null || assists !== null))
        fail(400, "仅确认出场的球员可记录进球和助攻。");
      return { ...p, position, selection, appeared, goals, assists };
    });
    validateTotals(getMatch(u, id).homeScore, rows);
    return tx(() => {
      const match = getMatch(u, id);
      checkRevision(input, match);
      q(
        "UPDATE club_matches SET revision=revision+1 WHERE id=? AND team_id=?",
      ).run(id, u.team_id);
      const previous = new Map(
        q(
          "SELECT player_id,player_snapshot,snapshot_captured_at,snapshot_source FROM club_roster WHERE match_id=?",
        )
          .all(id)
          .map((row) => [row.player_id, row]),
      );
      q("DELETE FROM club_roster WHERE match_id=?").run(id);
      for (const p of rows) {
        const old = previous.get(p.playerId);
        const seasonal =
          match.seasonId === null
            ? undefined
            : q(
                "SELECT name,number,positions FROM club_season_roster WHERE team_id=? AND season_id=? AND player_id=?",
              ).get(u.team_id, match.seasonId, p.playerId);
        const captured = seasonal
          ? {
              id: p.playerId,
              name: seasonal.name,
              number: seasonal.number,
              positions: JSON.parse(seasonal.positions),
            }
          : playerSnapshot(getPlayer(u.team_id, p.playerId));
        q(
          "INSERT INTO club_roster (team_id,match_id,player_id,position,appeared,goals,assists,player_snapshot,snapshot_captured_at,snapshot_source,selection) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          u.team_id,
          id,
          p.playerId,
          p.position,
          p.appeared === null ? null : Number(p.appeared),
          p.goals,
          p.assists,
          old?.player_snapshot ?? JSON.stringify(captured),
          old?.snapshot_captured_at ?? Date.now(),
          old?.snapshot_source ?? "roster",
          p.selection,
        );
      }
      return getMatch(u, id);
    });
  }
  function statistics(u, params) {
    let startDate,
      endDate,
      label,
      filterSeasonId = null;
    if (["year", "seasonId", "all"].filter((key) => params.has(key)).length > 1)
      fail(400, "请选择全部比赛、赛季或自然年其中一种统计范围。");
    const allMatches = params.has("all");
    if (allMatches) {
      if (params.get("all") !== "1") fail(400, "统计范围不正确。");
      startDate = null;
      endDate = null;
      label = "全部比赛";
    } else if (params.has("seasonId")) {
      const id = Number(params.get("seasonId"));
      if (!Number.isSafeInteger(id) || id < 1) fail(400, "赛季编号不正确。");
      const s = getSeason(u.team_id, id);
      filterSeasonId = id;
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
    const scope =
      allMatches ? "1=1" : filterSeasonId === null
        ? "m.match_date BETWEEN ? AND ?"
        : "m.season_id=?";
    const scopeArgs = allMatches ? [] :
      filterSeasonId === null ? [startDate, endDate] : [filterSeasonId];
    const rows = q(
      `SELECT r.* FROM club_roster r JOIN club_matches m ON m.id=r.match_id WHERE m.team_id=? AND m.status='completed' AND ${scope}`,
    ).all(u.team_id, ...scopeArgs);
    const completed = q(
      `SELECT m.opponent,m.home_score,m.away_score FROM club_matches m WHERE m.team_id=? AND m.status='completed' AND ${scope}`,
    ).all(u.team_id, ...scopeArgs);
    const registrationMatches = q(
      `SELECT count(*) AS n FROM club_matches m WHERE m.team_id=? AND m.status IN ('published','completed') AND ${scope}`,
    ).get(u.team_id, ...scopeArgs).n;
    const registrations = q(
      `SELECT r.player_id,r.response FROM club_rsvps r JOIN club_matches m ON m.id=r.match_id WHERE m.team_id=? AND m.status IN ('published','completed') AND ${scope}`,
    ).all(u.team_id, ...scopeArgs);
    const unassignedMatches = q(
      "SELECT count(*) AS n FROM club_matches WHERE team_id=? AND season_id IS NULL AND status IN ('published','completed')",
    ).get(u.team_id).n;
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
    team.attendance = {
      confirmedAppearances: rows.filter((r) => r.appeared === 1).length,
      unknownAppearances: rows.filter((r) => r.appeared === null).length,
      matchesWithoutRoster,
    };
    const players = listPlayers(u.team_id).map((p) => {
      const records = rows.filter((r) => r.player_id === p.id),
        played = records.filter((r) => r.appeared === 1),
        goals = played.filter((r) => r.goals !== null),
        assists = played.filter((r) => r.assists !== null);
      return {
        playerId: p.id,
        name: p.name,
        registration: {
          yes: registrations.filter(
            (r) => r.player_id === p.id && r.response === "yes",
          ).length,
          no: registrations.filter(
            (r) => r.player_id === p.id && r.response === "no",
          ).length,
          maybe: registrations.filter(
            (r) => r.player_id === p.id && r.response === "maybe",
          ).length,
          unanswered:
            registrationMatches -
            registrations.filter((r) => r.player_id === p.id).length,
        },
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
      registrationMatches,
      unassignedMatches,
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
      syncLegacy({ overwrite: true, reactivate: true, validateChanges: true });
      // A null desk resets the board, not club membership. A non-null roster
      // removes members from the previous canonical roster. Profile edits bump
      // the desk edition, so clients unaware of appended profiles cannot remove them.
      // Before initial board creation the previous roster is empty.
      if (request.desk !== null) {
        const supplied = new Set(request.desk.players.map((p) => p.playerId));
        for (const id of previousIds) {
          if (supplied.has(id)) continue;
          assertPlayerArchivable(1, id);
          q(
            "UPDATE club_players SET status='inactive',revision=revision+1 WHERE id=? AND team_id=1 AND status!='inactive'",
          ).run(id);
          revokeWechatPlayer(database, 1, id);
        }
      }
    });
    return tacticalDesk();
  }
  function tacticalDesk() {
    const result = legacy.getDesk();
    // Uninitialized/reset boards use only actual club profiles, never demo seeds.
    const existing = new Map(
      (result.desk?.players ?? []).map((p) => [p.playerId, p]),
    );
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
    const players = ordered.map((p) => ({
      ...existing.get(p.id),
      playerId: p.id,
      name: p.name,
      number: p.number,
      positions: p.positions,
      preferredFoot: p.preferredFoot,
      status: existing.get(p.id)?.status ?? "ok",
      note: p.note,
      avatar: p.avatar,
      fieldPieceId: existing.get(p.id)?.fieldPieceId ?? null,
    }));
    if (!result.desk) return { ...result, initialPlayers: players };
    result.desk.players = players;
    return result;
  }
  function assertTacticDeletable(tacticId) {
    const linked = q(
      "SELECT m.id,m.opponent FROM club_match_tactics t JOIN club_matches m ON m.id=t.match_id LEFT JOIN club_match_tactic_snapshots s ON s.match_id=t.match_id AND s.source_tactic_id=t.tactic_id WHERE t.tactic_id=? AND s.match_id IS NULL ORDER BY m.id",
    ).all(tacticId);
    if (linked.length)
      fail(
        409,
        `该战术仍关联 ${linked.length} 场尚未保存快照的比赛（${linked
          .slice(0, 3)
          .map((m) => `${m.id}: ${m.opponent}`)
          .join("、")}），请先解除比赛关联后再删除。`,
      );
  }
  const wechat = createWechatIdentityStore(database, {
    provider: wechatProvider,
    appId: wechatAppId,
    authenticate,
    issueSession,
    getPlayer,
  });
  return {
    wechat,
    assertTacticDeletable,
    ...venues,
    ...catalogs,
    ...matchMedia,
    getTeam,
    saveTeam,
    login,
    authenticate,
    sessionView,
    changePassword,
    listSystemAccounts,
    createSystemAccount,
    updateSystemAccount,
    bindOwnPlayer,
    createAccount,
    resetPassword,
    listPlayers,
    getPlayer,
    savePlayer,
    getSeason,
    saveSeason,
    getSeasonRoster,
    saveSeasonRoster,
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
        .map((r) => getMatch(u, r.id, { includeTacticSnapshots: false })),
  };
}
