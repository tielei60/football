import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class FootballError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const reject = (message) => {
  throw new FootballError(400, message);
};
const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value, name, maximum = 20000) => {
  if (typeof value !== "string" || value.length > maximum)
    reject(`${name}须为不超过 ${maximum} 字符的文字。`);
  return value;
};
const time = (value, fallback) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) reject("训练日期格式不正确。");
  return value;
};
const forbiddenFields = new Set([
  "payload",
  "snapshot",
  "blob",
  "json",
  "entity",
  "workspace",
  "metadata",
]);
function validateFootballNames(value, depth = 0) {
  if (depth > 80) reject("战术板的训练内容层级过多。");
  if (value && typeof value === "object") {
    for (const [name, detail] of Object.entries(value)) {
      if (forbiddenFields.has(name.toLowerCase()))
        reject("训练内容须使用足球业务名称。");
      validateFootballNames(detail, depth + 1);
    }
  }
}
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const playerPositions = new Set([
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
]);
const legacyPlayerPositions = {
  GK: "门将",
  DF: "后卫",
  MF: "中场",
  FW: "前锋",
  Goalkeeper: "门将",
  Defender: "后卫",
  Midfielder: "中场",
  Forward: "前锋",
};
const berlinGardenPositions = [
  ["bg-1", ["中后卫", "后腰"]],
  ["bg-2", ["门将"]],
  ["bg-3", ["后腰"]],
  ["bg-4", ["中后卫"]],
  ["bg-5", ["中锋"]],
  ["bg-6", ["前腰", "右边前"]],
  ["bg-7", ["边前卫"]],
  ["bg-8", ["边后卫", "边前卫"]],
  ["bg-9", ["中锋"]],
  ["bg-10", ["中锋", "边前卫"]],
  ["bg-11", ["右边前"]],
  ["bg-12", ["左边前"]],
  ["bg-13", ["后卫"]],
  ["bg-14", ["后卫"]],
  ["bg-15", ["后卫"]],
  ["bg-16", ["后卫"]],
  ["bg-17", ["后腰"]],
  ["bg-18", ["边前卫", "前腰"]],
  ["bg-19", ["后腰"]],
  ["bg-20", ["前腰"]],
];
const berlinGardenNames = [
  "刘作涛",
  "刘建宏",
  "史丙林",
  "朱子言",
  "王伟",
  "妥昰",
  "韩达",
  "余哲",
  "侯瑞",
  "刘京",
  "刘潜",
  "吕晓露",
  "高宁",
  "张铁磊",
  "栗可",
  "陈成",
  "周军",
  "赵家骥",
  "孙皓",
  "刘刚",
];
const starterSlotRoles = ["GK", "DF", "DF", "MF", "MF", "MF", "FW", "FW"];
const formationSlotRoles = {
  "2-3-2": starterSlotRoles,
  "3-3-1": ["GK", "DF", "DF", "DF", "MF", "MF", "MF", "FW"],
  "2-1-3-1": ["GK", "DF", "DF", "MF", "MF", "MF", "MF", "FW"],
  "3-2-2": ["GK", "DF", "DF", "DF", "MF", "MF", "FW", "FW"],
  "1-3-3-1": ["GK", "DF", "MF", "MF", "MF", "MF", "MF", "FW"],
  "corner-atk": ["GK", "MF", "DF", "MF", "FW", "FW", "MF", "MF"],
  "corner-def": ["GK", "DF", "DF", "DF", "DF", "MF", "MF", "FW"],
  freekick: ["GK", "DF", "DF", "DF", "MF", "FW", "FW", "FW"],
  kickoff: ["GK", "DF", "DF", "MF", "FW", "MF", "MF", "FW"],
};
function primaryPlayerRole(positions) {
  const position = positions[0] ?? "待定";
  if (position === "门将") return "GK";
  if (["后卫", "中后卫", "边后卫"].includes(position)) return "DF";
  if (["后腰", "中场", "前腰", "边前卫", "左边前", "右边前"].includes(position))
    return "MF";
  if (["中锋", "前锋"].includes(position)) return "FW";
  return "待定";
}
const roleColors = {
  GK: "#F59E0B",
  DF: "#2495FF",
  MF: "#16A34A",
  FW: "#DC2626",
  待定: "#6D28D9",
};
function formationRoleScore(positions, role) {
  const scores = {
    GK: { 门将: 100 },
    DF: { 后卫: 100, 中后卫: 100, 边后卫: 95, 后腰: 40 },
    MF: {
      后腰: 100,
      中场: 100,
      边前卫: 100,
      边后卫: 90,
      前腰: 85,
      左边前: 80,
      右边前: 80,
    },
    FW: {
      中锋: 100,
      前锋: 100,
      前腰: 90,
      左边前: 90,
      右边前: 90,
      边前卫: 70,
    },
  };
  return Math.max(0, ...positions.map((position) => scores[role]?.[position] ?? 0));
}
function positionMatchedStarterOrder(roles) {
  const remaining = berlinGardenPositions
    .slice(0, 8)
    .map(([playerId, positions]) => ({ playerId, positions }));
  return roles.map((role) => {
    let bestIndex = 0;
    let bestScore = formationRoleScore(remaining[0].positions, role);
    for (let index = 1; index < remaining.length; index++) {
      const score = formationRoleScore(remaining[index].positions, role);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    return remaining.splice(bestIndex, 1)[0].playerId;
  });
}
function migrateBerlinGardenBoard(board, roles = starterSlotRoles) {
  const roster = new Map(
    berlinGardenPositions.map(([playerId, positions], index) => [
      playerId,
      { name: berlinGardenNames[index], number: index + 1, positions },
    ]),
  );
  for (const piece of board.pieces ?? []) {
    const player = roster.get(piece.playerId);
    if (!player) continue;
    const role = primaryPlayerRole(player.positions);
    piece.label = player.name;
    piece.shirtNumber = player.number;
    piece.position = role;
    piece.color = roleColors[role];
  }
  const starterIds = new Set(berlinGardenPositions.slice(0, 8).map(([playerId]) => playerId));
  const pieces = (board.pieces ?? []).filter(
    (piece) => piece.team !== "away" && starterIds.has(piece.playerId),
  );
  if (pieces.length === roles.length) {
    const slots = pieces
      .map(({ x, y }) => ({ x, y }))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    positionMatchedStarterOrder(roles).forEach((playerId, index) => {
      const piece = pieces.find((candidate) => candidate.playerId === playerId);
      const slot = slots[index];
      const role = roles[index];
      piece.x = slot.x;
      piece.y = slot.y;
      piece.position = role;
      piece.color = roleColors[role];
    });
  }
  return board;
}
function normalizePlayerPositions(player) {
  const supplied = player.positions ?? player.position;
  let values = Array.isArray(supplied)
    ? supplied
    : typeof supplied === "string"
      ? supplied.split(/[、,，/]/)
      : [];
  if (typeof supplied === "string" && supplied.trim().startsWith("[")) {
    try {
      values = JSON.parse(supplied);
    } catch {
      reject("球员位置数据格式不正确。");
    }
  }
  const positions = [
    ...new Set(values.map((value) => legacyPlayerPositions[value] ?? value)),
  ];
  if (
    !positions.length ||
    positions.length > playerPositions.size ||
    positions.some(
      (position) =>
        typeof position !== "string" || !playerPositions.has(position),
    )
  )
    reject("球员位置须从位置枚举中选择，且至少选择一个。");
  return positions;
}
const validPieceId = (value) =>
  (typeof value === "string" && value.length > 0 && value.length <= 200) ||
  Number.isSafeInteger(value);
function optionalText(practice, names) {
  for (const name of names)
    if (practice[name] !== undefined) string(practice[name], "训练文字");
}
function optionalNumbers(practice, names) {
  for (const name of names)
    if (practice[name] !== undefined && !finite(practice[name]))
      reject("训练位置和尺寸须为有效数字。");
}
function validatePosition(position) {
  if (!isObject(position) || !finite(position.x) || !finite(position.y))
    reject("场上位置须包含有效横纵坐标。");
}
function validatePiece(piece) {
  validatePosition(piece);
  if (!validPieceId(piece.pieceId)) reject("场上球员或足球的编号不正确。");
  optionalText(piece, ["kind", "color", "label", "position", "team"]);
  optionalNumbers(piece, ["radius", "shirtNumber"]);
  if (
    piece.playerId !== undefined &&
    piece.playerId !== null &&
    typeof piece.playerId !== "string"
  )
    reject("球员名单编号须为文字。");
}
function validateDemonstration(demonstration) {
  if (
    !isObject(demonstration) ||
    !validPieceId(demonstration.demonstrationId) ||
    !Array.isArray(demonstration.participants) ||
    !Array.isArray(demonstration.stages) ||
    !Array.isArray(demonstration.runs)
  )
    reject("战术演示须包含参与球员、阶段和跑动路线。");
  string(demonstration.title, "演示名称", 300);
  demonstration.participants.forEach(validatePiece);
  for (const stage of demonstration.stages) {
    if (
      !isObject(stage) ||
      !Number.isSafeInteger(stage.stageNumber) ||
      stage.stageNumber < 0 ||
      !Array.isArray(stage.positions)
    )
      reject("演示阶段须包含阶段编号和球员位置。");
    optionalText(stage, ["title", "note"]);
    optionalNumbers(stage, ["durationSeconds"]);
    if (stage.durationSeconds !== undefined && stage.durationSeconds < 0)
      reject("演示阶段时长不能为负数。");
    for (const position of stage.positions) {
      validatePosition(position);
      if (!validPieceId(position.pieceId))
        reject("演示位置须对应场上球员或足球。");
    }
  }
  for (const run of demonstration.runs) {
    if (
      !isObject(run) ||
      !validPieceId(run.pieceId) ||
      !Number.isSafeInteger(run.fromStage) ||
      run.fromStage < 0
    )
      reject("跑动路线须对应球员和起始阶段。");
    validatePosition(run.bend);
  }
}
function validateBoard(board) {
  if (
    !isObject(board) ||
    !Array.isArray(board.pieces) ||
    !Array.isArray(board.markings)
  )
    reject("战术板须包含场上球员和标记。");
  if (
    board.pieces.length > 5000 ||
    board.markings.length > 5000 ||
    !board.pieces.every(isObject) ||
    !board.markings.every(isObject)
  )
    reject("战术板的球员或标记内容不正确。");
  if (
    board.playerCount !== undefined &&
    ![5, 6, 7, 8, 9, 11].includes(board.playerCount)
  )
    reject("比赛人数须为 5、6、7、8、9 或 11 人。");
  validateFootballNames(board);
  for (const name of ["formationId", "awayFormationId"]) {
    if (board[name] !== undefined && board[name] !== null)
      string(board[name], "阵型名称", 300);
  }
  if (
    board.formationCustomized !== undefined &&
    typeof board.formationCustomized !== "boolean"
  )
    reject("阵型微调状态须为布尔值。");
  board.pieces.forEach(validatePiece);
  for (const marking of board.markings) {
    if (!validPieceId(marking.markingId)) reject("战术标记编号不正确。");
    optionalText(marking, [
      "kind",
      "color",
      "strokeColor",
      "backgroundColor",
      "label",
    ]);
    optionalNumbers(marking, [
      "x",
      "y",
      "startX",
      "startY",
      "endX",
      "endY",
      "width",
    ]);
    if (marking.dashed !== undefined && typeof marking.dashed !== "boolean")
      reject("战术标记的虚线选项不正确。");
    if (
      marking.path !== undefined &&
      (!Array.isArray(marking.path) ||
        !marking.path.every(
          (point) =>
            Array.isArray(point) && point.length === 2 && point.every(finite),
        ))
    )
      reject("战术路径须包含有效坐标。");
  }
  for (const name of ["trainingPlan", "demonstration"]) {
    if (
      board[name] !== undefined &&
      board[name] !== null &&
      !isObject(board[name])
    )
      reject("训练计划和战术演示格式不正确。");
  }
  if (board.trainingPlan != null) {
    optionalText(board.trainingPlan, ["objective", "instructions"]);
    optionalNumbers(board.trainingPlan, ["durationMinutes"]);
  }
  if (board.demonstration != null) validateDemonstration(board.demonstration);
  return board;
}
function validateTactic(tactic) {
  if (!isObject(tactic)) reject("请提供需要保存的战术。");
  const title = string(tactic.title, "战术名称", 300).trim();
  if (!title) reject("请填写战术名称。");
  if (
    !Array.isArray(tactic.tags) ||
    tactic.tags.length > 100 ||
    !tactic.tags.every((tag) => typeof tag === "string" && tag.length <= 100)
  )
    reject("战术标签须为简短名称。");
  if (typeof tactic.favorite !== "boolean") reject("请选择是否收藏战术。");
  if (tactic.formationName !== null && typeof tactic.formationName !== "string")
    reject("阵型名称须为文字或留空。");
  if (tactic.thumbnail !== null && typeof tactic.thumbnail !== "string")
    reject("战术缩略图须为图片地址或留空。");
  if (tactic.match !== undefined && !isObject(tactic.match))
    reject("比赛信息格式不正确。");
  if (tactic.match !== undefined)
    optionalText(tactic.match, ["opponent", "date", "score"]);
  if (tactic.presetName !== undefined)
    string(tactic.presetName, "预置战术名称", 300);
  if (
    tactic.presetEdition !== undefined &&
    (!Number.isSafeInteger(tactic.presetEdition) || tactic.presetEdition < 0)
  )
    reject("预置战术版本须为非负整数。");
  validateBoard(tactic.board);
  validateFootballNames(tactic);
  return { ...tactic, title };
}
function validatePlayer(player) {
  if (!isObject(player)) reject("请提供完整球员信息。");
  if (!string(player.playerId, "球员编号", 200)) reject("请填写球员编号。");
  if (!string(player.name, "球员姓名", 200).trim()) reject("请填写球员姓名。");
  if (
    !Number.isInteger(player.number) ||
    player.number < 0 ||
    player.number > 9999
  )
    reject("球衣号码须在 0 到 9999 之间。");
  for (const name of ["preferredFoot", "status", "note"])
    string(player[name], "球员资料");
  player.positions = normalizePlayerPositions(player);
  if (!["ok", "injured", "suspended"].includes(player.status))
    reject("球员状态须为健康、受伤或停赛。");
  if (player.avatar !== undefined && player.avatar !== null)
    string(player.avatar, "球员头像", 20 * 1024 * 1024);
  if (
    player.fieldPieceId !== null &&
    typeof player.fieldPieceId !== "string" &&
    !Number.isSafeInteger(player.fieldPieceId)
  )
    reject("请关联有效场上球员，或将球员放在替补席。");
  validateFootballNames(player);
}

export function openFootballStore(databasePath) {
  if (databasePath !== ":memory:")
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS tactics (
      tactic_id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, tags TEXT NOT NULL, favorite INTEGER NOT NULL CHECK (favorite IN (0, 1)),
      formation_name TEXT, match_details TEXT, board TEXT NOT NULL, thumbnail TEXT,
      created_at INTEGER NOT NULL, saved_at INTEGER NOT NULL, preset_name TEXT, preset_edition INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS tactics_by_preset ON tactics(preset_name, preset_edition);
    CREATE TABLE IF NOT EXISTS tactic_versions (
      version_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tactic_id INTEGER NOT NULL REFERENCES tactics(tactic_id) ON DELETE CASCADE,
      note TEXT NOT NULL, board TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS tactic_versions_by_tactic ON tactic_versions(tactic_id, created_at DESC, version_id DESC);
    CREATE TABLE IF NOT EXISTS coaching_desks (
      desk_id INTEGER PRIMARY KEY CHECK (desk_id = 1), board TEXT,
      selected_tactic_id INTEGER REFERENCES tactics(tactic_id) ON DELETE SET NULL,
      edition INTEGER NOT NULL, saved_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS team_players (
      player_id TEXT PRIMARY KEY, desk_id INTEGER NOT NULL REFERENCES coaching_desks(desk_id) ON DELETE CASCADE,
      team_order INTEGER NOT NULL, name TEXT NOT NULL, shirt_number INTEGER NOT NULL,
      position TEXT NOT NULL, preferred_foot TEXT NOT NULL, availability TEXT NOT NULL,
      note TEXT NOT NULL, portrait TEXT, field_piece_id TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS tactic_collections (
      collection_name TEXT PRIMARY KEY, tactic_ids TEXT NOT NULL, imported_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS app_migrations (
      migration_name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL
    ) STRICT;
  `);
  const rosterMigration = "berlin-garden-roster-csv-positions-v2";
  const migrationApplied = database
    .prepare("SELECT 1 FROM app_migrations WHERE migration_name = ?")
    .get(rosterMigration);
  const knownPlayers = database
    .prepare(
      "SELECT count(*) AS total FROM team_players WHERE player_id LIKE 'bg-%'",
    )
    .get().total;
  if (!migrationApplied && knownPlayers > 0) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const updatePlayer = database.prepare(
        "UPDATE team_players SET name = ?, shirt_number = ?, position = ?, portrait = ? WHERE player_id = ?",
      );
      for (const [
        index,
        [playerId, positions],
      ] of berlinGardenPositions.entries()) {
        updatePlayer.run(
          berlinGardenNames[index],
          index + 1,
          JSON.stringify(positions),
          JSON.stringify(`/avatars/${playerId}.jpg`),
          playerId,
        );
      }
      const desk = database
        .prepare("SELECT board FROM coaching_desks WHERE desk_id = 1")
        .get();
      if (desk?.board) {
        const board = JSON.parse(desk.board);
        const roster = new Map(
          berlinGardenPositions.map(([playerId, positions], index) => [
            playerId,
            { name: berlinGardenNames[index], number: index + 1, positions },
          ]),
        );
        for (const piece of board.pieces ?? []) {
          const player = roster.get(piece.playerId);
          if (!player) continue;
          const role = primaryPlayerRole(player.positions);
          piece.label = player.name;
          piece.shirtNumber = player.number;
          piece.position = role;
          piece.color = roleColors[role];
        }
        database
          .prepare("UPDATE coaching_desks SET board = ? WHERE desk_id = 1")
          .run(JSON.stringify(board));
      }
      database
        .prepare(
          "INSERT INTO app_migrations (migration_name, applied_at) VALUES (?, ?)",
        )
        .run(rosterMigration, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const lineupMigration = "berlin-garden-position-matched-lineup-v3";
  const lineupMigrationApplied = database
    .prepare("SELECT 1 FROM app_migrations WHERE migration_name = ?")
    .get(lineupMigration);
  if (!lineupMigrationApplied && knownPlayers > 0) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const desk = database
        .prepare(`SELECT coaching_desks.board, tactics.formation_name
          FROM coaching_desks LEFT JOIN tactics ON tactics.tactic_id = coaching_desks.selected_tactic_id
          WHERE coaching_desks.desk_id = 1`)
        .get();
      if (desk?.board) {
        const roles = formationSlotRoles[desk.formation_name] ?? starterSlotRoles;
        const board = migrateBerlinGardenBoard(JSON.parse(desk.board), roles);
        database
          .prepare("UPDATE coaching_desks SET board = ? WHERE desk_id = 1")
          .run(JSON.stringify(board));
      }
      database
        .prepare(
          "INSERT INTO app_migrations (migration_name, applied_at) VALUES (?, ?)",
        )
        .run(lineupMigration, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const presetLineupMigration = "berlin-garden-formation-matched-lineups-v6";
  const presetLineupMigrationApplied = database
    .prepare("SELECT 1 FROM app_migrations WHERE migration_name = ?")
    .get(presetLineupMigration);
  const knownPresets = database
    .prepare("SELECT count(*) AS total FROM tactics WHERE preset_name IS NOT NULL")
    .get().total;
  if (!presetLineupMigrationApplied && knownPresets > 0) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const desk = database
        .prepare(`SELECT coaching_desks.board, tactics.formation_name
          FROM coaching_desks LEFT JOIN tactics ON tactics.tactic_id = coaching_desks.selected_tactic_id
          WHERE coaching_desks.desk_id = 1`)
        .get();
      if (desk?.board) {
        const roles = formationSlotRoles[desk.formation_name] ?? starterSlotRoles;
        const board = migrateBerlinGardenBoard(JSON.parse(desk.board), roles);
        database
          .prepare("UPDATE coaching_desks SET board = ? WHERE desk_id = 1")
          .run(JSON.stringify(board));
      }
      const updatePreset = database.prepare(
        "UPDATE tactics SET board = ? WHERE tactic_id = ?",
      );
      for (const preset of database
        .prepare(
          "SELECT tactic_id, formation_name, board FROM tactics WHERE preset_name IS NOT NULL",
        )
        .all()) {
        const roles = formationSlotRoles[preset.formation_name] ?? starterSlotRoles;
        const board = migrateBerlinGardenBoard(JSON.parse(preset.board), roles);
        updatePreset.run(JSON.stringify(board), preset.tactic_id);
      }
      database
        .prepare(
          "INSERT INTO app_migrations (migration_name, applied_at) VALUES (?, ?)",
        )
        .run(presetLineupMigration, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
  const prepare = (sql) => database.prepare(sql);
  const transaction = (work) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      database.exec("COMMIT");
      return result;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  const readTactic = (row) => ({
    tacticId: row.tactic_id,
    title: row.title,
    tags: JSON.parse(row.tags),
    favorite: Boolean(row.favorite),
    formationName: row.formation_name,
    ...(row.match_details === null
      ? {}
      : { match: JSON.parse(row.match_details) }),
    board: JSON.parse(row.board),
    thumbnail: row.thumbnail,
    createdAt: row.created_at,
    savedAt: row.saved_at,
    ...(row.preset_name === null ? {} : { presetName: row.preset_name }),
    ...(row.preset_edition === null
      ? {}
      : { presetEdition: row.preset_edition }),
  });
  const readVersion = (row) => ({
    versionId: row.version_id,
    tacticId: row.tactic_id,
    note: row.note,
    board: JSON.parse(row.board),
    createdAt: row.created_at,
  });
  const getTactic = (tacticId) => {
    const row = prepare("SELECT * FROM tactics WHERE tactic_id = ?").get(
      tacticId,
    );
    if (!row) throw new FootballError(404, "未找到这份战术。");
    return readTactic(row);
  };
  const listTactics = () =>
    prepare("SELECT * FROM tactics ORDER BY saved_at DESC, tactic_id DESC")
      .all()
      .map(readTactic);
  const listVersions = (tacticId) => {
    getTactic(tacticId);
    return prepare(
      "SELECT * FROM tactic_versions WHERE tactic_id = ? ORDER BY created_at DESC, version_id DESC",
    )
      .all(tacticId)
      .map(readVersion);
  };
  function addVersion(tacticId, note, board, createdAt = Date.now()) {
    const result = prepare(
      "INSERT INTO tactic_versions (tactic_id, note, board, created_at) VALUES (?, ?, ?, ?)",
    ).run(tacticId, note, JSON.stringify(board), createdAt);
    const version = {
      versionId: Number(result.lastInsertRowid),
      tacticId,
      note,
      board,
      createdAt,
    };
    prepare(`DELETE FROM tactic_versions WHERE tactic_id = ? AND version_id NOT IN (
      SELECT version_id FROM tactic_versions WHERE tactic_id = ? ORDER BY created_at DESC, version_id DESC LIMIT 50
    )`).run(tacticId, tacticId);
    return version;
  }
  function insertTactic(tactic, imported = false) {
    const now = Date.now();
    const result =
      prepare(`INSERT INTO tactics (title, tags, favorite, formation_name, match_details, board, thumbnail, created_at, saved_at, preset_name, preset_edition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        tactic.title,
        JSON.stringify(tactic.tags),
        Number(tactic.favorite),
        tactic.formationName,
        tactic.match === undefined ? null : JSON.stringify(tactic.match),
        JSON.stringify(tactic.board),
        tactic.thumbnail,
        imported ? time(tactic.createdAt, now) : now,
        imported ? time(tactic.savedAt, now) : now,
        tactic.presetName ?? null,
        tactic.presetEdition ?? null,
      );
    return Number(result.lastInsertRowid);
  }
  const getDesk = () => {
    const row = prepare("SELECT * FROM coaching_desks WHERE desk_id = 1").get();
    if (!row) return { desk: null, edition: 0, savedAt: null };
    const players = prepare("SELECT * FROM team_players ORDER BY team_order")
      .all()
      .map((player) => ({
        playerId: player.player_id,
        name: player.name,
        number: player.shirt_number,
        positions: normalizePlayerPositions({ position: player.position }),
        preferredFoot: player.preferred_foot,
        status: player.availability,
        note: player.note,
        ...(player.portrait === null
          ? {}
          : { avatar: JSON.parse(player.portrait) }),
        fieldPieceId:
          player.field_piece_id === null
            ? null
            : JSON.parse(player.field_piece_id),
      }));
    return {
      desk:
        row.board === null
          ? null
          : {
              board: JSON.parse(row.board),
              players,
              selectedTacticId: row.selected_tactic_id,
            },
      edition: row.edition,
      savedAt: row.saved_at,
    };
  };
  return {
    close: () => database.close(),
    listTactics,
    getTactic,
    listVersions,
    getDesk,
    saveTactic(tacticId, request) {
      if (!isObject(request)) reject("请提供战术和保存备注。");
      const tactic = validateTactic(request.tactic);
      const note = string(request.note ?? "", "保存备注");
      return transaction(() => {
        if (tacticId === null) {
          if (
            tactic.presetName !== undefined &&
            tactic.presetEdition !== undefined
          ) {
            const previous = prepare(
              "SELECT * FROM tactics WHERE preset_name = ? AND preset_edition = ? ORDER BY tactic_id LIMIT 1",
            ).get(tactic.presetName, tactic.presetEdition);
            if (previous) return readTactic(previous);
          }
          tacticId = insertTactic(tactic);
        } else {
          const previous = getTactic(tacticId);
          prepare(
            `UPDATE tactics SET title = ?, tags = ?, favorite = ?, formation_name = ?, match_details = ?, board = ?, thumbnail = ?, saved_at = ?, preset_name = ?, preset_edition = ? WHERE tactic_id = ?`,
          ).run(
            tactic.title,
            JSON.stringify(tactic.tags),
            Number(tactic.favorite),
            tactic.formationName,
            tactic.match === undefined ? null : JSON.stringify(tactic.match),
            JSON.stringify(tactic.board),
            tactic.thumbnail,
            Date.now(),
            tactic.presetName ?? previous.presetName ?? null,
            tactic.presetEdition ?? previous.presetEdition ?? null,
            tacticId,
          );
        }
        addVersion(tacticId, note, tactic.board);
        return getTactic(tacticId);
      });
    },
    updateTactic(tacticId, changes) {
      if (
        !isObject(changes) ||
        !Object.keys(changes).length ||
        Object.keys(changes).some(
          (name) => !["favorite", "thumbnail"].includes(name),
        )
      )
        reject("此处仅可修改收藏状态和缩略图。");
      if (
        changes.favorite !== undefined &&
        typeof changes.favorite !== "boolean"
      )
        reject("收藏状态须为是或否。");
      if (
        changes.thumbnail !== undefined &&
        changes.thumbnail !== null &&
        typeof changes.thumbnail !== "string"
      )
        reject("缩略图须为图片地址或留空。");
      return transaction(() => {
        const previous = getTactic(tacticId);
        prepare(
          "UPDATE tactics SET favorite = ?, thumbnail = ? WHERE tactic_id = ?",
        ).run(
          Number(changes.favorite ?? previous.favorite),
          changes.thumbnail === undefined
            ? previous.thumbnail
            : changes.thumbnail,
          tacticId,
        );
        return getTactic(tacticId);
      });
    },
    deleteTactic(tacticId) {
      return transaction(() => {
        getTactic(tacticId);
        prepare("DELETE FROM tactics WHERE tactic_id = ?").run(tacticId);
      });
    },
    saveVersion(tacticId, request) {
      if (!isObject(request)) reject("请提供训练版本。");
      const note = string(request.note ?? "", "版本备注");
      validateBoard(request.board);
      return transaction(() => {
        getTactic(tacticId);
        return addVersion(tacticId, note, request.board);
      });
    },
    saveDesk(request) {
      if (
        !isObject(request) ||
        !Number.isSafeInteger(request.edition) ||
        request.edition < 0
      )
        reject("教练工作台须提供上次保存的版本号。");
      const { desk, edition } = request;
      if (desk !== null) {
        if (
          !isObject(desk) ||
          !Array.isArray(desk.players) ||
          desk.players.length > 1000
        )
          reject("教练工作台须包含战术板和球队名单。");
        validateBoard(desk.board);
        desk.players.forEach(validatePlayer);
        if (
          new Set(desk.players.map((player) => player.playerId)).size !==
          desk.players.length
        )
          reject("球队名单中的球员不能重复。");
        if (
          desk.selectedTacticId !== null &&
          (!Number.isSafeInteger(desk.selectedTacticId) ||
            desk.selectedTacticId < 1)
        )
          reject("请选择已保存战术，或取消关联。");
      }
      return transaction(() => {
        if (getDesk().edition !== edition)
          throw new FootballError(
            409,
            "教练工作台已在其他页面保存，请重新加载后再保存。",
          );
        if (desk?.selectedTacticId != null) getTactic(desk.selectedTacticId);
        prepare(`INSERT INTO coaching_desks (desk_id, board, selected_tactic_id, edition, saved_at) VALUES (1, ?, ?, ?, ?)
          ON CONFLICT(desk_id) DO UPDATE SET board = excluded.board, selected_tactic_id = excluded.selected_tactic_id, edition = excluded.edition, saved_at = excluded.saved_at`).run(
          desk === null ? null : JSON.stringify(desk.board),
          desk?.selectedTacticId ?? null,
          edition + 1,
          Date.now(),
        );
        prepare("DELETE FROM team_players").run();
        const addPlayer = prepare(
          "INSERT INTO team_players (player_id, desk_id, team_order, name, shirt_number, position, preferred_foot, availability, note, portrait, field_piece_id) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        );
        desk?.players.forEach((player, index) =>
          addPlayer.run(
            player.playerId,
            index,
            player.name,
            player.number,
            JSON.stringify(player.positions),
            player.preferredFoot,
            player.status,
            player.note,
            player.avatar === undefined ? null : JSON.stringify(player.avatar),
            player.fieldPieceId === null
              ? null
              : JSON.stringify(player.fieldPieceId),
          ),
        );
        return getDesk();
      });
    },
    exportCollection() {
      return transaction(() => {
        const tactics = listTactics();
        const versions = tactics.flatMap((tactic, tacticNumber) =>
          listVersions(tactic.tacticId).map(({ note, board, createdAt }) => ({
            tacticNumber,
            note,
            board,
            createdAt,
          })),
        );
        return { tactics, versions, exportedAt: Date.now() };
      });
    },
    importCollection(request) {
      if (
        !isObject(request) ||
        !Array.isArray(request.tactics) ||
        !Array.isArray(request.versions) ||
        request.tactics.length > 10000 ||
        request.versions.length > 500000
      )
        reject("战术集须包含战术和训练版本。");
      const collectionName =
        request.collectionName === undefined
          ? null
          : string(request.collectionName, "战术集名称", 300);
      if (collectionName === "") reject("战术集名称不能为空。");
      return transaction(() => {
        if (collectionName !== null) {
          const previous = prepare(
            "SELECT tactic_ids FROM tactic_collections WHERE collection_name = ?",
          ).get(collectionName);
          if (previous) {
            const tacticIds = JSON.parse(previous.tactic_ids);
            return { repeated: true, importedCount: 0, tacticIds };
          }
        }
        const tacticIds = request.tactics.map((tactic) =>
          insertTactic(validateTactic(tactic), true),
        );
        for (const version of request.versions) {
          if (
            !isObject(version) ||
            !Number.isInteger(version.tacticNumber) ||
            version.tacticNumber < 0 ||
            version.tacticNumber >= tacticIds.length
          )
            reject("训练版本须对应本次导入的战术。");
          addVersion(
            tacticIds[version.tacticNumber],
            string(version.note ?? "", "版本备注"),
            validateBoard(version.board),
            time(version.createdAt, Date.now()),
          );
        }
        if (collectionName !== null)
          prepare(
            "INSERT INTO tactic_collections (collection_name, tactic_ids, imported_at) VALUES (?, ?, ?)",
          ).run(collectionName, JSON.stringify(tacticIds), Date.now());
        return { repeated: false, importedCount: tacticIds.length, tacticIds };
      });
    },
  };
}
