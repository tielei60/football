// 服务端微信交换适配器，由默认关闭的认证服务装配；未启用时不外呼或接受测试身份。
export class WechatFoundationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new WechatFoundationError(status, message);
};
export function createWechatProvider({
  enabled = false,
  appId,
  appSecret,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
  codeEnvironment = "release",
} = {}) {
  const identities = new WeakSet();
  if (
    enabled &&
    (!/^wx[0-9a-f]{16}$/.test(appId || "") ||
      typeof appSecret !== "string" ||
      appSecret.length < 16 ||
      typeof fetchImpl !== "function")
  )
    fail(503, "微信认证配置不完整。");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000)
    fail(503, "微信认证超时配置不正确。");
  if (!["release", "trial", "develop"].includes(codeEnvironment)) fail(503, "小程序码环境配置不正确。");
  return {
    enabled: enabled === true,
    async inviteCode(credential) {
      if (!enabled) fail(503, "微信认证尚未启用。");
      if (!/^[a-f0-9]{64}$/.test(credential || "")) fail(400, "邀请凭据无效。");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const tokenUrl = new URL("https://api.weixin.qq.com/cgi-bin/token");
        tokenUrl.search = new URLSearchParams({ grant_type: "client_credential", appid: appId, secret: appSecret });
        const tokenResponse = await fetchImpl(tokenUrl, { signal: controller.signal, redirect: "error" });
        if (!tokenResponse.ok) fail(502, "微信小程序码服务暂时不可用。");
        const token = await tokenResponse.json();
        if (typeof token.access_token !== "string" || !token.access_token || token.access_token.length > 2048)
          fail(502, "微信小程序码服务暂时不可用。");
        const codeUrl = new URL("https://api.weixin.qq.com/wxa/getwxacode");
        codeUrl.searchParams.set("access_token", token.access_token);
        const response = await fetchImpl(codeUrl, { method: "POST", redirect: "error", signal: controller.signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: `pages/wechat-claim/index?credential=${credential}`, width: 430, env_version: codeEnvironment, check_path: false }) });
        if (!response.ok || !/^image\/(png|jpeg)/i.test(response.headers.get("content-type") || ""))
          fail(502, "生成小程序码失败，请检查微信平台配置及版本。");
        const reader = response.body?.getReader();
        if (!reader) fail(502, "微信小程序码响应无效。");
        const chunks = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1024 * 1024) { await reader.cancel(); fail(502, "微信小程序码响应无效。"); }
            chunks.push(Buffer.from(value));
          }
        } finally { reader.releaseLock(); }
        const buffer = Buffer.concat(chunks);
        if (!buffer.length) fail(502, "微信小程序码响应无效。");
        return `data:${response.headers.get("content-type").split(";")[0]};base64,${buffer.toString("base64")}`;
      } catch (error) {
        if (error instanceof WechatFoundationError) throw error;
        fail(502, "微信小程序码服务暂时不可用。");
      } finally { clearTimeout(timer); }
    },
    isVerifiedIdentity(value) {
      return !!value && identities.has(value);
    },
    async exchange(code) {
      if (enabled !== true) fail(503, "微信认证尚未启用。");
      if (
        typeof code !== "string" ||
        !code.trim() ||
        code.length > 512 ||
        /[\x00-\x20]/.test(code)
      )
        fail(400, "微信登录凭据不正确。");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
        url.search = new URLSearchParams({
          appid: appId,
          secret: appSecret,
          js_code: code,
          grant_type: "authorization_code",
        }).toString();
        const response = await fetchImpl(url, {
          signal: controller.signal,
          redirect: "error",
        });
        if (!response.ok) fail(502, "微信身份验证暂时不可用。");
        // 读取受限响应，错误和返回值绝不带 code、URL 或 session_key。
        const reader = response.body?.getReader();
        if (!reader) fail(502, "微信身份验证响应无效。");
        let size = 0;
        const chunks = [];
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 16384) {
              await reader.cancel();
              fail(502, "微信身份验证响应无效。");
            }
            chunks.push(Buffer.from(value));
          }
        } finally {
          reader.releaseLock();
        }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          !data ||
          typeof data !== "object" ||
          Array.isArray(data) ||
          (data.errcode !== undefined && data.errcode !== 0) ||
          typeof data.session_key !== "string" ||
          !data.session_key ||
          data.session_key.length > 256 ||
          typeof data.openid !== "string" ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(data.openid)
        )
          fail(401, "微信身份验证未通过，请重新登录。");
        const identity = Object.freeze({ appId, openid: data.openid });
        identities.add(identity);
        return identity;
      } catch (error) {
        if (error instanceof WechatFoundationError) throw error;
        fail(502, "微信身份验证暂时不可用，请稍后重试。");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
