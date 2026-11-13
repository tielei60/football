import { FootballError } from "./football-store.mjs";

const fail = (status, message) => {
  throw new FootballError(status, message);
};
const view = (r) => ({
  id: r.id,
  revision: r.revision,
  name: r.name,
  address: r.address,
  latitude: r.latitude,
  longitude: r.longitude,
  coordinateSystem: "gcj02",
  status: r.status,
});
const text = (v, max, required = false) => {
  if (typeof v !== "string" || v.length > max || (required && !v.trim()))
    fail(400, "场地名称或地址格式不正确。");
  return v.trim();
};
export function createVenueStore(database) {
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS club_venues (
      id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES club_teams(id),
      revision INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '',
      latitude REAL, longitude REAL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
      CHECK((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)),
      UNIQUE(team_id,id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS club_venues_team ON club_venues(team_id,status,id);`);
    const cols = new Set(
      database
        .prepare("PRAGMA table_info(club_matches)")
        .all()
        .map((r) => r.name),
    );
    if (!cols.has("venue_id"))
      database.exec(
        "ALTER TABLE club_matches ADD COLUMN venue_id INTEGER REFERENCES club_venues(id)",
      );
    if (!cols.has("venue_snapshot"))
      database.exec("ALTER TABLE club_matches ADD COLUMN venue_snapshot TEXT");
    database.exec("COMMIT");
  } catch (e) {
    database.exec("ROLLBACK");
    throw e;
  }
  const get = (teamId, id) => {
    const r = database
      .prepare("SELECT * FROM club_venues WHERE team_id=? AND id=?")
      .get(teamId, id);
    if (!r) fail(404, "未找到球场。");
    return view(r);
  };
  const save = (teamId, id, input) => {
    if (!input || typeof input !== "object" || Array.isArray(input))
      fail(400, "球场资料格式不正确。");
    database.exec("BEGIN IMMEDIATE");
    try {
      const old = id
        ? get(teamId, id)
        : {
            name: "",
            address: "",
            latitude: null,
            longitude: null,
            status: "active",
          };
      if (id) {
        if (!Number.isSafeInteger(input.revision) || input.revision < 1)
          fail(428, "请携带当前球场版本号。");
        if (input.revision !== old.revision)
          fail(409, "球场已在其他页面更新，请重新加载后保存。");
      }
      const v = { ...old, ...input };
      v.name = text(v.name, 200, true);
      v.address = text(v.address, 300);
      if (!["active", "inactive"].includes(v.status))
        fail(400, "球场状态不正确。");
      if (
        input.coordinateSystem !== undefined &&
        input.coordinateSystem !== "gcj02"
      )
        fail(400, "球场坐标必须为 GCJ-02。");
      if (
        !(v.latitude === null && v.longitude === null) &&
        !(
          typeof v.latitude === "number" &&
          Number.isFinite(v.latitude) &&
          v.latitude >= -90 &&
          v.latitude <= 90 &&
          typeof v.longitude === "number" &&
          Number.isFinite(v.longitude) &&
          v.longitude >= -180 &&
          v.longitude <= 180
        )
      )
        fail(400, "经纬度必须成对填写有效数字，或同时留空。");
      if (id)
        database
          .prepare(
            "UPDATE club_venues SET name=?,address=?,latitude=?,longitude=?,status=?,revision=revision+1 WHERE team_id=? AND id=?",
          )
          .run(
            v.name,
            v.address,
            v.latitude,
            v.longitude,
            v.status,
            teamId,
            id,
          );
      else
        id = Number(
          database
            .prepare(
              "INSERT INTO club_venues(team_id,name,address,latitude,longitude,status) VALUES(?,?,?,?,?,?)",
            )
            .run(teamId, v.name, v.address, v.latitude, v.longitude, v.status)
            .lastInsertRowid,
        );
      const result = get(teamId, id);
      database.exec("COMMIT");
      return result;
    } catch (e) {
      database.exec("ROLLBACK");
      throw e;
    }
  };
  return {
    getVenue: get,
    saveVenue: save,
    listVenues: (teamId) =>
      database
        .prepare(
          "SELECT * FROM club_venues WHERE team_id=? ORDER BY status,name,id",
        )
        .all(teamId)
        .map(view),
  };
}
