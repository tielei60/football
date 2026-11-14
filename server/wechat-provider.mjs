// 独立基础模块；未接 HTTP。未启用时不会访问微信或接受测试身份。
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
  return {
    enabled: enabled === true,
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
