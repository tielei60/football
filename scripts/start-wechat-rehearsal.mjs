import { mkdtempSync, chmodSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { openFootballStore } from "../server/football-store.mjs";
import { createClubStore } from "../server/club-store.mjs";
import { createWechatProvider } from "../server/wechat-provider.mjs";
import { createFootballServer } from "../server/index.mjs";

const appId = "wx0123456789abcdef";
const secret = "fictional-rehearsal-not-wechat-secret";
export function parseWechatRehearsalArguments(args) {
  if (args.length === 0) return "disabled";
  if (args.length === 1 && ["disabled", "enabled"].includes(args[0]))
    return args[0];
  throw new Error(
    "仅支持 disabled 或 enabled；不接受数据库、端口、密钥或配置路径。",
  );
}

// 此入口始终新建匿名临时库，不读取生产环境的数据库、管理员或微信配置。
export async function startWechatRehearsal(phase = "disabled") {
  if (arguments.length > 1 || !["disabled", "enabled"].includes(phase))
    throw new Error("演练模式无效。");
  const directory = mkdtempSync(join(tmpdir(), "football-wechat-rehearsal-"));
  const databasePath = join(directory, "anonymous.sqlite");
  let store, server;
  try {
    chmodSync(directory, 0o700);
    writeFileSync(databasePath, "", { flag: "wx", mode: 0o600 });
    const admin = {
      username: "rehearsal-admin",
      password: randomBytes(24).toString("base64url"),
    };
    const playerAccount = {
      username: "rehearsal-player",
      password: randomBytes(24).toString("base64url"),
    };
    // 仅初始化阶段接受本函数内部构造的虚构身份；运行服务器没有该适配器。
    const provider = createWechatProvider({
      enabled: true,
      appId,
      appSecret: secret,
      fetchImpl: async (url) =>
        new Response(
          JSON.stringify({
            openid: `fictional-${new URL(url).searchParams.get("js_code")}`,
            session_key: "fictional-initialization-session-key",
          }),
        ),
    });
    store = openFootballStore(databasePath);
    const club = createClubStore(store.database, store, {
      bootstrapAdmin: admin,
      wechatProvider: provider,
      wechatAppId: appId,
    });
    const session = club.login(admin, "isolated-seed", "native");
    const actor = { token: session.token, transport: "native" };
    const user = club.authenticate(session.token, "native");
    const players = {};
    for (const [index, key] of [
      "password",
      "empty",
      "claimed",
      "bound",
    ].entries()) {
      players[key] = club.savePlayer(user.team_id, null, {
        name: `模拟队员${index + 1}·${key}`,
        number: index + 1,
        positions: ["中场"],
        note: "虚构成年球员，仅供本机隔离演练。",
      });
    }
    club.createAccount(user.team_id, players.password.id, playerAccount);
    const prepared = {};
    for (const key of ["claimed", "bound"]) {
      const invite = club.wechat.create(actor, players[key].id, {
        requestId: randomUUID(),
      });
      const identity = await provider.exchange(`seed-${key}`);
      const claim = club.wechat.claim(
        identity,
        { credential: invite.credential, requestId: randomUUID() },
        club.wechat.epoch(),
      );
      if (key === "bound")
        club.wechat.decide(
          actor,
          players[key].id,
          claim.id,
          {
            revision: claim.revision,
            confirmationCode: claim.confirmationCode,
          },
          "approve",
        );
      prepared[key] = {
        inviteId: claim.id,
        confirmationCode: claim.confirmationCode,
      };
    }
    club.logout(session.token);
    store.close();
    store = null;
    server = createFootballServer({
      databasePath,
      staticDirectory: join(directory, "no-static-files"),
      bootstrapAdmin: null,
      publicOrigin: "",
      secureCookies: false,
      trustedProxyAddresses: [],
      wechat: {
        enabled: phase === "enabled",
        appId,
        appSecret: secret,
        fetchImpl: async () => {
          throw new Error("隔离演练拒绝所有运行期微信凭据交换。");
        },
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = server.address().port;
    const manifestPath = join(directory, "private-manifest.json");
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          fictional: true,
          phase,
          directory,
          databasePath,
          port,
          admin,
          playerAccount,
          players,
          prepared,
          warning:
            "认领和绑定为内部模拟前置；运行期交换全部拒绝，不代表真实微信认证通过。",
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    let closed = false;
    return {
      directory,
      manifestPath,
      port,
      async close() {
        if (closed) return;
        closed = true;
        server.closeAllConnections();
        await new Promise((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
      },
    };
  } catch (error) {
    // 启动失败仍须关闭已构造的服务器；未监听也会触发资源 close 清理。
    // 清理异常不得覆盖原始故障，也不能阻止其余资源清理。
    try {
      store?.close();
    } catch {}
    if (server) {
      try {
        server.closeAllConnections();
      } catch {}
      try {
        await new Promise((resolveClose) => server.close(() => resolveClose()));
      } catch {}
    }
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {}

    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const rehearsal = await startWechatRehearsal(
    parseWechatRehearsalArguments(process.argv.slice(2)),
  );
  console.log(`隔离演练地址：http://127.0.0.1:${rehearsal.port}`);
  console.log(`私有账号与模拟核对编号仅保存在：${rehearsal.manifestPath}`);
  console.log(
    "未修改小程序配置。按 Ctrl+C 停止；临时目录保留，核验后自行删除。",
  );
  const stop = async () => {
    await rehearsal.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
