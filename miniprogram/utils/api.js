/* Native transport: never copy browser cookies or manufacture an Origin header. */
const config = require("../config");
const STORAGE_KEY = "football.native.session.v1";
let session = null;
let epoch = 0;
let checking = null;
let storageLoaded = false;

function failure(message, status = 0, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
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
function persistSession() {
  // Large crest images belong to the view cache, not the credential storage record.
  const team = {
    id: session.team.id,
    name: session.team.name,
    revision: session.team.revision,
    crest: null,
  };
  wx.setStorageSync(STORAGE_KEY, { ...session, team });
}
function clearSession() {
  // 退出只移除匿名创建草稿内容，保留最小回执以免未知结果被重复创建。
  try {
    for (const key of wx.getStorageInfoSync?.().keys || []) {
      if (key.startsWith("football.tactic-create.v1:")) {
        const receipt = wx.getStorageSync(key);
        if (receipt?.requestId) wx.setStorageSync(key, { requestId: receipt.requestId });
      }
    }
  } catch (_) { /* 存储失败不阻止会话失效。 */ }
  require("./media").clearImageCache();
  require("./player-photo-cache").clearAll();
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
              typeof response.data?.code === "string" ? response.data.code : undefined,
            ),
          );
      },
      fail() {
        reject(failure("网络连接失败，请检查网络后重试。"));
      },
    });
  });
}
let passwordRedirecting = false;
function requirePasswordChange() {
  if (!getSession()?.user.mustChangePassword || passwordRedirecting) return;
  passwordRedirecting = true;
  wx.reLaunch({url:"/pages/force-password/index",complete:()=>{passwordRedirecting=false;}});
}
function enterAuthenticated() {
  if (getSession()?.user.mustChangePassword) requirePasswordChange();
  else wx.switchTab({url:"/pages/home/index"});
}
async function request(path, method = "GET", data) {
  const current = getSession();
  if (!current) throw failure("请先登录俱乐部账号。", 401);
  if (current.user.mustChangePassword && !["/auth/me","/auth/password","/auth/logout"].includes(path)) {
    requirePasswordChange();
    throw failure("请先修改初始密码。",403,"PASSWORD_CHANGE_REQUIRED");
  }
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
    // 只由本地请求代次判断；必须在当前 401 清理会话之前记录。
    if (captured !== epoch) error.staleSession = true;
    if (error.code === "PASSWORD_CHANGE_REQUIRED" && captured === epoch && getSession()?.token === current.token) {
      session.user = {...session.user,mustChangePassword:true};
      try {persistSession();} catch (_) {}
      requirePasswordChange();
    }
    if (error.status === 401 && captured === epoch) clearSession();
    throw error;
  }
}
function beginLogin(username, password) {
  clearSession();
  const captured = epoch;
  let settled = false;
  const promise = (async () => {
    const origin = baseUrl();
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
      persistSession();
    } catch (_) {
      /* login remains usable until process exit */
    }
    return session;
  })().finally(() => {
    settled = true;
  });
  return {
    promise,
    cancel() {
      if (!settled && captured === epoch) clearSession();
    },
  };
}
async function capabilities() {
  const origin = baseUrl();
  const result = await transport(
    "/auth/capabilities",
    "GET",
    undefined,
    null,
    null,
    origin,
  );
  if (origin !== baseUrl()) throw failure("服务地址已变化，请重试");
  return { wechat: result?.wechat === true };
}
function beginWechat(action, input = {}) {
  if (!["login", "claim", "claim-status"].includes(action))
    throw failure("不支持的微信操作");
  if (action === "login") clearSession();
  const captured = epoch;
  let origin;
  try {
    origin = baseUrl();
  } catch (e) {
    return { promise: Promise.reject(e), cancel() {} };
  }
  const capturedInput = {
    credential: input.credential,
    requestId: input.requestId,
    inviteId: input.inviteId,
  };
  let cancelled = false,
    settled = false;
  const active = () => !cancelled && captured === epoch && origin === baseUrl();
  const promise = (async () => {
    if (
      action === "claim" &&
      (!/^[a-f0-9]{64}$/.test(capturedInput.credential || "") ||
        typeof capturedInput.requestId !== "string" ||
        !capturedInput.requestId ||
        capturedInput.requestId.length > 128)
    )
      throw failure("邀请参数不正确");
    if (
      action === "claim-status" &&
      !/^[a-f0-9]{32}$/.test(capturedInput.inviteId || "")
    )
      throw failure("申请编号不正确");
    const code = await new Promise((resolve, reject) => {
      if (typeof wx.login !== "function") {
        reject(failure("此环境不支持微信登录，请使用账号密码"));
        return;
      }
      wx.login({
        timeout: 15000,
        success: (r) =>
          typeof r.code === "string" && r.code
            ? resolve(r.code)
            : reject(failure("未取得微信登录凭据，请重试")),
        fail: () => reject(failure("微信登录未完成，请主动重试")),
      });
    });
    if (!active()) throw failure("微信操作已取消");
    const payload =
      action === "claim"
        ? {
            code,
            credential: capturedInput.credential,
            requestId: capturedInput.requestId,
          }
        : action === "claim-status"
          ? { code, inviteId: capturedInput.inviteId }
          : { code };
    const result = await transport(
      "/auth/wechat/" + action,
      "POST",
      payload,
      null,
      { "X-Football-Client": "native-v1" },
      origin,
    );
    let current = false;
    try {
      current = active();
    } catch (_) {}
    if (!current) {
      if (action === "login" && sessionValid(result))
        transport("/auth/logout", "POST", {}, result.token, null, origin).catch(
          () => {},
        );
      throw failure("微信操作已取消，请重新打开");
    }
    if (action !== "login") return result;
    if (!sessionValid(result)) throw failure("登录响应无效，请联系管理员");
    session = {
      token: result.token,
      expiresAt: result.expiresAt,
      user: result.user,
      team: result.team,
      serverOrigin: origin,
    };
    try {
      persistSession();
    } catch (_) {}
    return session;
  })().finally(() => {
    settled = true;
  });
  return {
    promise,
    cancel() {
      if (settled) return;
      cancelled = true;
      if (action === "login" && captured === epoch) clearSession();
    },
  };
}
function login(username, password) {
  return beginLogin(username, password).promise;
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
function ensureSessionRaw() {
  if (!getSession())
    return Promise.reject(failure("请先登录俱乐部账号。", 401));
  if (checking) return checking;
  const captured = epoch;
  const pending = request("/auth/me")
    .then((result) => {
      if (captured !== epoch) throw Object.assign(failure("登录状态已变化。", 401), { staleSession: true });
      if (!identityValid(result)) throw failure("账号响应无效，请重新登录。");
      session = Object.assign({}, session, {
        user: result.user,
        team: result.team,
      });
      try {
        persistSession();
      } catch (_) {
        /* memory remains valid */
      }
      return { user: session.user, team: session.team };
    })
    .catch((error) => {
      if (captured === epoch && error.status === 403 && error.code !== "PASSWORD_CHANGE_REQUIRED") clearSession();
      throw error;
    })
    .finally(() => {
      if (checking === pending) checking = null;
    });
  checking = pending;
  return pending;
}
let gatedSessionSource = null;
let gatedSessionPromise = null;
function ensureSession(options = {}) {
  const pending = ensureSessionRaw();
  if (options.allowPasswordChange) return pending;
  if (gatedSessionSource === pending) return gatedSessionPromise;
  gatedSessionSource = pending;
  gatedSessionPromise = pending.then(result=>{
    if (result.user.mustChangePassword) {
      requirePasswordChange();
      throw failure("请先修改初始密码。",403,"PASSWORD_CHANGE_REQUIRED");
    }
    return result;
  });
  return gatedSessionPromise;
}

module.exports = {
  enterAuthenticated,
  requirePasswordChange,
  request,
  login,
  beginLogin,
  beginWechat,
  capabilities,
  logout,
  getSession,
  ensureSession,
  clearSession,
};
