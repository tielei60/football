import { writeFileSync, mkdtempSync, chmodSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, scryptSync } from "node:crypto";
import { DatabaseSync, backup } from "node:sqlite";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { openFootballStore } from "../server/football-store.mjs";
import { createClubStore } from "../server/club-store.mjs";

// 仅供本机一次性初始化；不导入HTTP路由，不复用常规密码校验的短密码例外。
export function initializeLocalSystemAdmin(
  database,
  { username, initialPassword, teamId = 1 } = {},
) {
  if (typeof username !== "string" || !username.trim() || username.length > 100)
    throw Error("请输入有效账户名。");
  if (
    typeof initialPassword !== "string" ||
    initialPassword.length < 6 ||
    initialPassword.length > 200
  )
    throw Error("本机临时密码须为6至200字符，首次登录必须修改。");
  if (!Number.isSafeInteger(teamId) || teamId < 1)
    throw Error("球队编号不正确。");
  const salt = randomBytes(16).toString("hex");
  const hash = `${salt}:${scryptSync(initialPassword, salt, 64).toString("hex")}`;
  database.exec("BEGIN IMMEDIATE");
  try {
    if (!database.prepare("SELECT id FROM club_teams WHERE id=?").get(teamId))
      throw Error("球队不存在。");
    if (
      database
        .prepare(
          "SELECT id FROM club_users WHERE team_id=? AND is_system_admin=1",
        )
        .get(teamId)
    )
      throw Error("已有系统管理员，禁止重复初始化或重置。");
    if (
      database
        .prepare("SELECT id FROM club_users WHERE username=? COLLATE NOCASE")
        .get(username.trim())
    )
      throw Error("账户名已存在，禁止覆盖；请先人工核对。");
    const result = database
      .prepare(
        "INSERT INTO club_users(team_id,username,password_hash,role,is_system_admin,must_change_password,account_enabled) VALUES(?,?,?,'admin',1,1,1)",
      )
      .run(teamId, username.trim(), hash);
    database.exec("COMMIT");
    return { id: Number(result.lastInsertRowid), mustChangePassword: true };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
export function parseLocalSetupArguments(args) {
  if (!Array.isArray(args) || args.length)
    throw Error("本机初始化不接受命令行参数或密码。");
}
const defaultPath = fileURLToPath(
  new URL("../app/data/football.sqlite", import.meta.url),
);
export async function main(args = process.argv.slice(2)) {
  parseLocalSetupArguments(args);
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw Error("请在本机交互终端输入，不接受管道、参数或环境变量密码。");
  // 不跟随数据目录或数据库符号链接，不隐式初始化未知路径。
  for (const p of [
    dirname(dirname(defaultPath)),
    dirname(defaultPath),
    defaultPath,
  ])
    if (lstatSync(p).isSymbolicLink()) throw Error("数据路径不可为符号链接。");
  if (!lstatSync(defaultPath).isFile())
    throw Error("本地数据库不存在，请先准备并核对干净资料库。");
  console.log(
    "仅初始化本项目 app/data/football.sqlite，请先停止使用该库的服务。不会删除已有账户。",
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let username;
  try {
    if (
      (await rl.question(
        "确认该库为已核对的本地资料库且服务已停止？输入 YES：",
      )) !== "YES"
    )
      throw Error("已取消。");
    username = await rl.question("系统管理员账户名：");
  } finally {
    rl.close();
  }
  // 密码只在内存，终端输出静音，不写清单或日志。
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  process.stdout.write("临时密码（输入不回显）：");
  const secretPrompt = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });
  let initialPassword;
  try {
    initialPassword = await secretPrompt.question("");
  } finally {
    secretPrompt.close();
    process.stdout.write("\n");
  }
  const directory = mkdtempSync(join(tmpdir(), "football-account-backup-"));
  chmodSync(directory, 0o700);
  const backupPath = join(directory, "before-system-setup.sqlite");
  writeFileSync(backupPath, "", { flag: "wx", mode: 0o600 });
  const source = new DatabaseSync(defaultPath, { readOnly: true });
  try {
    await backup(source, backupPath);
  } finally {
    source.close();
  }
  chmodSync(backupPath, 0o600);
  console.log(`本机恢复副本：${backupPath}（含私有资料，不上传）`);
  let store;
  try {
    store = openFootballStore(defaultPath);
    createClubStore(store.database, store, { bootstrapAdmin: null });
    if (store.database.prepare("PRAGMA foreign_key_check").all().length)
      throw Error("外键检查未通过，停止初始化。");
    initializeLocalSystemAdmin(store.database, { username, initialPassword });
    console.log("本机系统管理员已初始化；首次登录只能修改密码，随后重新登录。");
  } finally {
    initialPassword = undefined;
    store?.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "初始化未完成，请在本机核查输入、数据库与恢复副本；未输出凭据。",
    );
    process.exitCode = 1;
  });
}
