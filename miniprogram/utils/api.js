/* Native transport: never copy browser cookies or manufacture an Origin header. */
const config = require("../config");
const STORAGE_KEY = "football.native.session.v1";
let session = null;
let epoch = 0;
let checking = null;
let storageLoaded = false;

function failure(message, status = 0) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function baseUrl() {
  const value = String(config.apiBaseUrl || "").replace(/\/$/, "");
  const secure = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value);
  const local =
    config.allowLocalHttp === true &&
    /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/.test(value);
  if (!secure && !local)
    throw failure(
      "请先在 config.js 配置 HTTPS 服务地址；本地测试可启用回环地址。",
    );
  return value;
}
function identityValid(value) {
  return (
    value &&
    value.user &&
    value.team &&
    Number.isSafeInteger(value.user.id) &&
    value.user.id > 0 &&
    Number.isSafeInteger(value.user.teamId) &&
    value.user.teamId === value.team.id &&
    ["admin", "player"].includes(value.user.role) &&
    (value.user.role !== "player" ||
      (typeof value.user.playerId === "string" &&
        value.user.playerId.length > 0))
  );
}
function sessionValid(value) {
  return (
    identityValid(value) &&
    /^native_[a-f0-9]{64}$/.test(value.token) &&
    Number.isFinite(value.expiresAt) &&
    value.expiresAt > Date.now()
  );
}
function clearSession() {
  epoch += 1;
  session = null;
  checking = null;
  // Never reread a stale credential after an unavailable storage removal.
  storageLoaded = true;
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (_) {
    /* in-memory session is already cleared */
  }
}
function getSession() {
  let origin;
  try {
    origin = baseUrl();
  } catch (_) {
    clearSession();
    return null;
  }
  if (!storageLoaded) {
    storageLoaded = true;
    try {
      const value = wx.getStorageSync(STORAGE_KEY);
      if (sessionValid(value) && value.serverOrigin === origin) session = value;
      else clearSession();
    } catch (_) {
      /* storage failure must not block login */
    }
  }
  // Bind credentials to their issuing server. A config change is not consent to
  // send an old credential to a different host, even when both use HTTPS.
  if (session && (!sessionValid(session) || session.serverOrigin !== origin))
    clearSession();
  return session;
}
function transport(path, method, data, token, extraHeaders, origin) {
  if (!/^\/[a-z0-9/-]+(?:\?[^#]*)?$/i.test(path) || path.includes(".."))
    return Promise.reject(failure("无效的接口路径。"));
  let url;
  try {
    url = (origin || baseUrl()) + "/api" + path;
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout: 15000,
      header: Object.assign(
        { "Content-Type": "application/json" },
        token ? { Authorization: `Bearer ${token}` } : {},
        extraHeaders || {},
      ),
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300)
          resolve(response.data);
        else
          reject(
            failure(
              response.data && typeof response.data.message === "string"
                ? response.data.message
                : "请求未完成，请重试。",
              response.statusCode,
            ),
          );
      },
      fail() {
        reject(failure("网络连接失败，请检查网络后重试。"));
      },
    });
  });
}
async function request(path, method = "GET", data) {
  const current = getSession();
  if (!current) throw failure("请先登录俱乐部账号。", 401);
  const captured = epoch;
  try {
    const result = await transport(
      path,
      method,
      data,
      current.token,
      null,
      current.serverOrigin,
    );
    if (captured !== epoch || !getSession())
      throw failure("登录状态已变化，请重新打开页面。", 401);
    return result;
  } catch (error) {
    if (error.status === 401 && captured === epoch) clearSession();
    throw error;
  }
}
async function login(username, password) {
  clearSession();
  const origin = baseUrl();
  const captured = epoch;
  const result = await transport(
    "/auth/native-login",
    "POST",
    { username, password },
    null,
    { "X-Football-Client": "native-v1" },
    origin,
  );
  let currentOrigin;
  try {
    currentOrigin = baseUrl();
  } catch (_) {
    currentOrigin = null;
  }
  if (captured !== epoch || origin !== currentOrigin) {
    // A cancelled successful login can still create a server session. Revoke it
    // at its original issuer without letting a late response replace new login.
    if (sessionValid(result))
      transport("/auth/logout", "POST", {}, result.token, null, origin).catch(
        () => {},
      );
    throw failure("登录操作已取消，请重试。", 401);
  }
  if (!sessionValid(result)) throw failure("登录响应无效，请联系管理员。");
  session = {
    token: result.token,
    expiresAt: result.expiresAt,
    user: result.user,
    team: result.team,
    serverOrigin: origin,
  };
  try {
    wx.setStorageSync(STORAGE_KEY, session);
  } catch (_) {
    /* login remains usable until process exit */
  }
  return session;
}
async function logout() {
  const current = getSession();
  clearSession();
  if (current)
    await transport(
      "/auth/logout",
      "POST",
      {},
      current.token,
      null,
      current.serverOrigin,
    );
}
function ensureSession() {
  if (!getSession())
    return Promise.reject(failure("请先登录俱乐部账号。", 401));
  if (checking) return checking;
  const captured = epoch;
  const pending = request("/auth/me")
    .then((result) => {
      if (captured !== epoch) throw failure("登录状态已变化。", 401);
      if (!identityValid(result)) throw failure("账号响应无效，请重新登录。");
      session = Object.assign({}, session, {
        user: result.user,
        team: result.team,
      });
      try {
        wx.setStorageSync(STORAGE_KEY, session);
      } catch (_) {
        /* memory remains valid */
      }
      return { user: session.user, team: session.team };
    })
    .catch((error) => {
      if (captured === epoch && error.status === 403) clearSession();
      throw error;
    })
    .finally(() => {
      if (checking === pending) checking = null;
    });
  checking = pending;
  return pending;
}
module.exports = {
  request,
  login,
  logout,
  getSession,
  ensureSession,
  clearSession,
};
