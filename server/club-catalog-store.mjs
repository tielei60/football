import { FootballError } from "./football-store.mjs";
import { sanitizePlayerPhoto } from "./player-media-store.mjs";

const definitions = {
  competitions: { table: "club_competitions", label: "赛事" },
  opponents: { table: "club_opponents", label: "对手" },
  "notice-templates": { table: "club_notice_templates", label: "比赛须知模板" },
};
const fail = (status, message) => {
  throw new FootballError(status, message);
};
const object = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "请提交有效资料。");
  return value;
};
const text = (value, max, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim()))
    fail(400, "文字为空或超过长度限制。");
  return value.trim();
};

// Reuse the album decoder, including static-image checks, resource limits and
// metadata removal. Callers must authenticate again after this asynchronous work.
export async function prepareClubImages(input, fields, previous = {}) {
  const prepared = { ...object(input) };
  for (const field of fields) {
    if (prepared[field] !== undefined && prepared[field] !== null && prepared[field] !== previous[field])
      prepared[field] = (await sanitizePlayerPhoto(prepared[field])).dataUrl;
  }
  return prepared;
}

export function createClubCatalogStore(db, validateImage) {
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
  tx(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS club_competitions (
        id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES club_teams(id),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), name TEXT NOT NULL,
        logo TEXT, introduction TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
        UNIQUE(team_id,id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS club_opponents (
        id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES club_teams(id),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), name TEXT NOT NULL,
        logo TEXT, introduction TEXT NOT NULL DEFAULT '', player_summary TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
        UNIQUE(team_id,id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS club_notice_templates (
        id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES club_teams(id),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), title TEXT NOT NULL, content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
        UNIQUE(team_id,id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS club_competitions_team ON club_competitions(team_id,status,id);
      CREATE INDEX IF NOT EXISTS club_opponents_team ON club_opponents(team_id,status,id);
      CREATE INDEX IF NOT EXISTS club_notice_templates_team ON club_notice_templates(team_id,status,id);
    `);
    const seasonColumns = new Set(
      q("PRAGMA table_info(club_seasons)")
        .all()
        .map((c) => c.name)
    );
    for (const name of ["icon", "image"])
      if (!seasonColumns.has(name)) db.exec(`ALTER TABLE club_seasons ADD COLUMN ${name} TEXT`);
    const matchColumns = new Set(
      q("PRAGMA table_info(club_matches)")
        .all()
        .map((c) => c.name)
    );
    for (const [name, definition] of [
      ["competition_id", "INTEGER REFERENCES club_competitions(id)"],
      ["opponent_id", "INTEGER REFERENCES club_opponents(id)"],
      ["notice_template_id", "INTEGER REFERENCES club_notice_templates(id)"],
      ["competition_snapshot", "TEXT"],
      ["opponent_snapshot", "TEXT"],
    ])
      if (!matchColumns.has(name)) db.exec(`ALTER TABLE club_matches ADD COLUMN ${name} ${definition}`);
    // Deliberately do not infer references from legacy free text or seed catalog
    // entries. Unknown historical associations remain NULL.
    q("INSERT OR IGNORE INTO app_migrations(migration_name,applied_at) VALUES ('club-catalogs-v1',?)").run(Date.now());
  });

  const definition = (kind) => {
    const d = Object.hasOwn(definitions, kind) ? definitions[kind] : null;
    if (!d) fail(404, "未找到资料目录。");
    return d;
  };
  const view = (kind, row) => ({
    id: row.id,
    revision: row.revision,
    status: row.status,
    ...(kind === "notice-templates"
      ? { title: row.title, content: row.content }
      : {
          name: row.name,
          logo: row.logo,
          introduction: row.introduction,
          ...(kind === "opponents" ? { playerSummary: row.player_summary } : {}),
        }),
  });
  const get = (kind, teamId, id) => {
    const d = definition(kind);
    const row = q(`SELECT * FROM ${d.table} WHERE team_id=? AND id=?`).get(teamId, id);
    if (!row) fail(404, `未找到${d.label}。`);
    return view(kind, row);
  };
  const save = (kind, teamId, id, input) => {
    object(input);
    const d = definition(kind);
    return tx(() => {
      const old = id
        ? get(kind, teamId, id)
        : {
            name: "",
            title: "",
            content: "",
            logo: null,
            introduction: "",
            playerSummary: "",
            status: "active",
          };
      if (id) {
        if (!Number.isSafeInteger(input.revision) || input.revision < 1)
          fail(428, "请携带当前版本号保存，重新加载后再试。");
        if (input.revision !== old.revision) fail(409, "资料已在其他页面更新，请重新加载后再保存。");
      }
      const value = { ...old, ...input };
      if (!["active", "inactive"].includes(value.status)) fail(400, "状态不正确。");
      const fields =
        kind === "notice-templates"
          ? { title: text(value.title, 200, true), content: text(value.content, 10000, true) }
          : {
              name: text(value.name, 200, true),
              logo: validateImage(value.logo),
              introduction: text(value.introduction, 10000),
              ...(kind === "opponents" ? { player_summary: text(value.playerSummary, 10000) } : {}),
            };
      fields.status = value.status;
      const names = Object.keys(fields),
        values = Object.values(fields);
      if (id)
        q(
          `UPDATE ${d.table} SET ${names.map((name) => `${name}=?`).join(",")},revision=revision+1 WHERE team_id=? AND id=?`
        ).run(...values, teamId, id);
      else
        id = Number(
          q(`INSERT INTO ${d.table}(team_id,${names.join(",")}) VALUES(?,${names.map(() => "?").join(",")})`).run(
            teamId,
            ...values
          ).lastInsertRowid
        );
      return get(kind, teamId, id);
    });
  };
  return {
    getCatalogEntry: get,
    saveCatalogEntry: save,
    listCatalogEntries: (kind, teamId, { summary = false } = {}) => {
      const { table } = definition(kind);
      if (summary && kind !== "notice-templates")
        return q(`SELECT id,name,status FROM ${table} WHERE team_id=? ORDER BY status,name,id`).all(teamId);
      return q(
        `SELECT * FROM ${table} WHERE team_id=? ORDER BY status,${kind === "notice-templates" ? "title" : "name"},id`
      )
        .all(teamId)
        .map((row) => view(kind, row));
    },
  };
}
