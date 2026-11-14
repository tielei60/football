import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../app/package.json", import.meta.url));
const ts = require("typescript");

// 只读取字面量，不执行来源模块，也不打开任何数据库。
export function readLiteral(source, name) {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) throw new Error("名单来源语法错误，停止预览。");
  let found;
  let seen = false;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        if (seen) throw new Error("名单来源存在重复声明。");
        seen = true;
        found = declaration.initializer;
      }
    }
  }
  function literal(node) {
    if (node && ts.isAsExpression(node)) return literal(node.expression);
    if (node && ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
    if (node && ts.isStringLiteral(node)) return node.text;
    throw new Error("名单来源不再是字符串数组，请人工核查后适配。");
  }
  return literal(found);
}

export function buildRosterPreview(frontendSource, backendSource) {
  const seeds = readLiteral(frontendSource, "seeds");
  const names = readLiteral(backendSource, "berlinGardenNames");
  const positions = readLiteral(backendSource, "berlinGardenPositions");
  const allowed = new Set(readLiteral(frontendSource, "PLAYER_POSITIONS"));
  if (!seeds.length || seeds.length !== names.length || names.length !== positions.length)
    throw new Error("前后端名单数量不一致，停止预览。");
  const uniqueNames = new Set();
  const records = seeds.map((seed, index) => {
    if (!Array.isArray(seed) || seed.length !== 2) throw new Error("名单结构异常。");
    const [name, roles] = seed;
    const id = `bg-${index + 1}`;
    if (typeof name !== "string" || !name.trim() || name !== name.trim() || name.includes("\uFFFD") || uniqueNames.has(name))
      throw new Error("名单姓名存在空值、重复或编码异常，停止预览。");
    uniqueNames.add(name);
    if (!Array.isArray(roles) || !roles.length || new Set(roles).size !== roles.length || roles.some((role) => !allowed.has(role)))
      throw new Error("名单位置无效，停止预览。");
    if (names[index] !== name || JSON.stringify(positions[index]) !== JSON.stringify([id, roles]))
      throw new Error("前后端姓名、稳定ID或位置不一致，停止预览。");
    return {
      sourceId: id,
      name,
      positions: [...roles],
      number: null,
      avatar: null,
      foot: null,
      healthStatus: null,
      dateOfBirth: null,
      verification: "项目历史资料，尚未逐人确认现况",
    };
  });
  return {
    mode: "只读来源预览，不导入数据库",
    source: ["app/src/data/berlinGarden.ts", "server/football-store.mjs"],
    total: records.length,
    multiplePositions: records.filter((r) => r.positions.length > 1).length,
    excludedDerivedFields: ["按数组顺序生成的球衣号码", "默认健康状态", "不存在的历史头像路径"],
    matches: "无已核实来源，不生成比赛或统计",
    records,
  };
}

export function summarizePreview(preview) {
  const { records, ...summary } = preview;
  return { ...summary, personalDetails: "默认不输出姓名；需要本机逐项查看时使用 --details。" };
}

export function main(args = process.argv.slice(2)) {
  if (args.some((arg) => arg !== "--details") || args.length > 1)
    throw new Error("用法：node scripts/preview-berlin-roster.mjs [--details]；不接受数据库或输出路径。");
  const frontend = readFileSync(new URL("../app/src/data/berlinGarden.ts", import.meta.url), "utf8");
  const backend = readFileSync(new URL("../server/football-store.mjs", import.meta.url), "utf8");
  const preview = buildRosterPreview(frontend, backend);
  console.log(JSON.stringify(args.includes("--details") ? preview : summarizePreview(preview), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
