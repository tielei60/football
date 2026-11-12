import test from "node:test";
import assert from "node:assert/strict";
import {
  constants,
  copyFileSync,
  renameSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  quoteDemoDirectory,
  parseDemoArguments,
  readDemoManifest,
  startDemo,
} from "../scripts/start-demo.mjs";

async function stop(server) {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "football-demo-launcher-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, "index.html"),
    "<html>local fictional rehearsal</html>",
  );
  return directory;
}

async function login(running) {
  const response = await fetch(`${running.url}/api/auth/login`, {
    method: "POST",
    headers: { Origin: running.url, "Content-Type": "application/json" },
    body: JSON.stringify(running.manifest.credentials[0]),
  });
  assert.equal(response.status, 200);
  return {
    Cookie: response.headers.get("set-cookie").split(";")[0],
    Origin: running.url,
    "Content-Type": "application/json",
  };
}

test("demo launcher creates independent databases, serves UI/API on loopback and safely resumes changes", async (t) => {
  const staticDirectory = fixture(t);
  const sentinel = join(staticDirectory, "production.sqlite");
  writeFileSync(sentinel, "existing production sentinel must not be opened");
  const overrides = {
    FOOTBALL_DB_PATH: sentinel,
    HOST: "0.0.0.0",
    PORT: "1",
    FOOTBALL_PUBLIC_ORIGIN: "https://production.invalid",
    FOOTBALL_TRUSTED_PROXY_ADDRESSES: "not-an-ip",
    FOOTBALL_COOKIE_SECURE: "true",
    FOOTBALL_ADMIN_USERNAME: "must-not-be-created",
    FOOTBALL_ADMIN_PASSWORD: "not-a-real-secret-test-only",
  };
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, overrides);
  const running = [];
  t.after(async () => {
    for (const item of running) await stop(item.server);
    for (const directory of new Set(
      running.map((item) => item.manifest.directory),
    ))
      rmSync(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const first = await startDemo({ staticDirectory });
  running.push(first);
  assert.equal(first.server.address().address, "127.0.0.1");
  assert.notEqual(first.server.address().port, 1);
  assert.notEqual(first.manifest.databasePath, sentinel);
  assert.match(
    await (await fetch(first.url)).text(),
    /local fictional rehearsal/,
  );
  const headers = await login(first);
  let team = await (await fetch(`${first.url}/api/team`, { headers })).json();
  assert.equal(team.name, "青岚周末足球俱乐部（演练）");
  const saved = await fetch(`${first.url}/api/team`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ...team, name: "继续演练保留修改（虚构）" }),
  });
  assert.equal(saved.status, 200);
  const manifestBefore = readFileSync(
    join(first.manifest.directory, "demo-manifest.json"),
  );
  await stop(first.server);
  const resumed = await startDemo({
    staticDirectory,
    resumeDirectory: first.manifest.directory,
  });
  running.push(resumed);
  team = await (
    await fetch(`${resumed.url}/api/team`, { headers: await login(resumed) })
  ).json();
  assert.equal(team.name, "继续演练保留修改（虚构）");
  assert.equal(
    isDeepStrictEqual(
      readFileSync(join(first.manifest.directory, "demo-manifest.json")),
      manifestBefore,
    ),
    true,
  );
  const second = await startDemo({ staticDirectory });
  running.push(second);
  assert.notEqual(second.manifest.databasePath, first.manifest.databasePath);
  assert.equal(
    isDeepStrictEqual(second.manifest.credentials, first.manifest.credentials),
    false,
  );
  assert.equal(
    readFileSync(sentinel, "utf8"),
    "existing production sentinel must not be opened",
  );
});

test("demo resume rejects arbitrary directories, tampered paths and symlink database without opening them", async (t) => {
  const staticDirectory = fixture(t);
  assert.throws(() => readDemoManifest(staticDirectory));
  await assert.rejects(
    startDemo({ staticDirectory, resumeDirectory: staticDirectory }),
  );
  const demo = await startDemo({ staticDirectory });
  await stop(demo.server);
  t.after(() =>
    rmSync(demo.manifest.directory, { recursive: true, force: true }),
  );
  const sentinel = join(staticDirectory, "production.sqlite");
  writeFileSync(sentinel, "untouched");
  const manifestPath = join(demo.manifest.directory, "demo-manifest.json");
  writeFileSync(
    manifestPath,
    JSON.stringify({ ...demo.manifest, databasePath: sentinel }),
  );
  assert.throws(() => readDemoManifest(demo.manifest.directory), /不匹配/);
  writeFileSync(manifestPath, JSON.stringify(demo.manifest));
  writeFileSync(
    join(demo.manifest.directory, ".football-demo-owned"),
    "not a demo\n",
  );
  assert.throws(() => readDemoManifest(demo.manifest.directory), /标记/);
  writeFileSync(
    join(demo.manifest.directory, ".football-demo-owned"),
    "Fictional adult football rehearsal only\n",
  );
  rmSync(demo.manifest.databasePath);
  symlinkSync(sentinel, demo.manifest.databasePath);
  assert.throws(() => readDemoManifest(demo.manifest.directory), /普通文件/);
  assert.equal(readFileSync(sentinel, "utf8"), "untouched");
});

test("demo entry point rejects unsupported arguments and fails clearly before seeding if frontend is absent", async (t) => {
  assert.deepEqual(parseDemoArguments([]), {});
  assert.deepEqual(parseDemoArguments(["--resume", "/fictional/demo"]), {
    resumeDirectory: "/fictional/demo",
  });
  for (const args of [
    ["production.sqlite"],
    ["--database", "production.sqlite"],
    ["--resume"],
    ["--resume", "x", "extra"],
    ["--host", "0.0.0.0"],
  ])
    assert.throws(() => parseDemoArguments(args), /只支持/);
  const directory = fixture(t);
  await assert.rejects(
    startDemo({ staticDirectory: join(directory, "not-built") }),
    /npm run build/,
  );
});

test("resume command quotes special characters without shell expansion", () => {
  assert.equal(quoteDemoDirectory("/tmp/a$b`x`", "linux"), "'/tmp/a$b`x`'");
  assert.equal(quoteDemoDirectory("/tmp/a'b", "linux"), "'/tmp/a'\"'\"'b'");
  assert.equal(quoteDemoDirectory("C:\\tmp\\a'b", "win32"), "'C:\\tmp\\a''b'");
});

test("documented backup-to-fresh-demo restore retains original credentials and isolates subsequent changes", async (t) => {
  const staticDirectory = fixture(t);
  const running = [];
  t.after(async () => {
    for (const item of running) await stop(item.server);
    for (const directory of new Set(
      running.map((item) => item.manifest.directory),
    ))
      rmSync(directory, { recursive: true, force: true });
  });
  const original = await startDemo({ staticDirectory });
  running.push(original);
  const originalHeaders = await login(original);
  const originalTeam = await (
    await fetch(`${original.url}/api/team`, { headers: originalHeaders })
  ).json();
  const backup = join(staticDirectory, "new-demo-backup.sqlite");
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/backup.mjs", import.meta.url)), backup],
    {
      env: { ...process.env, FOOTBALL_DB_PATH: original.manifest.databasePath },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, "formal backup tool must succeed");
  const target = await startDemo({ staticDirectory });
  running.push(target);
  await stop(target.server);
  renameSync(
    target.manifest.databasePath,
    join(target.manifest.directory, "demo-before-restore.sqlite"),
  );
  copyFileSync(backup, target.manifest.databasePath, constants.COPYFILE_EXCL);
  const restored = await startDemo({
    staticDirectory,
    resumeDirectory: target.manifest.directory,
  });
  running.push(restored);
  // Restored auth data belongs to the source, not the target's now-stale manifest.
  const headers = await login({ ...restored, manifest: original.manifest });
  const restoredTeam = await (
    await fetch(`${restored.url}/api/team`, { headers })
  ).json();
  assert.deepEqual(restoredTeam, originalTeam);
  const snapshots = await (
    await fetch(
      `${restored.url}/api/matches/${original.manifest.matches.away}`,
      { headers },
    )
  ).json();
  assert.equal(snapshots.tacticSnapshots.length, 1);
  assert.equal(
    snapshots.tacticSnapshots[0].tactic.board.demonstration.stages.length,
    2,
  );
  assert.equal(
    (
      await fetch(`${restored.url}/api/team`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          ...restoredTeam,
          name: "恢复副本独立修改（虚构）",
        }),
      })
    ).status,
    200,
  );
  const unchanged = await (
    await fetch(`${original.url}/api/team`, { headers: originalHeaders })
  ).json();
  assert.deepEqual(unchanged, originalTeam);
});
