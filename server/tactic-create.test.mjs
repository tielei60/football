import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createFootballServer } from "./index.mjs";
const tactic = () => ({
  title: "匿名空白战术",
  tags: [],
  favorite: false,
  formationName: null,
  thumbnail: null,
  board: { pieces: [], markings: [], playerCount: 7 },
});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "football-create-test-")),
    databasePath = join(dir, "isolated.sqlite");
  let server, base;
  async function start() {
    server = createFootballServer({
      databasePath,
      bootstrapAdmin: { username: "owner", password: "fictional-password-123" },
      wechat: { enabled: false },
      aiPhotos: { enabled: false },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await server.drained;
  }
  await start();
  const db = new DatabaseSync(databasePath);
  t.after(async () => {
    db.close();
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  function call(path, method = "GET", body, token = owner) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = httpRequest(
        base + "/api" + path,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Football-Client": "native-v1",
            ...(payload
              ? { "Content-Length": Buffer.byteLength(payload) }
              : {}),
            ...(token ? { Authorization: "Bearer " + token } : {}),
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode,
                body: res.statusCode === 204 ? null : JSON.parse(raw),
                cache: res.headers["cache-control"],
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  }
  let owner;
  async function login(username) {
    const result = await call(
      "/auth/native-login",
      "POST",
      { username, password: "fictional-password-123" },
      null,
    );
    assert.equal(result.status, 200);
    assert.match(result.body.token, /^native_[a-f0-9]{64}$/);
    return result.body.token;
  }
  owner = await login("owner");
  db.exec(
    "INSERT INTO club_users(team_id,username,password_hash,role,password_enabled) SELECT 1,'other-admin',password_hash,'admin',1 FROM club_users WHERE username='owner'; INSERT INTO club_teams(id,name) VALUES (2,'匿名第二队'); INSERT INTO club_users(team_id,username,password_hash,role,password_enabled) SELECT 2,'foreign-admin',password_hash,'admin',1 FROM club_users WHERE username='owner'",
  );
  const player = (await call("/players", "POST", { name: "虚构测试队员" }))
    .body;
  await call(`/players/${player.id}/account`, "POST", {
    username: "member",
    password: "fictional-password-123",
  });
  return {
    call,
    db,
    login,
    owner,
    other: await login("other-admin"),
    foreign: await login("foreign-admin"),
    member: await login("member"),
    restart: async () => {
      await stop();
      await start();
    },
    counts: () => ({
      tactics: db.prepare("SELECT count(*) n FROM tactics").get().n,
      versions: db.prepare("SELECT count(*) n FROM tactic_versions").get().n,
      receipts: db
        .prepare("SELECT count(*) n FROM tactic_create_receipts")
        .get().n,
    }),
  };
}
test("管理员空库目录与新建回执，重复及对象键顺序不增加战术或版本", async (t) => {
  const f = await fixture(t),
    catalog = await f.call("/tactic-formations");
  assert.equal(catalog.status, 200);
  assert.equal(catalog.cache, "no-store");
  assert.deepEqual(
    [...new Set(catalog.body.formations.map((x) => x.playerCount))].sort(
      (a, b) => a - b,
    ),
    [5, 6, 7, 8, 9, 11],
  );
  for (const x of catalog.body.formations)
    assert.equal(x.spots.length, x.playerCount);
  const body = { requestId: "create-key-001", tactic: tactic(), note: "初始" };
  const a = await f.call("/tactics", "POST", body);
  assert.equal(a.status, 201);
  const reversed = Object.fromEntries(Object.entries(body.tactic).reverse());
  const b = await f.call("/tactics", "POST", { ...body, tactic: reversed });
  assert.equal(b.body.tacticId, a.body.tacticId);
  assert.deepEqual(f.counts(), { tactics: 1, versions: 1, receipts: 1 });
  assert.equal(a.body.requestId, undefined);
  assert.equal(a.body.board.requestId, undefined);
  const receipt = await f.call(
    "/tactic-create-receipts?requestId=create-key-001",
  );
  assert.deepEqual(receipt.body, {
    requestId: body.requestId,
    tacticId: a.body.tacticId,
    available: true,
  });
  assert.equal(receipt.cache, "no-store");
  assert.equal(
    (
      await f.call("/tactics", "POST", {
        ...body,
        tactic: { ...body.tactic, title: "不同内容" },
      })
    ).status,
    409,
  );
});
test("收据按账户和球队隔离，角色/未登录不能读取目录或创建", async (t) => {
  const f = await fixture(t),
    body = { requestId: "same-key-0001", tactic: tactic() };
  const first = await f.call("/tactics", "POST", body);
  assert.equal(
    (
      await f.call(
        "/tactic-create-receipts?requestId=same-key-0001",
        "GET",
        undefined,
        f.other,
      )
    ).status,
    404,
  );
  const second = await f.call("/tactics", "POST", body, f.other);
  assert.equal(second.status, 201);
  assert.notEqual(second.body.tacticId, first.body.tacticId);
  for (const token of [f.member, f.foreign, null])
    for (const [path, method, data] of [
      ["/tactic-formations", "GET"],
      ["/tactic-create-receipts?requestId=same-key-0001", "GET"],
      ["/tactics", "POST", body],
    ])
      assert.equal(
        (await f.call(path, method, data, token)).status,
        token || method === "POST" ? 403 : 401,
      );
});
test("原子事务：版本或回执写入失败全部回滚并可原请求重试", async (t) => {
  const f = await fixture(t);
  for (const table of ["tactic_versions", "tactic_create_receipts"]) {
    f.db.exec(
      `CREATE TRIGGER fail_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic-only-failure'); END;`,
    );
    assert.equal(
      (
        await f.call("/tactics", "POST", {
          requestId: "atomic-key-" + table,
          tactic: tactic(),
        })
      ).status,
      500,
    );
    assert.deepEqual(f.counts(), { tactics: 0, versions: 0, receipts: 0 });
    f.db.exec("DROP TRIGGER fail_insert");
  }
  assert.equal(
    (
      await f.call("/tactics", "POST", {
        requestId: "atomic-key-tactic_create_receipts",
        tactic: tactic(),
      })
    ).status,
    201,
  );
});
test("重启保留回执，删除只改变可用性，重放不复活也不新增", async (t) => {
  const f = await fixture(t),
    body = { requestId: "persist-key-001", tactic: tactic() };
  const saved = await f.call("/tactics", "POST", body);
  await f.restart();
  assert.equal(
    (await f.call("/tactic-create-receipts?requestId=persist-key-001")).body
      .available,
    true,
  );
  assert.equal(
    (await f.call("/tactics/" + saved.body.tacticId, "DELETE")).status,
    204,
  );
  assert.equal(
    (await f.call("/tactic-create-receipts?requestId=persist-key-001")).body
      .available,
    false,
  );
  assert.equal((await f.call("/tactics", "POST", body)).status, 410);
  assert.deepEqual(f.counts(), { tactics: 0, versions: 0, receipts: 1 });
});
test("有requestId不借preset去重，无requestId旧网页语义保留", async (t) => {
  const f = await fixture(t),
    preset = { ...tactic(), presetName: "synthetic-preset", presetEdition: 1 };
  const a = await f.call("/tactics", "POST", { tactic: preset });
  const b = await f.call("/tactics", "POST", { tactic: preset });
  assert.equal(a.body.tacticId, b.body.tacticId);
  const keyed = await f.call("/tactics", "POST", {
    requestId: "preset-key-001",
    tactic: preset,
  });
  assert.equal(keyed.status, 201);
  assert.notEqual(keyed.body.tacticId, a.body.tacticId);
  assert.equal(
    (await f.call("/tactic-create-receipts?requestId=preset-key-001")).body
      .tacticId,
    keyed.body.tacticId,
  );
  assert.deepEqual(f.counts(), { tactics: 2, versions: 2, receipts: 1 });
});
test("请求编号/查询白名单严格校验，不接受客户端身份", async (t) => {
  const f = await fixture(t);
  for (const requestId of [null, "", "short", "x".repeat(129), "bad\nkey1"])
    assert.equal(
      (await f.call("/tactics", "POST", { requestId, tactic: tactic() }))
        .status,
      400,
    );
  for (const query of [
    "",
    "?requestId=short",
    "?requestId=valid-key1&requestId=valid-key1",
    "?requestId=valid-key1&userId=1",
  ])
    assert.equal((await f.call("/tactic-create-receipts" + query)).status, 400);
  assert.equal(
    (
      await f.call("/tactics", "POST", {
        requestId: "valid-key1",
        tactic: tactic(),
        userId: 1,
      })
    ).status,
    400,
  );
  assert.deepEqual(f.counts(), { tactics: 0, versions: 0, receipts: 0 });
});
