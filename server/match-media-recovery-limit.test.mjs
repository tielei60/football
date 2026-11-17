import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createFootballServer } from "./index.mjs";

const credentials = { username: "owner", password: "owner-password-123" };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "football-media-"));
  const databasePath = join(directory, "test.sqlite");
  const server = createFootballServer({
    databasePath,
    bootstrapAdmin: credentials,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  // Model native wx.request, not browser fetch (Node fetch also adds Sec-Fetch-Mode).
  function call(path, { method = "GET", body, token, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        base + path,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(body !== undefined
              ? { "Content-Length": Buffer.byteLength(JSON.stringify(body)) }
              : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...headers,
          },
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: data ? JSON.parse(data) : null,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }
  const login = (body = credentials) =>
    call("/api/auth/native-login", {
      method: "POST",
      body,
      headers: { "X-Football-Client": "native-v1" },
    });
  return { call, login, databasePath, base };
}

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0i8AAAAASUVORK5CYII=";
async function matchFixture(t) {
  const f = await fixture(t);
  const token = (await f.login()).body.token;
  const match = (
    await f.call("/api/matches", {
      token,
      method: "POST",
      body: { opponent: "图集演练", date: "2026-12-20", notice: "请提前到场" },
    })
  ).body;
  return { ...f, token, match, path: `/api/matches/${match.id}/photos` };
}
// 已提交响应丢失：丢弃第一次成功返回，只用原请求恢复收据。
test("第九张已提交后原requestId重试不新增照片或revision", async (t) => {
  const f = await matchFixture(t);
  let revision=f.match.revision;
  for(let i=0;i<8;i++) {
    const r=await f.call(f.path,{token:f.token,method:"POST",body:{revision,requestId:`limit-seed-photo-${i}`,dataUrl:png}});
    assert.equal(r.status,201); revision=r.body.revision;
  }
  const body={revision,requestId:"lost-response-ninth-photo",dataUrl:png,caption:"第九张"};
  assert.equal((await f.call(f.path,{token:f.token,method:"POST",body})).status,201);
  const db=new DatabaseSync(f.databasePath,{readOnly:true});t.after(()=>db.close());
  const before=db.prepare("SELECT id,revision,cover_photo_id FROM club_matches WHERE id=?").get(f.match.id);
  const rows=db.prepare("SELECT id,request_id,content_hash,sort_order FROM club_match_photos WHERE match_id=? ORDER BY id").all(f.match.id);
  assert.equal(rows.length,9);assert.equal(before.revision,revision+1);
  const retry=await f.call(f.path,{token:f.token,method:"POST",body});
  assert.equal(retry.status,201);assert.equal(retry.body.revision,before.revision);
  assert.equal(retry.body.photo.id,rows.find(x=>x.request_id===body.requestId).id);
  assert.deepEqual(db.prepare("SELECT id,revision,cover_photo_id FROM club_matches WHERE id=?").get(f.match.id),before);
  assert.deepEqual(db.prepare("SELECT id,request_id,content_hash,sort_order FROM club_match_photos WHERE match_id=? ORDER BY id").all(f.match.id),rows);
  const tenth=await f.call(f.path,{token:f.token,method:"POST",body:{...body,revision:before.revision,requestId:"genuine-tenth-new-photo"}});
  assert.equal(tenth.status,400);
  assert.deepEqual(db.prepare("SELECT id,revision,cover_photo_id FROM club_matches WHERE id=?").get(f.match.id),before);
  assert.equal(db.prepare("SELECT count(*) n FROM club_match_photos WHERE match_id=?").get(f.match.id).n,9);
});
