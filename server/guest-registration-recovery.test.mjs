import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createFootballServer } from "./index.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));

const sharp = createRequire(join(root, "app/package.json"))("sharp");
const apiSource = await readFile(join(root, "miniprogram/utils/match-guest-api.js"), "utf8");
const pageSource = await readFile(join(root, "miniprogram/pages/match-guest/index.js"), "utf8");

const outcomes = ["lost", "dropped", "late-after-return", "late-before-return"];
const cases = ["resume", "recreate"].flatMap((reopening) => outcomes.map((outcome) => [reopening, outcome]));
for (const [reopening, outcome] of cases) {
  const committed = outcome !== "dropped",
    late = outcome.startsWith("late");
  test(
    "Guest registration: " + outcome + " and " + reopening + " with a fresh WeChat sign-in",
    { timeout: 15000 },
    async (t) => {
      const dir = await mkdtemp(join(tmpdir(), "football-guest-lost-response-")),
        path = join(dir, "synthetic.sqlite");
      const creds = {
        username: "fictional-lost-response-admin",
        password: "fictional-fixture-password-only",
      };
      const exchanged = [],
        available = ["synthetic-code-first", "synthetic-code-fresh"];
      const server = createFootballServer({
        databasePath: path,
        bootstrapAdmin: creds,
        wechat: {
          enabled: true,
          appId: "wx0123456789abcdef",
          appSecret: "fictional-not-real",
          fetchImpl: async (url) => {
            const u = new URL(url);
            assert.equal(u.hostname, "api.weixin.qq.com");
            assert.equal(u.pathname, "/sns/jscode2session");
            const code = u.searchParams.get("js_code");
            assert.ok(available.includes(code));
            assert.ok(!exchanged.includes(code));
            exchanged.push(code);
            return Response.json({
              openid: "single-fictional-lost-response-identity",
              session_key: "fictional-only",
            });
          },
        },
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const base = "http://127.0.0.1:" + server.address().port;
      const db = new DatabaseSync(path, { readOnly: true });
      t.after(async () => {
        db.close();
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
        await rm(dir, { recursive: true, force: true });
      });
      const routes = [];
      const call = (path, method = "GET", body, token) =>
        new Promise((resolve, reject) => {
          assert.ok(path.startsWith("/"));
          routes.push([method, path]);
          const req = httpRequest(
            base + "/api" + path,
            {
              method,
              headers: {
                "Content-Type": "application/json",
                "X-Football-Client": "native-v1",
                ...(token ? { Authorization: "Bearer " + token } : {}),
              },
            },
            (res) => {
              let raw = "";
              res.setEncoding("utf8");
              res.on("data", (c) => (raw += c));
              res.on("end", () => {
                try {
                  resolve({ status: res.statusCode, data: raw ? JSON.parse(raw) : null });
                } catch (e) {
                  reject(e);
                }
              });
              res.on("error", reject);
            }
          );
          req.on("error", reject);
          req.end(body === undefined ? undefined : JSON.stringify(body));
        });
      const admin = await call("/auth/native-login", "POST", creds);
      assert.equal(admin.status, 200);
      const m = await call(
        "/matches",
        "POST",
        {
          opponent: "Fictional opponent",
          date: "2099-12-20",
          kickoff: "19:00",
          status: "published",
        },
        admin.data.token
      );
      assert.equal(m.status, 201);
      const share = m.data.shareToken;
      const bytes = await sharp({
        create: { width: 20, height: 20, channels: 3, background: "#8844aa" },
      })
        .png()
        .toBuffer();
      const png = bytes.toString("base64");
      let intercepted,
        firstHttp,
        releaseResponse,
        signalSettled,
        failCallbacks = 0,
        loginCalls = 0;
      const interrupted = new Promise((r) => (signalSettled = r));
      const holdLogout = outcome === "late-after-return";
      let signalLogout, finishLogout;
      const logoutStarted = new Promise((resolve) => (signalLogout = resolve));
      const entryResults = [],
        registerResults = [];
      const wx = {
        login: (o) => {
          const code = available[loginCalls++];
          assert.ok(code);
          o.success({ code });
        },
        navigateTo() {
          assert.fail("member route must not be opened");
        },
        getFileSystemManager: () => ({
          getFileInfo: (o) => o.success({ size: bytes.length }),
          readFile: (o) => o.success({ data: png }),
        }),
        request(o) {
          const url = new URL(o.url);
          assert.equal(url.origin, base);
          assert.equal(url.search, "");
          assert.ok(url.pathname.startsWith("/api/"));
          const route = url.pathname.slice(4),
            token = o.header.Authorization?.replace(/^Bearer /, "");
          (async () => {
            if (route === "/auth/wechat/match-register" && !intercepted) {
              intercepted = true;
              if (committed) {
                firstHttp = await call(route, o.method, o.data, token);
                assert.equal(firstHttp.status, 200);
              }
              releaseResponse = () => {
                if (late)
                  o.success({
                    statusCode: firstHttp.status,
                    data: firstHttp.data,
                  });
                else {
                  failCallbacks++;
                  o.fail({ errMsg: "request:fail interrupted after hide" });
                }
              };
              signalSettled();
              return;
            }
            if (route === "/auth/logout" && holdLogout) {
              await new Promise((resolve) => {
                finishLogout = resolve;
                signalLogout();
              });
            }
            const result = await call(route, o.method, o.data, token);
            if (route === "/auth/wechat/match-entry") entryResults.push(result);
            if (route === "/auth/wechat/match-register") registerResults.push(result);
            o.success({ statusCode: result.status, data: result.data });
          })().catch((e) => {
            o.fail?.(e);
            t.diagnostic("unexpected test harness error: " + e.message);
          });
        },
      };
      const mod = { exports: {} };
      vm.runInNewContext(apiSource, {
        module: mod,
        require: () => ({ apiBaseUrl: base, allowLocalHttp: true }),
        wx,
        Date,
        Promise,
        Error,
      });
      const guest = mod.exports;
      const construct = () => {
        let definition;
        const shared = {
          api: { getSession: () => null },
          dateLabel: (x) => x,
          assetUrl: (x) => x,
          replies: { yes: "参加", no: "请假", maybe: "待定" },
        };
        vm.runInNewContext(pageSource, {
          Page: (x) => (definition = x),
          require: (p) => (p.includes("match-guest-api") ? guest : shared),
          Date,
          Math,
          Number,
          String,
          encodeURIComponent,
          wx,
        });
        const page = {
          ...definition,
          data: structuredClone(definition.data),
          setData(patch) {
            Object.assign(this.data, patch);
          },
        };
        page.onLoad({ shareToken: share });
        return { guest, page };
      };
      const registrationPath = "/auth/wechat/match-register",
        entryPath = "/auth/wechat/match-entry";
      const registrations = () =>
        routes.filter(([method, path]) => method === "POST" && path === registrationPath).length;
      const snapshot = () =>
        Object.fromEntries(
          ["club_players", "club_users", "club_wechat_identities", "club_rsvps", "club_guest_match_access"].map(
            (table) => [table, db.prepare("SELECT * FROM " + table + " ORDER BY 1").all()]
          )
        );
      const counts = (rows) => Object.fromEntries(Object.entries(rows).map(([t, values]) => [t, values.length]));
      const empty = {
        club_players: 0,
        club_users: 1,
        club_wechat_identities: 0,
        club_rsvps: 0,
        club_guest_match_access: 0,
      };
      const one = {
        club_players: 1,
        club_users: 2,
        club_wechat_identities: 1,
        club_rsvps: 1,
        club_guest_match_access: 1,
      };
      const old = construct();
      assert.equal(old.guest.session(share), null);
      await old.page.onShow();
      await old.page.login();
      assert.equal(entryResults.length, 1);
      assert.equal(entryResults[0].status, 200);
      assert.equal(old.page.data.profileRequired, true);
      const registerForm = async (page) => {
        page.realName({ detail: { value: "虚构断线验收人" } });
        page.nickname({ detail: { value: "虚构昵称" } });
        await page.chooseAvatar({
          detail: { avatarUrl: "wxfile://tmp/synthetic.png" },
        });
        return page.register();
      };
      const first = registerForm(old.page);
      await interrupted;
      const atBreak = snapshot();
      assert.deepEqual(counts(atBreak), committed ? one : empty);
      assert.equal(registrations(), committed ? 1 : 0);
      assert.equal(old.page.data.busy, true);
      assert.equal(old.guest.session(share), null);
      if (reopening === "recreate") old.page.onUnload();
      else old.page.onHide();
      const current = reopening === "resume" ? old : construct();
      const { page } = current;
      let showing;
      if (outcome === "late-after-return") {
        showing = page.onShow();
        await page.register();
        assert.equal(registrations(), 1, "must not replay the old signup while the first response is in flight");
        assert.equal(loginCalls, 1);
      }
      releaseResponse();
      if (holdLogout) {
        await logoutStarted;
        // The explicitly retriggered login cannot race past the abandoned request's cleanup.
        const premature = page.login();
        await new Promise((resolve) => setImmediate(resolve));
        const loginsBeforeCleanup = loginCalls;
        finishLogout();
        assert.equal(loginsBeforeCleanup, 1);
        await premature;
      }
      await first;
      assert.equal(failCallbacks, late ? 0 : 1);
      assert.equal(old.page.data.authenticated, false);
      assert.equal(guest.session(share), null);
      assert.deepEqual(snapshot(), atBreak);
      await (showing || page.onShow());
      assert.equal(page.data.authenticated, false);
      assert.equal(page.data.response, "");
      assert.equal(guest.session(share), null);
      assert.equal(page.data.error, "");
      if (late) {
        assert.equal(page.data.profileRequired, false, "interrupted view cannot show the stale form again");
        await page.register();
        assert.equal(registrations(), 1);
      }
      if (reopening === "resume") await page.restartLogin();
      else await page.login();
      assert.equal(entryResults.length, 2);
      assert.equal(entryResults[1].status, 200);
      assert.deepEqual(exchanged, available);
      assert.equal(loginCalls, 2);
      assert.equal(page.data.profileRequired, !committed);
      assert.deepEqual(snapshot(), atBreak);
      if (committed) {
        assert.equal(entryResults[1].data.needsProfile, false);
        assert.equal(entryResults[1].data.user.playerId, firstHttp.data.user.playerId);
        assert.equal(entryResults[1].data.user.id, firstHttp.data.user.id);
        assert.notEqual(entryResults[1].data.token, firstHttp.data.token);
        assert.equal(registrations(), 1);
      } else {
        assert.equal(entryResults[1].data.needsProfile, true);
        assert.notEqual(entryResults[1].data.registrationToken, entryResults[0].data.registrationToken);
        assert.equal(page.data.authenticated, false);
        assert.equal(guest.session(share), null);
        assert.equal(registrations(), 0);
        await registerForm(page);
        assert.equal(registerResults.length, 1);
        assert.equal(registerResults[0].status, 200);
      }
      assert.equal(page.data.authenticated, true);
      assert.equal(page.data.profileRequired, false);
      assert.equal(page.data.response, "yes");
      assert.equal(page.data.responseLabel, "参加");
      assert.equal(page.data.actionError, "");
      const self = await call("/guest-matches/" + share, "GET", undefined, guest.session(share).token);
      assert.equal(self.status, 200);
      assert.equal(self.data.myResponse, "yes");
      const final = snapshot();
      assert.deepEqual(counts(final), one);
      if (committed) assert.deepEqual(final, atBreak);
      assert.equal(registrations(), 1);
      assert.equal(routes.filter(([method, path]) => method === "POST" && path === entryPath).length, 2);
      assert.equal(routes.filter(([, path]) => path === "/auth/logout").length, late ? 1 : 0);
      if (late)
        assert.equal((await call("/guest-matches/" + share, "GET", undefined, firstHttp.data.token)).status, 401);
      assert.equal(final.club_rsvps[0].player_id, final.club_players[0].id);
      assert.equal(
        final.club_wechat_identities[0].user_id,
        final.club_users.find((u) => u.player_id === final.club_players[0].id).id
      );
      assert.equal(final.club_guest_match_access[0].match_id, m.data.id);
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    }
  );
}
