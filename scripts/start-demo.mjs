import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDemo } from "./create-demo.mjs";
import { createFootballServer } from "../server/index.mjs";

const defaultStaticDirectory = fileURLToPath(
  new URL("../app/dist", import.meta.url),
);
const marker = "Fictional adult football rehearsal only\n";

export function quoteDemoDirectory(directory, platform = process.platform) {
  return platform === "win32"
    ? "'" + directory.replaceAll("'", "''") + "'"
    : "'" + directory.replaceAll("'", "'\"'\"'") + "'";
}

export function parseDemoArguments(args) {
  if (!args.length) return {};
  if (args.length === 2 && args[0] === "--resume" && args[1])
    return { resumeDirectory: args[1] };
  throw new Error(
    "只支持无参数新建演练，或 --resume <本次演练目录> 继续。不能指定已有数据库。",
  );
}

export function readDemoManifest(directory) {
  const resolved = realpathSync(resolve(directory));
  if (!lstatSync(resolved).isDirectory()) throw new Error("演练目录不存在。");
  for (const name of [
    ".football-demo-owned",
    "demo-manifest.json",
    "demo.sqlite",
  ]) {
    const entry = lstatSync(join(resolved, name));
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new Error(
        "只能继续脚本创建的演练目录，标记、清单和数据库必须是普通文件。",
      );
  }
  if (readFileSync(join(resolved, ".football-demo-owned"), "utf8") !== marker)
    throw new Error("该目录没有有效的虚构演练标记，拒绝打开数据库。");
  const manifest = JSON.parse(
    readFileSync(join(resolved, "demo-manifest.json"), "utf8"),
  );
  if (
    manifest.fictional !== true ||
    manifest.adultsOnly !== true ||
    typeof manifest.directory !== "string" ||
    typeof manifest.databasePath !== "string" ||
    realpathSync(manifest.directory) !== resolved ||
    realpathSync(manifest.databasePath) !== join(resolved, "demo.sqlite")
  )
    throw new Error(
      "演练清单和目录不匹配，拒绝打开数据库。请保留原目录后重试。",
    );
  return {
    ...manifest,
    directory: resolved,
    databasePath: join(resolved, "demo.sqlite"),
  };
}

// No production path, origin, proxy, credentials, host or port are inherited.
// staticDirectory is injectable only to test the real launcher with a tiny local fixture.
export async function startDemo({
  resumeDirectory,
  staticDirectory = defaultStaticDirectory,
} = {}) {
  if (!existsSync(join(staticDirectory, "index.html")))
    throw new Error(
      "网页尚未构建。请先在 app 目录运行 npm ci 和 npm run build，再运行 npm run demo。",
    );
  const manifest = resumeDirectory
    ? readDemoManifest(resumeDirectory)
    : createDemo();
  const server = createFootballServer({
    databasePath: manifest.databasePath,
    staticDirectory,
    bootstrapAdmin: null,
    publicOrigin: null,
    trustedProxyAddresses: [],
    secureCookies: false,
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  } catch (error) {
    server.close();
    throw error;
  }
  return { server, manifest, url: `http://127.0.0.1:${server.address().port}` };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const options = parseDemoArguments(process.argv.slice(2));
    const { server, manifest, url } = await startDemo(options);
    console.log(`\n虚构演练已启动（仅本机访问）：${url}`);
    console.log(`独立数据库：${manifest.databasePath}`);
    console.log(`账号清单：${join(manifest.directory, "demo-manifest.json")}`);
    if (!options.resumeDirectory) {
      console.log("仅本次新演练有效的随机账号密码（请勿分享或用于生产）：");
      for (const account of manifest.credentials)
        console.log(
          `  ${account.role === "admin" ? "管理员" : account.name}  ${account.username}  ${account.password}`,
        );
    }
    console.log("按 Ctrl+C 停止服务，不删除演练数据。继续时在 app 目录运行：");
    console.log(
      `  npm run demo -- --resume ${quoteDemoDirectory(manifest.directory)}`,
    );
    console.log(
      "重新运行 npm run demo 会创建另一份新库，不覆盖本次进度。详见 docs/demo-rehearsal.md。\n",
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => {
        server.close();
        server.closeIdleConnections();
      });
  } catch (error) {
    console.error(`演练启动失败：${error.message}`);
    process.exitCode = 1;
  }
}
