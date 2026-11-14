import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes, createHash } from "node:crypto";
import { buildRosterPreview } from "./preview-berlin-roster.mjs";
import { openFootballStore } from "../server/football-store.mjs";
import { createClubStore } from "../server/club-store.mjs";

// 不接受目标路径，不读取 FOOTBALL_DB_PATH，仅生成本机私有隔离资料库。
export function createBerlinValidation() {
  if (arguments.length) throw new Error("不接受参数或目标路径。");
  const sourceFiles = [
    "app/src/data/berlinGarden.ts",
    "server/football-store.mjs",
  ];
  const sources = sourceFiles.map((path) =>
    readFileSync(new URL("../" + path, import.meta.url), "utf8"),
  );
  const preview = buildRosterPreview(...sources);
  if (preview.total !== 20)
    throw new Error("来源不再是已核对的20人，请重新审查。");
  const directory = mkdtempSync(join(tmpdir(), "football-berlin-validation-"));
  chmodSync(directory, 0o700);
  const databasePath = join(directory, "validation.sqlite");
  let store;
  try {
    writeFileSync(databasePath, "", { flag: "wx", mode: 0o600 });
    store = openFootballStore(databasePath);
    const credentials = {
      username: "local-validation-admin",
      password: randomBytes(32).toString("base64url"),
    };
    createClubStore(store.database, store, { bootstrapAdmin: credentials });
    const db = store.database;
    for (const table of [
      "club_players",
      "team_players",
      "coaching_desks",
      "club_matches",
      "club_roster",
      "club_rsvps",
      "club_seasons",
      "club_season_roster",
      "tactics",
      "tactic_versions",
      "club_sessions",
    ]) {
      if (db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n)
        throw new Error("新库存在非预期初始资料，停止生成。");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`CREATE TABLE validation_roster_sources (
        player_id TEXT PRIMARY KEY REFERENCES club_players(id), source_id TEXT NOT NULL,
        source_files TEXT NOT NULL, source_hashes TEXT NOT NULL, unknown_fields TEXT NOT NULL,
        verification TEXT NOT NULL) STRICT;`);
      const insert =
        db.prepare(`INSERT INTO club_players(id,team_id,name,number,positions,preferred_foot,status,note,avatar)
        VALUES (?,1,?,NULL,?,'','inactive',?,NULL)`);
      const provenance = db.prepare(
        "INSERT INTO validation_roster_sources VALUES (?,?,?,?,?,?)",
      );
      const hashes = sources.map((s) =>
        createHash("sha256").update(s).digest("hex"),
      );
      for (const record of preview.records) {
        insert.run(
          record.sourceId,
          record.name,
          JSON.stringify(record.positions),
          "项目历史来源，现况未逐人核实；暂不启用仅为隔离验证状态，不代表实际离队。号码、头像、惯用脚、年龄与健康未知。",
        );
        provenance.run(
          record.sourceId,
          record.sourceId,
          JSON.stringify(sourceFiles),
          JSON.stringify(hashes),
          JSON.stringify([
            "number",
            "avatar",
            "preferredFoot",
            "healthStatus",
            "dateOfBirth",
            "currentMembership",
          ]),
          record.verification,
        );
      }
      db.prepare("UPDATE club_teams SET name=? WHERE id=1").run(
        "柏林花园来源资料（本机隔离验证，现况未核实）",
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    store.close();
    store = null;
    chmodSync(databasePath, 0o600);
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify(
        {
          purpose: "仅本机来源验证，不启动服务，不代表真实比赛或成员现况",
          databasePath,
          credentials,
          total: preview.total,
          source: sourceFiles,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    return { directory, total: preview.total, serviceStarted: false };
  } catch (error) {
    // 保留原始失败，即使关闭句柄失败也尝试清理本次独占创建的目录。
    try {
      store?.close();
    } catch {}
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      error.message += "（本次临时目录清理未完成，请在本机核对生成器目录。）";
    }
    throw error;
  }
}
export function main(args = process.argv.slice(2)) {
  if (args.length)
    throw new Error(
      "用法：node scripts/create-berlin-validation.mjs（不接受任何参数）。",
    );
  console.log(JSON.stringify(createBerlinValidation(), null, 2));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
