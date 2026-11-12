import { createServer } from "node:http";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FootballError, openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../app");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

function readRequest(request, maximumRequestBytes) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")
  )
    throw new FootballError(415, "请使用支持的格式提交战术或教练工作台。");
  if (Number(request.headers["content-length"]) > maximumRequestBytes)
    throw new FootballError(413, "训练内容或图片过大。");
  return new Promise((resolveRequest, rejectRequest) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maximumRequestBytes) {
        chunks.length = 0;
        rejectRequest(new FootballError(413, "训练内容或图片过大。"));
      } else chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > maximumRequestBytes) return;
      try {
        resolveRequest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        rejectRequest(new FootballError(400, "无法读取训练内容，请检查格式。"));
      }
    });
    request.on("error", rejectRequest);
    request.on("aborted", () =>
      rejectRequest(new FootballError(400, "训练保存已中断。")),
    );
  });
}

async function serveSite(request, response, pathname, staticDirectory) {
  if (!["GET", "HEAD"].includes(request.method))
    throw new FootballError(405, "此页面仅支持查看。");
  const root = resolve(staticDirectory);
  let file = resolve(root, "." + pathname);
  if (file !== root && !file.startsWith(root + sep))
    throw new FootballError(404, "未找到此足球页面。");
  try {
    if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
  } catch {
    if (extname(pathname) || pathname.startsWith("/assets/"))
      throw new FootballError(404, "未找到此足球页面。");
    file = resolve(root, "index.html");
  }
  const extension = extname(file);
  let metadata;
  try {
    metadata = await stat(file);
  } catch {
    throw new FootballError(404, "足球应用尚未完成构建。");
  }
  const encodings = (request.headers["accept-encoding"] ?? "")
    .split(",")
    .map((entry) => {
      const [name, ...parameters] = entry.trim().toLowerCase().split(";");
      const quality = parameters.find((parameter) =>
        parameter.trim().startsWith("q="),
      );
      return { name, quality: quality ? Number(quality.trim().slice(2)) : 1 };
    });
  const gzip =
    encodings.find((entry) => entry.name === "gzip") ??
    encodings.find((entry) => entry.name === "*");
  let compressed = false;
  if (
    gzip?.quality > 0 &&
    [".js", ".css", ".html", ".svg", ".json"].includes(extension)
  ) {
    try {
      const candidate = await stat(file + ".gz");
      if (candidate.isFile() && candidate.mtimeMs >= metadata.mtimeMs) {
        file += ".gz";
        metadata = candidate;
        compressed = true;
      }
    } catch {
      /* Uncompressed assets remain available when no prebuilt gzip exists. */
    }
  }
  const immutable =
    /^\/(?:js|css|assets)\/[^/]+-[\w-]{8,}\.(?:js|css|woff2?|png|svg|webp)$/.test(
      pathname,
    );
  const etag = `W/"${metadata.size.toString(16)}-${metadata.mtimeMs.toString(16)}-${compressed ? "gzip" : "identity"}"`;
  const headers = {
    "Content-Type": contentTypes[extension] ?? "application/octet-stream",
    "Cache-Control": immutable
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "X-Content-Type-Options": "nosniff",
    Vary: "Accept-Encoding",
    ETag: etag,
    ...(compressed ? { "Content-Encoding": "gzip" } : {}),
  };
  if (
    (request.headers["if-none-match"] ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .some((tag) => tag === "*" || tag === etag)
  ) {
    response.writeHead(304, headers);
    response.end();
    return;
  }
  response.writeHead(200, { ...headers, "Content-Length": metadata.size });
  if (request.method === "HEAD") response.end();
  else await pipeline(createReadStream(file), response);
}

export function createFootballServer({
  databasePath = process.env.FOOTBALL_DB_PATH ||
    resolve(appDirectory, "data/football.sqlite"),
  staticDirectory = resolve(appDirectory, "dist"),
  maximumRequestBytes = 25 * 1024 * 1024,
  bootstrapAdmin = process.env.FOOTBALL_ADMIN_USERNAME &&
  process.env.FOOTBALL_ADMIN_PASSWORD
    ? {
        username: process.env.FOOTBALL_ADMIN_USERNAME,
        password: process.env.FOOTBALL_ADMIN_PASSWORD,
      }
    : undefined,
  publicOrigin = process.env.FOOTBALL_PUBLIC_ORIGIN,
  secureCookies = process.env.FOOTBALL_COOKIE_SECURE === "true" ||
    publicOrigin?.startsWith("https:"),
} = {}) {
  const store = openFootballStore(databasePath);
  const club = createClubStore(store.database, store, { bootstrapAdmin });
  const cookie = (token, clear = false) =>
    `football_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${secureCookies ? "; Secure" : ""}`;
  const server = createServer(async (request, response) => {
    try {
      let pathname;
      try {
        pathname = decodeURIComponent(
          new URL(request.url, "http://localhost").pathname,
        );
      } catch {
        throw new FootballError(400, "足球页面地址不正确。");
      }
      if (pathname !== "/api" && !pathname.startsWith("/api/")) {
        await serveSite(request, response, pathname, staticDirectory);
        return;
      }
      const method = request.method;
      if (pathname === "/api/health" && method === "GET")
        return send(response, 200, { ok: true });
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const expectedOrigin = publicOrigin || `http://${request.headers.host}`;
        if (
          request.headers.origin !== expectedOrigin ||
          request.headers["sec-fetch-site"] === "cross-site"
        )
          throw new FootballError(403, "请求来源不可信，请从本站重新操作。");
      }
      const token = (request.headers.cookie ?? "")
        .split(";")
        .map((value) => value.trim())
        .find((value) => value.startsWith("football_session="))
        ?.slice("football_session=".length);
      if (pathname === "/api/auth/login" && method === "POST") {
        const { token: sessionToken, ...session } = club.login(
          await readRequest(request, Math.min(maximumRequestBytes, 16384)),
          request.socket.remoteAddress,
        );
        response.setHeader("Set-Cookie", cookie(sessionToken));
        return send(response, 200, session);
      }
      if (pathname === "/api/auth/logout" && method === "POST") {
        club.logout(token);
        response.setHeader("Set-Cookie", cookie("", true));
        return send(response, 204);
      }
      const user = club.authenticate(token);
      const admin = () => {
        if (user.role !== "admin")
          throw new FootballError(403, "此操作需要管理员权限。");
      };
      const routeId = (value) => {
        const id = Number(value);
        if (!Number.isSafeInteger(id) || id < 1)
          throw new FootballError(400, "资源编号不正确。");
        return id;
      };
      const body = () =>
        readRequest(request, Math.min(maximumRequestBytes, 1024 * 1024));
      if (pathname === "/api/auth/me" && method === "GET")
        return send(response, 200, club.sessionView(user));
      if (pathname === "/api/auth/password" && method === "PUT") {
        club.changePassword(user, await body());
        response.setHeader("Set-Cookie", cookie("", true));
        return send(response, 204);
      }
      if (pathname === "/api/players") {
        if (method === "GET")
          return send(response, 200, club.listPlayers(user.team_id));
        if (method === "POST") {
          admin();
          return send(
            response,
            201,
            club.savePlayer(user.team_id, null, await body()),
          );
        }
      }
      const playerRoute =
        /^\/api\/players\/([^/]+)(?:\/(account|password))?$/.exec(pathname);
      if (playerRoute) {
        const [, id, action] = playerRoute;
        if (!action && method === "GET")
          return send(response, 200, club.getPlayer(user.team_id, id));
        admin();
        if (!action && method === "PUT")
          return send(
            response,
            200,
            club.savePlayer(user.team_id, id, await body()),
          );
        if (action === "account" && method === "POST")
          return send(
            response,
            201,
            club.createAccount(user.team_id, id, await body()),
          );
        if (action === "password" && method === "PUT") {
          club.resetPassword(user.team_id, id, await body());
          return send(response, 204);
        }
      }
      if (pathname === "/api/seasons") {
        if (method === "GET")
          return send(response, 200, club.listSeasons(user.team_id));
        if (method === "POST") {
          admin();
          return send(
            response,
            201,
            club.saveSeason(user.team_id, null, await body()),
          );
        }
      }
      const seasonRoute = /^\/api\/seasons\/([1-9]\d*)$/.exec(pathname);
      if (seasonRoute && method === "PUT") {
        admin();
        return send(
          response,
          200,
          club.saveSeason(user.team_id, routeId(seasonRoute[1]), await body()),
        );
      }
      if (pathname === "/api/statistics" && method === "GET")
        return send(
          response,
          200,
          club.statistics(
            user,
            new URL(request.url, "http://localhost").searchParams,
          ),
        );
      if (pathname === "/api/matches") {
        if (method === "GET")
          return send(response, 200, club.listMatches(user));
        if (method === "POST") {
          admin();
          return send(response, 201, club.saveMatch(user, null, await body()));
        }
      }
      const matchRoute =
        /^\/api\/matches\/([1-9]\d*)(?:\/(rsvp|roster))?$/.exec(pathname);
      if (matchRoute) {
        const id = routeId(matchRoute[1]),
          action = matchRoute[2];
        if (!action && method === "GET")
          return send(response, 200, club.getMatch(user, id));
        if (action === "rsvp" && method === "PUT")
          return send(response, 200, club.saveRsvp(user, id, await body()));
        admin();
        if (!action && method === "PUT")
          return send(response, 200, club.saveMatch(user, id, await body()));
        if (action === "roster" && method === "PUT")
          return send(response, 200, club.saveRoster(user, id, await body()));
      }
      // Legacy tactical resources belong to the original team. Never expose them to future teams.
      if (user.team_id !== 1)
        throw new FootballError(403, "无权访问其他球队的战术。");
      if (method !== "GET") admin();
      if (pathname === "/api/tactics") {
        if (method === "GET") return send(response, 200, store.listTactics());
        if (method === "POST")
          return send(
            response,
            201,
            store.saveTactic(
              null,
              await readRequest(request, maximumRequestBytes),
            ),
          );
      } else if (pathname === "/api/coaching-desk") {
        if (method === "GET") return send(response, 200, club.tacticalDesk());
        if (method === "PUT") {
          store.saveDesk(await readRequest(request, maximumRequestBytes));
          club.syncLegacy({ overwrite: true });
          return send(response, 200, club.tacticalDesk());
        }
      } else if (pathname === "/api/tactic-collections") {
        if (method === "GET")
          return send(response, 200, store.exportCollection());
        if (method === "POST") {
          const { repeated, ...collection } = store.importCollection(
            await readRequest(request, maximumRequestBytes),
          );
          return send(response, repeated ? 200 : 201, collection);
        }
      } else {
        const route = /^\/api\/tactics\/([1-9]\d*)(\/versions)?$/.exec(
          pathname,
        );
        if (!route) throw new FootballError(404, "未找到此足球服务。");
        const tacticId = Number(route[1]);
        if (!Number.isSafeInteger(tacticId))
          throw new FootballError(400, "请选择有效战术编号。");
        if (route[2]) {
          if (method === "GET")
            return send(response, 200, store.listVersions(tacticId));
          if (method === "POST")
            return send(
              response,
              201,
              store.saveVersion(
                tacticId,
                await readRequest(request, maximumRequestBytes),
              ),
            );
        } else {
          if (method === "GET")
            return send(response, 200, store.getTactic(tacticId));
          if (method === "PUT")
            return send(
              response,
              200,
              store.saveTactic(
                tacticId,
                await readRequest(request, maximumRequestBytes),
              ),
            );
          if (method === "PATCH")
            return send(
              response,
              200,
              store.updateTactic(
                tacticId,
                await readRequest(request, maximumRequestBytes),
              ),
            );
          if (method === "DELETE") {
            store.deleteTactic(tacticId);
            return send(response, 204);
          }
        }
      }
      throw new FootballError(405, "此足球页面不支持该操作。");
    } catch (error) {
      if (!(error instanceof FootballError))
        console.error("Football storage failed:", error);
      if (!response.headersSent)
        send(response, error instanceof FootballError ? error.status : 500, {
          message:
            error instanceof FootballError
              ? error.message
              : "训练保存失败，请重试。",
        });
      else response.end();
    }
  });
  server.once("close", () => store.close());
  server.requestTimeout = 30000;
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const port = Number(process.env.PORT || 13001);
  const host = process.env.HOST || "127.0.0.1";
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT must be between 0 and 65535.");
  const server = createFootballServer();
  server.listen(port, host, () =>
    console.log(
      `Football server listening at http://${host}:${server.address().port}`,
    ),
  );
  server.on("error", (error) => {
    console.error("Football server could not start:", error.message);
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      server.close();
    });
}
