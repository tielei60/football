import { test, expect } from "@playwright/test";
const identity = (forced = false, systemAdmin = true) => ({
  user: {
    id: 901,
    username: "review-owner",
    role: "admin",
    playerId: null,
    teamId: 1,
    systemAdmin,
    mustChangePassword: forced,
  },
  team: { id: 1, name: "测试球队", crest: null, revision: 1 },
});
const rows = [
  { id: 901, username: "review-owner", role: "admin", playerId: null, systemAdmin: true, enabled: true, revision: 3 },
  {
    id: 902,
    username: "review-member",
    role: "player",
    playerId: "anonymous-player",
    systemAdmin: false,
    enabled: true,
    revision: 4,
  },
];
test("首次改密拦截直接业务地址，校验确认并清除会话", async ({ page }) => {
  let loggedIn = true;
  let changed = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me")
      return route.fulfill({ status: loggedIn ? 200 : 401, json: loggedIn ? identity(true) : { message: "请登录" } });
    if (path === "/api/auth/password") {
      changed++;
      loggedIn = false;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/club/system-accounts");
  await expect(page).toHaveURL(/change-password$/);
  await page.getByLabel("当前密码", { exact: true }).fill("anonymous-old-pass");
  await page.getByLabel("新密码", { exact: true }).fill("anonymous-new-pass");
  await page.getByLabel("确认新密码").fill("different-new-pass");
  await page.getByRole("button", { name: "更新并重新登录" }).click();
  await expect(page.getByRole("alert")).toHaveText("两次新密码不一致");
  expect(changed).toBe(0);
  await page.getByLabel("确认新密码").fill("anonymous-new-pass");
  await page.getByRole("button", { name: "更新并重新登录" }).click();
  await expect(page).toHaveURL(/login$/);
  expect(changed).toBe(1);
});
test("系统账号操作取消不写入，确认携带revision，系统账号只读", async ({ page }) => {
  let writes: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    if (route.request().url().endsWith("/auth/me")) return route.fulfill({ json: identity() });
    if (route.request().method() === "PUT") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { ...rows[1], role: "admin", revision: 5 } });
    }
    return route.fulfill({ json: rows });
  });
  await page.goto("/club/system-accounts");
  await expect(page.locator("li").filter({ hasText: "review-owner" }).getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "设为管理员", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "设为管理员", exact: true }).click();
  await page.getByRole("button", { name: "确认修改", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ revision: 4, role: "admin" });
});
test("创建响应未知时禁用重试，刷新仅核对用户名", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/**", async (route) => {
    if (route.request().url().endsWith("/auth/me")) return route.fulfill({ json: identity() });
    if (route.request().method() === "POST") {
      posts++;
      return route.abort();
    }
    return route.fulfill({ json: rows });
  });
  await page.goto("/club/system-accounts");
  await page.getByLabel("用户名", { exact: true }).fill("review-member");
  await page.getByLabel("临时密码").fill("anonymous-new-pass");
  await page.getByRole("button", { name: "创建管理员", exact: true }).click();
  await expect(page.getByRole("button", { name: "创建管理员", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "核对创建结果" }).click();
  await expect(page.getByRole("status").filter({ hasText: "无法确认上次创建使用的密码" })).toBeVisible();
  expect(posts).toBe(1);
  await expect(page.getByLabel("临时密码")).toHaveValue("");
});
test("普通管理员直接访问系统账号页被阻止", async ({ page }) => {
  let accountReads = 0;
  await page.route("**/api/**", async (route) => {
    if (route.request().url().endsWith("/auth/me")) return route.fulfill({ json: identity(false, false) });
    if (route.request().url().includes("/system/accounts")) accountReads++;
    return route.fulfill({ json: [] });
  });
  await page.goto("/club/system-accounts");
  await expect(page).toHaveURL(/club$/);
  expect(accountReads).toBe(0);
  await expect(page.getByRole("link", { name: "账号权限" })).toHaveCount(0);
});
test("旧会话迟到401不跳转新身份", async ({ page }) => {
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: identity() }));
  await page.route("**/api/stale-auth-check", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    await route.fulfill({ status: 401, json: { message: "旧会话失效" } });
  });
  await page.goto("/about");
  const status = await page.evaluate(async () => {
    const modulePath = "/src/services/clubApi.ts";
    const api = await import(/* @vite-ignore */ modulePath);
    const result = api.clubApi("/stale-auth-check").catch((error: { status: number }) => error.status);
    api.advanceAuthEpoch();
    return result;
  });
  expect(status).toBe(401);
  await expect(page).toHaveURL(/about$/);
});
test("改密页离开后迟到成功不抢占新页面导航", async ({ page }) => {
  let finish: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/auth/me", (route) => route.fulfill({ json: identity(true) }));
  await page.route("**/api/auth/password", async (route) => {
    await pending;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/change-password");
  await page.getByLabel("当前密码", { exact: true }).fill("anonymous-old-pass");
  await page.getByLabel("新密码", { exact: true }).fill("anonymous-new-pass");
  await page.getByLabel("确认新密码").fill("anonymous-new-pass");
  await page.getByRole("button", { name: "更新并重新登录" }).click();
  await page.evaluate(async () => {
    const storePath = "/src/stores/authStore.ts";
    const routerPath = "/src/router.ts";
    const { useAuthStore } = await import(/* @vite-ignore */ storePath);
    // 模拟生命周期变化，不触碰真实账号。
    useAuthStore().session.user.mustChangePassword = false;
    const { default: router } = await import(/* @vite-ignore */ routerPath);
    await router.push("/about");
  });
  finish!();
  await expect(page).toHaveURL(/about$/);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/about$/);
});
test("真实隔离API：系统管理员改密登录、创建管理员及权限拒绝", async ({ page }) => {
  const { DatabaseSync } = await import("node:sqlite");
  const { testDatabaseDirectory } = await import("./test-database.mjs");
  const { initializeLocalSystemAdmin } = await import("../../scripts/setup-local-system-admin.mjs");
  const databasePath = process.env.FOOTBALL_E2E_DB_PATH!;
  testDatabaseDirectory(databasePath);
  const database = new DatabaseSync(databasePath);
  try {
    initializeLocalSystemAdmin(database, { username: "browser-system-example", initialPassword: "trial-example" });
  } finally {
    database.close();
  }
  await page.goto("/login");
  await page.getByLabel("用户名").fill("browser-system-example");
  await page.getByLabel("密码", { exact: true }).fill("trial-example");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/change-password$/);
  const before = await page.request.get("/api/system/accounts");
  expect(before.status()).toBe(403);
  expect((await before.json()).code).toBe("PASSWORD_CHANGE_REQUIRED");
  await page.getByLabel("当前密码", { exact: true }).fill("trial-example");
  await page.getByLabel("新密码", { exact: true }).fill("browser-owner-password-2026");
  await page.getByLabel("确认新密码").fill("browser-owner-password-2026");
  await page.getByRole("button", { name: "更新并重新登录" }).click();
  await expect(page).toHaveURL(/login$/);
  await page.getByLabel("用户名").fill("browser-system-example");
  await page.getByLabel("密码", { exact: true }).fill("browser-owner-password-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("link", { name: "账号权限" }).click();
  await page.getByLabel("用户名", { exact: true }).fill("browser-managed-example");
  await page.getByLabel("临时密码").fill("browser-member-password-2026");
  await page.getByRole("button", { name: "创建管理员", exact: true }).click();
  await expect(page.locator("li").filter({ hasText: "browser-managed-example" })).toBeVisible();
  await page.getByRole("link", { name: "账号", exact: true }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/login$/);
  await page.getByLabel("用户名").fill("browser-managed-example");
  await page.getByLabel("密码", { exact: true }).fill("browser-member-password-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/change-password$/);
  await page.getByLabel("当前密码", { exact: true }).fill("browser-member-password-2026");
  await page.getByLabel("新密码", { exact: true }).fill("browser-member-renewed-2026");
  await page.getByLabel("确认新密码").fill("browser-member-renewed-2026");
  await page.getByRole("button", { name: "更新并重新登录" }).click();
  await expect(page).toHaveURL(/login$/);
  await page.getByLabel("用户名").fill("browser-managed-example");
  await page.getByLabel("密码", { exact: true }).fill("browser-member-renewed-2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/club$/);
  expect((await page.request.get("/api/system/accounts")).status()).toBe(403);
  await page.goto("/club/system-accounts");
  await expect(page).toHaveURL(/club$/);
  await expect(page.getByRole("link", { name: "账号权限" })).toHaveCount(0);
});
