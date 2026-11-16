import { createPlayerAiService } from "./player-ai-service.mjs";
import { applyPlayerAiAdoption } from "./player-ai-adoption.mjs";
import {
  createWechatProvider,
  WechatFoundationError,
} from "./wechat-provider.mjs";
import { createWechatAuthService } from "./wechat-auth-service.mjs";
import { createPlayerMediaStore } from "./player-media-store.mjs";
import {
  readTacticCommands,
  readTacticFormations,
  applyTacticCommands,
} from "./native-tactic-commands.mjs";
import {
  readTacticPositions,
  moveTacticPositions,
} from "./native-tactic-positions.mjs";
import { createServer } from "node:http";
import { isIP } from "node:net";
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
  aiPhotos = undefined,
  bootstrapAdmin = process.env.FOOTBALL_ADMIN_USERNAME &&
  process.env.FOOTBALL_ADMIN_PASSWORD
    ? {
        username: process.env.FOOTBALL_ADMIN_USERNAME,
        password: process.env.FOOTBALL_ADMIN_PASSWORD,
      }
    : undefined,
  wechat = {
    enabled: process.env.FOOTBALL_WECHAT_ENABLED === "true",
    appId: process.env.FOOTBALL_WECHAT_APP_ID,
    appSecret: process.env.FOOTBALL_WECHAT_APP_SECRET,
    codeEnvironment: process.env.FOOTBALL_WECHAT_CODE_ENV || "release",
  },
  publicOrigin = process.env.FOOTBALL_PUBLIC_ORIGIN,
  trustedProxyAddresses = (process.env.FOOTBALL_TRUSTED_PROXY_ADDRESSES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  secureCookies = process.env.FOOTBALL_COOKIE_SECURE === "true" ||
    publicOrigin?.startsWith("https:"),
} = {}) {
  if (
    !Array.isArray(trustedProxyAddresses) ||
    trustedProxyAddresses.some((ip) => !isIP(ip))
  )
    throw new Error("Trusted proxy addresses must be explicit IP addresses.");
  const trustedProxies = new Set(trustedProxyAddresses);
  const clientAddress = (request) => {
    const peer = request.socket.remoteAddress;
    const forwarded = request.headers["x-forwarded-for"];
    // A configured proxy must overwrite this header with one client IP. Never trust chains.
    return trustedProxies.has(peer) &&
      typeof forwarded === "string" &&
      isIP(forwarded.trim())
      ? forwarded.trim()
      : peer;
  };
  const wechatProvider = createWechatProvider(wechat);
  const store = openFootballStore(databasePath);
  let club, wechatAuth, playerMedia, playerAi;
  try {
    club = createClubStore(store.database, store, {
      bootstrapAdmin,
      wechatProvider,
      wechatAppId: wechat.appId,
    });
    wechatAuth = createWechatAuthService({ provider: wechatProvider, club });
    playerMedia = createPlayerMediaStore(store.database);
    playerAi = createPlayerAiService(store.database, {
      ...aiPhotos,
      authenticate: (token, transport) => club.authenticate(token, transport),
      getPlayer: (teamId, id) => club.getPlayer(teamId, id),
      getAlbumRevision: (teamId, id) =>
        store.database
          .prepare(
            "SELECT revision FROM club_player_albums WHERE team_id=? AND player_id=?",
          )
          .get(teamId, id)?.revision ?? 1,
      applyAdoption: (input) =>
        applyPlayerAiAdoption({ ...input, db: store.database }),
    });
  } catch (error) {
    store.close();
    throw error;
  }
  const cookie = (token, clear = false) =>
    `football_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${secureCookies ? "; Secure" : ""}`;
  const aiRate = new Map();
  const checkAiRate = (user, write) => {
    const now = Date.now();
    for (const [key, value] of aiRate)
      if (value.until <= now) aiRate.delete(key);
    const key = `${user.team_id}:${user.id}:${write ? "write" : "read"}`;
    let item = aiRate.get(key);
    if (!item) {
      if (aiRate.size >= 10000)
        throw new FootballError(429, "AI请求容量已满，请稍后再试。");
      item = { count: 0, until: now + 60000 };
      aiRate.set(key, item);
    }
    if (++item.count > (write ? 30 : 120))
      throw new FootballError(429, "AI操作过于频繁，请稍后再试。");
  };
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
      if (pathname === "/api/auth/capabilities" && method === "GET")
        return send(response, 200, {
          wechat: wechatAuth.enabled,
          aiPhotos: playerAi.enabled === true,
        });
      const wechatPreauth =
        method === "POST" &&
        /^\/api\/auth\/wechat\/(claim|claim-status|login)$/.exec(pathname);
      // Native credentials are never ambient cookies. A distinct token format
      // prevents browser sessions from being replayed to bypass Origin checks.
      const nativeLogin =
        pathname === "/api/auth/native-login" && method === "POST";
      const authorization = request.headers.authorization;
      const nativeRequest =
        nativeLogin || !!wechatPreauth || authorization !== undefined;
      if (nativeRequest) {
        // WeChat Electron simulator adds this exact Fetch Metadata tuple to
        // wx.request without an Origin. It is not an authentication signal.
        // Keep Origin/Cookie rejection and native-token isolation intact.
        const fetchHeaders = Object.keys(request.headers).filter((name) =>
          name.startsWith("sec-fetch-"),
        );
        const simulatorMetadata =
          fetchHeaders.length === 3 &&
          request.headers["sec-fetch-site"] === "same-site" &&
          request.headers["sec-fetch-mode"] === "cors" &&
          request.headers["sec-fetch-dest"] === "empty";
        if (
          request.headers.origin !== undefined ||
          request.headers.cookie !== undefined ||
          (fetchHeaders.length > 0 && !simulatorMetadata) ||
          ((nativeLogin || wechatPreauth) &&
            request.headers["x-football-client"] !== "native-v1")
        )
          throw new FootballError(403, "请使用小程序客户端重新操作。");
        if (
          !nativeLogin &&
          !wechatPreauth &&
          !/^Bearer native_[a-f0-9]{64}$/.test(authorization)
        )
          throw new FootballError(401, "请先登录。");
      }
      if (!nativeRequest && !["GET", "HEAD", "OPTIONS"].includes(method)) {
        const expectedOrigin = publicOrigin || `http://${request.headers.host}`;
        if (
          request.headers.origin !== expectedOrigin ||
          request.headers["sec-fetch-site"] === "cross-site"
        )
          throw new FootballError(403, "请求来源不可信，请从本站重新操作。");
      }
      const token = nativeRequest
        ? authorization?.slice("Bearer ".length)
        : (request.headers.cookie ?? "")
            .split(";")
            .map((value) => value.trim())
            .find((value) => value.startsWith("football_session="))
            ?.slice("football_session=".length);
      if (wechatPreauth) {
        if (authorization !== undefined)
          throw new FootballError(400, "登录时请勿携带旧会话。");
        const result = await wechatAuth.preauth(
          wechatPreauth[1],
          await readRequest(request, Math.min(maximumRequestBytes, 16384)),
          clientAddress(request),
        );
        return send(response, wechatPreauth[1] === "claim" ? 202 : 200, result);
      }
      if (nativeLogin) {
        if (authorization !== undefined)
          throw new FootballError(400, "登录时请勿携带旧会话。");
        return send(
          response,
          200,
          club.login(
            await readRequest(request, Math.min(maximumRequestBytes, 16384)),
            clientAddress(request),
            "native",
          ),
        );
      }
      if (pathname === "/api/auth/login" && method === "POST") {
        if (nativeRequest)
          throw new FootballError(400, "请使用小程序登录接口。");
        const { token: sessionToken, ...session } = club.login(
          await readRequest(request, Math.min(maximumRequestBytes, 16384)),
          clientAddress(request),
        );
        response.setHeader("Set-Cookie", cookie(sessionToken));
        return send(response, 200, session);
      }
      if (pathname === "/api/auth/logout" && method === "POST") {
        club.logout(token);
        if (!nativeRequest) response.setHeader("Set-Cookie", cookie("", true));
        return send(response, 204);
      }
      // Read untrusted input before authenticating. A password reset, logout, or
      // archival during a slow upload must invalidate that pending write too.
      let parsedBody;
      const playerPhotoDelete =
        method === "DELETE" &&
        /^\/api\/players\/[^/]+\/photos\/[1-9]\d*$/.test(pathname);
      const photoDelete =
        (method === "DELETE" &&
          /^\/api\/players\/[^/]+\/ai\/(sources|candidates)\/[^/]+$/.test(
            pathname,
          )) ||
        playerPhotoDelete ||
        (method === "DELETE" &&
          /^\/api\/matches\/[1-9]\d*\/photos\/[1-9]\d*$/.test(pathname));
      if (
        !["GET", "HEAD", "OPTIONS", "DELETE"].includes(method) ||
        photoDelete
      ) {
        const largeBody =
          /^\/api\/(?:tactics(?:\/|$)|tactic-collections$|coaching-desk$|players(?:$|\/[^/]+$))/.test(
            pathname,
          );
        parsedBody = await readRequest(
          request,
          (method === "POST" &&
            /^\/api\/players\/[^/]+\/ai\/sources$/.test(pathname)) ||
            pathname === "/api/team" ||
            (method === "POST" &&
              /^\/api\/players\/[^/]+\/photos$/.test(pathname)) ||
            (method === "POST" &&
              /^\/api\/matches\/[1-9]\d*\/photos$/.test(pathname))
            ? Math.min(maximumRequestBytes, 3 * 1024 * 1024)
            : largeBody
              ? maximumRequestBytes
              : Math.min(
                  maximumRequestBytes,
                  pathname.includes("/wechat-") ? 16384 : 1024 * 1024,
                ),
        );
      }
      const user = club.authenticate(
        token,
        nativeRequest ? "native" : "cookie",
      );
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
      const body = () => parsedBody;
      if (pathname === "/api/auth/me" && method === "GET")
        return send(response, 200, club.sessionView(user));
      if (pathname === "/api/auth/password" && method === "PUT") {
        club.changePassword(user, body());
        if (!nativeRequest) response.setHeader("Set-Cookie", cookie("", true));
        return send(response, 204);
      }
      if (user.must_change_password === 1) {
        const error = new FootballError(
          403,
          "请先修改初始密码，再使用其他功能。",
        );
        error.code = "PASSWORD_CHANGE_REQUIRED";
        throw error;
      }
      if (pathname === "/api/system/accounts") {
        if (method === "GET")
          return send(response, 200, club.listSystemAccounts(user));
        if (method === "POST")
          return send(response, 201, club.createSystemAccount(user, body()));
      }
      const systemAccountRoute = /^\/api\/system\/accounts\/([1-9]\d*)$/.exec(
        pathname,
      );
      if (systemAccountRoute && method === "PUT")
        return send(
          response,
          200,
          club.updateSystemAccount(
            user,
            routeId(systemAccountRoute[1]),
            body(),
          ),
        );
      if (pathname === "/api/team") {
        if (method === "GET")
          return send(response, 200, club.getTeam(user.team_id));
        if (method === "PUT") {
          admin();
          return send(response, 200, club.saveTeam(user.team_id, body()));
        }
      }
      if (pathname === "/api/venues") {
        if (method === "GET")
          return send(response, 200, club.listVenues(user.team_id));
        if (method === "POST") {
          admin();
          return send(
            response,
            201,
            club.saveVenue(user.team_id, null, body()),
          );
        }
      }
      const venueRoute = /^\/api\/venues\/([1-9]\d*)$/.exec(pathname);
      if (venueRoute) {
        const id = routeId(venueRoute[1]);
        if (method === "GET")
          return send(response, 200, club.getVenue(user.team_id, id));
        if (method === "PUT") {
          admin();
          return send(response, 200, club.saveVenue(user.team_id, id, body()));
        }
      }
      const aiRoute =
        /^\/api\/players\/([^/]+)\/ai\/(capabilities|consents|sources|jobs|candidates|adoptions)(?:\/([^/]+))?(?:\/(cancel|revoke))?$/.exec(
          pathname,
        );
      if (aiRoute) {
        admin();
        checkAiRate(user, method !== "GET");
        const [, playerId, resource, id, action] = aiRoute;
        const actor = { token, transport: nativeRequest ? "native" : "cookie" };
        const params = new URL(request.url, "http://localhost").searchParams;
        if (
          [...params.keys()].some((key) => key !== "requestId") ||
          params.getAll("requestId").length > 1
        )
          throw new FootballError(400, "AI查询参数无效。");
        const requestId = params.get("requestId");
        if (requestId && (method !== "GET" || id))
          throw new FootballError(400, "查询参数不适用。");
        if (
          resource === "capabilities" &&
          method === "GET" &&
          !id &&
          !requestId
        )
          return send(response, 200, playerAi.capabilities(actor, playerId));
        if (resource === "consents") {
          if (method === "POST" && !id)
            return send(
              response,
              201,
              playerAi.createConsent(actor, playerId, body()),
            );
          if (method === "GET" && !id && requestId)
            return send(
              response,
              200,
              playerAi.getConsentByRequest(actor, playerId, requestId),
            );
          if (method === "POST" && id && action === "revoke")
            return send(
              response,
              200,
              playerAi.revokeConsent(actor, playerId, id, body()),
            );
        }
        if (resource === "sources") {
          if (method === "POST" && !id)
            return send(
              response,
              201,
              await playerAi.uploadSource(actor, playerId, body()),
            );
          if (method === "GET" && !id && requestId)
            return send(
              response,
              200,
              playerAi.getSourceStatus(actor, playerId, requestId),
            );
          if (method === "DELETE" && id && !action) {
            const input = body();
            if (Object.keys(input).some((k) => k !== "revision"))
              throw new FootballError(400, "来源删除参数无效。");
            return send(
              response,
              200,
              playerAi.deleteSource(actor, playerId, { ...input, id }),
            );
          }
        }
        if (resource === "jobs") {
          if (method === "POST" && !id)
            return send(
              response,
              202,
              playerAi.createJob(actor, playerId, body()),
            );
          if (method === "GET" && id && !action)
            return send(response, 200, playerAi.getJob(actor, playerId, id));
          if (method === "GET" && !id && requestId)
            return send(
              response,
              200,
              playerAi.getJobByRequest(actor, playerId, requestId),
            );
          if (method === "POST" && id && action === "cancel")
            return send(
              response,
              200,
              playerAi.cancelJob(actor, playerId, id, body()),
            );
        }
        if (resource === "candidates" && id && !action) {
          if (method === "GET")
            return send(
              response,
              200,
              playerAi.getCandidate(actor, playerId, id),
            );
          if (method === "DELETE")
            return send(
              response,
              200,
              playerAi.deleteCandidate(actor, playerId, id, body()),
            );
        }
        if (resource === "adoptions" && !id) {
          if (method === "POST")
            return send(response, 200, playerAi.adopt(actor, playerId, body()));
          if (method === "GET" && requestId)
            return send(
              response,
              200,
              playerAi.getAdoptionByRequest(actor, playerId, requestId),
            );
        }
        throw new FootballError(405, "不支持的AI操作。");
      }
      if (pathname === "/api/players") {
        if (method === "GET")
          return send(response, 200, club.listPlayers(user.team_id));
        if (method === "POST") {
          admin();
          return send(
            response,
            201,
            club.savePlayer(user.team_id, null, body()),
          );
        }
      }
      const invitationRoute =
        /^\/api\/players\/([^/]+)\/wechat-invites(?:\/([a-f0-9]{32})\/(approve|reject|revoke|code))?$/.exec(
          pathname,
        );
      const bindingRoute =
        /^\/api\/players\/([^/]+)\/wechat-binding(?:\/(revoke))?$/.exec(
          pathname,
        );
      if (invitationRoute || bindingRoute) {
        admin();
        const actor = { token, transport: nativeRequest ? "native" : "cookie" };
        if (invitationRoute) {
          const [, playerId, id, action] = invitationRoute;
          if (!id && method === "POST") {
            const result = wechatAuth.manage(actor, playerId, "create", body());
            return send(
              response,
              result.credentialUnavailable ? 200 : 201,
              result,
            );
          }
          if (!id && method === "GET") {
            const query = new URL(request.url, "http://localhost").searchParams;
            if ([...query.keys()].some((k) => !["limit", "cursor"].includes(k)))
              throw new FootballError(400, "邀请分页参数不正确。");
            return send(
              response,
              200,
              wechatAuth.manage(actor, playerId, "list", {
                ...(query.has("limit")
                  ? { limit: Number(query.get("limit")) }
                  : {}),
                ...(query.has("cursor") ? { cursor: query.get("cursor") } : {}),
              }),
            );
          }
          if (id && action === "code" && method === "POST")
            return send(response, 200, await wechatAuth.inviteCode(actor, playerId, id, body()));
          if (id && method === "POST")
            return send(
              response,
              200,
              wechatAuth.manage(actor, playerId, action, { ...body(), id }),
            );
        } else {
          const [, playerId, action] = bindingRoute;
          if (!action && method === "GET")
            return send(
              response,
              200,
              wechatAuth.manage(actor, playerId, "binding"),
            );
          if (action && method === "POST")
            return send(
              response,
              200,
              wechatAuth.manage(actor, playerId, "unbind", body()),
            );
        }
        throw new FootballError(405, "此微信操作不支持该方法。");
      }
      const playerPhotos =
        /^\/api\/players\/([^/]+)\/photos(?:\/(cover|order|[1-9]\d*))?$/.exec(
          pathname,
        );
      if (playerPhotos) {
        const [, id, part] = playerPhotos;
        if (!part && method === "GET")
          return send(response, 200, playerMedia.list(user, id));
        if (part && !["cover", "order"].includes(part) && method === "GET")
          return send(response, 200, playerMedia.get(user, id, routeId(part)));
        admin();
        if (!part && method === "POST")
          return send(
            response,
            201,
            await playerMedia.add(user, id, body(), () =>
              club.authenticate(token, nativeRequest ? "native" : "cookie"),
            ),
          );
        if (part === "cover" && method === "PUT")
          return send(response, 200, playerMedia.cover(user, id, body()));
        if (part === "order" && method === "PUT")
          return send(response, 200, playerMedia.order(user, id, body()));
        if (part && !["cover", "order"].includes(part) && method === "PUT")
          return send(
            response,
            200,
            playerMedia.caption(user, id, routeId(part), body()),
          );
        if (part && !["cover", "order"].includes(part) && method === "DELETE")
          return send(
            response,
            200,
            playerMedia.remove(user, id, routeId(part), body()),
          );
        throw new FootballError(405, "球员照片操作方式不支持。");
      }
      const playerRoute =
        /^\/api\/players\/([^/]+)(?:\/(account|password))?$/.exec(pathname);
      if (playerRoute) {
        const [, id, action] = playerRoute;
        if (!action && method === "GET")
          return send(response, 200, club.getPlayer(user.team_id, id));
        admin();
        if (!action && method === "PUT")
          return send(response, 200, club.savePlayer(user.team_id, id, body()));
        if (action === "account" && method === "POST")
          return send(
            response,
            201,
            club.createAccount(user.team_id, id, body()),
          );
        if (action === "password" && method === "PUT") {
          club.resetPassword(user.team_id, id, body());
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
            club.saveSeason(user.team_id, null, body()),
          );
        }
      }
      const seasonRosterRoute = /^\/api\/seasons\/([1-9]\d*)\/roster$/.exec(
        pathname,
      );
      if (seasonRosterRoute) {
        const id = routeId(seasonRosterRoute[1]);
        if (method === "GET")
          return send(response, 200, club.getSeasonRoster(user.team_id, id));
        if (method === "PUT") {
          admin();
          return send(
            response,
            200,
            club.saveSeasonRoster(user.team_id, id, body()),
          );
        }
      }
      const seasonRoute = /^\/api\/seasons\/([1-9]\d*)$/.exec(pathname);
      if (seasonRoute && method === "PUT") {
        admin();
        return send(
          response,
          200,
          club.saveSeason(user.team_id, routeId(seasonRoute[1]), body()),
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
          return send(response, 201, club.saveMatch(user, null, body()));
        }
      }
      const matchPhotoRoute =
        /^\/api\/matches\/([1-9]\d*)\/photos(?:\/(cover|order|[1-9]\d*))?$/.exec(
          pathname,
        );
      if (matchPhotoRoute) {
        const id = routeId(matchPhotoRoute[1]),
          part = matchPhotoRoute[2];
        if (!part && method === "GET")
          return send(response, 200, club.listMatchPhotos(user, id));
        if (part && !["cover", "order"].includes(part) && method === "GET")
          return send(
            response,
            200,
            club.getMatchPhoto(user, id, routeId(part)),
          );
        admin();
        if (!part && method === "POST")
          return send(response, 201, club.addMatchPhoto(user, id, body()));
        if (part === "order" && method === "PUT")
          return send(response, 200, club.orderMatchPhotos(user, id, body()));
        if (part === "cover" && method === "PUT")
          return send(response, 200, club.setMatchCover(user, id, body()));
        if (part && !["cover", "order"].includes(part) && method === "DELETE")
          return send(
            response,
            200,
            club.removeMatchPhoto(user, id, routeId(part), body()),
          );
        throw new FootballError(405, "照片操作方式不支持。");
      }
      const matchRoute =
        /^\/api\/matches\/([1-9]\d*)(?:\/(rsvp|roster))?$/.exec(pathname);
      if (matchRoute) {
        const id = routeId(matchRoute[1]),
          action = matchRoute[2];
        if (!action && method === "GET")
          return send(response, 200, club.getMatch(user, id));
        if (action === "rsvp" && method === "PUT")
          return send(response, 200, club.saveRsvp(user, id, body()));
        admin();
        if (!action && method === "PUT")
          return send(response, 200, club.saveMatch(user, id, body()));
        if (action === "roster" && method === "PUT")
          return send(response, 200, club.saveRoster(user, id, body()));
      }
      // Legacy tactical resources belong to the original team. Never expose them to future teams.
      if (user.team_id !== 1)
        throw new FootballError(403, "无权访问其他球队的战术。");
      if (method !== "GET") admin();
      if (pathname === "/api/tactic-formations") {
        admin();
        if (method !== "GET")
          throw new FootballError(405, "阵型目录仅支持读取。");
        return send(response, 200, readTacticFormations());
      }
      if (pathname === "/api/tactic-create-receipts") {
        admin();
        if (method !== "GET")
          throw new FootballError(405, "新建回执仅支持读取。");
        const query = new URL(request.url, "http://localhost").searchParams;
        if (
          [...query.keys()].some((key) => key !== "requestId") ||
          query.getAll("requestId").length !== 1
        )
          throw new FootballError(400, "请提供唯一的新建请求编号。");
        return send(
          response,
          200,
          store.getTacticCreateReceipt(user, query.get("requestId")),
        );
      }
      const nativeCommands = /^\/api\/tactics\/([1-9]\d*)\/commands$/.exec(
        pathname,
      );
      if (nativeCommands) {
        const id = routeId(nativeCommands[1]);
        if (method === "GET")
          return send(response, 200, readTacticCommands(store, id));
        if (method === "PUT")
          return send(
            response,
            200,
            applyTacticCommands(store, id, body(), (playerId) =>
              club.getPlayer(user.team_id, playerId),
            ),
          );
        throw new FootballError(405, "此战术命令接口不支持该操作。");
      }
      const nativePositions = /^\/api\/tactics\/([1-9]\d*)\/positions$/.exec(
        pathname,
      );
      if (nativePositions) {
        const id = Number(nativePositions[1]);
        if (!Number.isSafeInteger(id))
          throw new FootballError(400, "请选择有效战术编号。");
        if (method === "GET")
          return send(response, 200, readTacticPositions(store, id));
        if (method === "PUT")
          return send(response, 200, moveTacticPositions(store, id, body()));
        throw new FootballError(405, "此站位接口不支持该操作。");
      }
      if (pathname === "/api/tactics") {
        if (method === "GET") return send(response, 200, store.listTactics());
        if (method === "POST")
          return send(response, 201, store.saveTactic(null, body(), user));
      } else if (pathname === "/api/coaching-desk") {
        if (method === "GET") return send(response, 200, club.tacticalDesk());
        if (method === "PUT") {
          return send(response, 200, club.saveTacticalDesk(body()));
        }
      } else if (pathname === "/api/tactic-collections") {
        if (method === "GET")
          return send(response, 200, store.exportCollection());
        if (method === "POST") {
          const { repeated, ...collection } = store.importCollection(body());
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
            return send(response, 201, store.saveVersion(tacticId, body()));
        } else {
          if (method === "GET")
            return send(response, 200, store.getTactic(tacticId));
          if (method === "PUT")
            return send(response, 200, store.saveTactic(tacticId, body()));
          if (method === "PATCH")
            return send(response, 200, store.updateTactic(tacticId, body()));
          if (method === "DELETE") {
            store.deleteTactic(tacticId, () =>
              club.assertTacticDeletable(tacticId),
            );
            return send(response, 204);
          }
        }
      }
      throw new FootballError(405, "此足球页面不支持该操作。");
    } catch (error) {
      if (error instanceof WechatFoundationError)
        error = new FootballError(error.status, error.message);
      if (!(error instanceof FootballError))
        console.error("Football storage failed:", error);
      if (!response.headersSent)
        send(response, error instanceof FootballError ? error.status : 500, {
          ...(error instanceof FootballError &&
          [
            "ANIMATION_IDENTITY_CONFIRMATION_REQUIRED",
            "PASSWORD_CHANGE_REQUIRED",
          ].includes(error.code)
            ? { code: error.code }
            : {}),
          message:
            error instanceof FootballError
              ? error.message
              : "训练保存失败，请重试。",
        });
      else response.end();
    }
  });
  // Node 的 close 回调仅表示监听/连接关闭，不代表异步工作和 SQLite 已释放。
  // 可信本机演练与测试可显式等待该 Promise，再清理自己的临时目录。
  let resolveDrained, rejectDrained;
  server.drained = new Promise((resolve, reject) => {
    resolveDrained = resolve;
    rejectDrained = reject;
  });
  // CLI 调用者不一定等待；保留可观察 rejection，同时避免未处理拒绝。
  server.drained.catch(() => {});
  server.once("close", async () => {
    try {
      playerAi.close();
      await playerAi.drain();
      store.close();
      resolveDrained();
    } catch (error) {
      try {
        store.close();
      } catch {}
      rejectDrained(error);
    }
  });
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
