/** Independent real-store + HTTP/SQLite tactical audit, NOT a browser/UI pass.
 * Run node scripts/audit-tactics-model.mjs. Uses fictional adult profiles, an owned
 * temporary database and a loopback server. Does not use a default/demo database.
 * The real frontend stores are bundled without edits. Only viewport/localStorage
 * and animation scheduling platform adapters are supplied. Normal flows use real HTTP;
 * one explicitly marked version-list 503 is fault-injected after a real response.
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import { isDeepStrictEqual } from "node:util";
import { createFootballServer } from "../server/index.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "app/package.json"));
const { build } = require("esbuild");
const dir = mkdtempSync(join(tmpdir(), "football-tactics-independent-"));
const databasePath = join(dir, "fictional.sqlite");
const credential = {
  username: "fictional-audit-admin",
  password: randomUUID(),
};
const nativeFetch = globalThis.fetch;
let server,
  origin,
  cookie,
  assertions = 0;
const failures = [],
  coverage = [];
let blockedPath, releaseBlocked, startedBlocked, failingVersionPath;
let injectedFailures = 0;
const sourceFiles = [
  "app/src/stores/drawStore.ts",
  "app/src/stores/historyStore.ts",
  "app/src/composables/useHistory.ts",
  "app/src/stores/tacticsStore.ts",
  "app/src/composables/useFormation.ts",
];
const hashes = () =>
  Object.fromEntries(
    sourceFiles.map((f) => [
      f,
      createHash("sha256")
        .update(readFileSync(join(root, f)))
        .digest("hex"),
    ]),
  );
const sourceHashes = hashes();
const equal = (a, b, label) => {
  assertions++;
  if (!isDeepStrictEqual(a, b)) throw new Error(label);
};
const check = async (name, fn) => {
  try {
    await fn();
    coverage.push(name);
    console.log(`PASS ${name}`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`FAIL ${name}: ${e.message}`);
  }
};
async function start() {
  server = createFootballServer({
    databasePath,
    bootstrapAdmin: credential,
    publicOrigin: null,
    secureCookies: false,
    trustedProxyAddresses: [],
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
}
async function stop() {
  if (server?.listening) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
async function api(path, method = "GET", body) {
  const r = await nativeFetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${path} HTTP ${r.status}`);
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  return r.status === 204 ? null : r.json();
}
try {
  await start();
  await api("/api/auth/login", "POST", credential);
  const profiles = [];
  for (let i = 0; i < 20; i++)
    profiles.push(
      await api("/api/players", "POST", {
        name: `独立虚构成年队员${i + 1}`,
        number: i + 1,
        positions: [
          i === 0
            ? "门将"
            : i % 3 === 0
              ? "前锋"
              : i % 3 === 1
                ? "后卫"
                : "中场",
        ],
      }),
    );
  // Normal responses are real. Delay one response for ordering, or inject the
  // explicitly selected 503 to exercise failed-read atomicity without changing data.
  globalThis.fetch = async (path, options = {}) => {
    const actual = String(path);
    const response = await nativeFetch(
      actual.startsWith("/") ? origin + actual : actual,
      {
        ...options,
        headers: { ...options.headers, Origin: origin, Cookie: cookie },
      },
    );
    if (actual === failingVersionPath && (options.method ?? "GET") === "GET") {
      failingVersionPath = null;
      injectedFailures++;
      await response.arrayBuffer();
      return new Response(
        JSON.stringify({ message: "独立验收注入：目标版本列表暂不可用" }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    if (actual === blockedPath) {
      blockedPath = null;
      startedBlocked?.();
      await new Promise((r) => {
        releaseBlocked = r;
      });
    }
    return response;
  };
  globalThis.window = {
    innerWidth: 1440,
    innerHeight: 960,
    navigator: { userAgent: "independent-model-audit" },
    location: {
      assign() {
        throw new Error("unexpected login redirect");
      },
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const source = `import{createPinia,setActivePinia}from'pinia';import{nextTick}from'vue';
import{useTacticsStore}from'./src/stores/tacticsStore.ts';import{useAnimationStore}from'./src/stores/animationStore.ts';
import{useDrawStore}from'./src/stores/drawStore.ts';import{useItemStore}from'./src/stores/itemStore.ts';import{useRosterStore}from'./src/stores/rosterStore.ts';import{useCoachingStore}from'./src/stores/coachingStore.ts';
import{useHistory}from'./src/composables/useHistory.ts';import{useHistoryStore}from'./src/stores/historyStore.ts';import{useFormation}from'./src/composables/useFormation.ts';import{useMatchStore}from'./src/stores/matchStore.ts';
import{FieldElement}from'./src/types/fieldElement.ts';import{Drawing}from'./src/types/drawing.ts';import{toBoard,fromBoard}from'./src/services/tacticLanguage.ts';import{MATCH_FORMATIONS}from'./src/data/matchFormats.ts';
setActivePinia(createPinia());export{useTacticsStore,useAnimationStore,useDrawStore,useItemStore,useRosterStore,useCoachingStore,useHistory,useHistoryStore,useFormation,useMatchStore,FieldElement,Drawing,toBoard,fromBoard,MATCH_FORMATIONS,nextTick};`;
  const built = await build({
    stdin: { contents: source, resolveDir: join(root, "app"), loader: "ts" },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    alias: { "@": join(root, "app/src") },
    loader: { ".png": "dataurl", ".svg": "text" },
  });
  const bundle = join(dir, "actual-frontend-stores.cjs");
  writeFileSync(bundle, built.outputFiles[0].text);
  const model = require(bundle),
    t = model.useTacticsStore(),
    a = model.useAnimationStore(),
    draw = model.useDrawStore(),
    items = model.useItemStore(),
    roster = model.useRosterStore(),
    formation = model.useFormation(),
    match = model.useMatchStore(),
    history = model.useHistory();
  roster.players = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    number: p.number,
    positions: p.positions,
    foot: p.preferredFoot,
    note: p.note,
    status: "ok",
    fieldId: null,
  }));
  const countPlayers = (team) =>
    items.items
      .getAll()
      .filter(
        (p) =>
          p.elementType === "player" &&
          (team === "away" ? p.team === "away" : p.team !== "away"),
      );
  const templateIds = [];
  let animatedTacticId;
  await check(
    "every built-in formation: home+away count/identity and actual save/reload",
    async () => {
      for (const [n, forms] of Object.entries(model.MATCH_FORMATIONS)) {
        for (const f of forms) {
          formation.changePlayerCount(Number(n));
          formation.applyFormation(f.id);
          formation.applyOpponent(f.id);
          await model.nextTick();
          equal(
            countPlayers("home").length,
            Number(n),
            `${n}v${n}/${f.id} home count`,
          );
          equal(
            countPlayers("away").length,
            Number(n),
            `${n}v${n}/${f.id} away count`,
          );
          equal(
            new Set(countPlayers("home").map((p) => p.rosterId)).size,
            Number(n),
            `${n}v${n}/${f.id} unique real player IDs`,
          );
          equal(
            countPlayers("home")
              .map((p) => p.playerPosition)
              .sort(),
            f.spots.map((p) => p.role).sort(),
            `${n}v${n}/${f.id} home roles follow exact template`,
          );
          equal(
            countPlayers("away")
              .map((p) => p.playerPosition)
              .sort(),
            f.spots.map((p) => p.role).sort(),
            `${n}v${n}/${f.id} away roles follow exact template`,
          );
          equal(
            items.items
              .getAll()
              .every(
                (p) =>
                  Number.isFinite(p.x) &&
                  Number.isFinite(p.y) &&
                  p.x >= 0 &&
                  p.x <= 1250 &&
                  p.y >= 0 &&
                  p.y <= 826,
              ),
            true,
            `${n}v${n}/${f.id} coordinates remain on complete board`,
          );
          await t.saveTactic(
            `独立验收 ${n}人 ${f.name}`,
            ["验收"],
            f.id,
            "all-formations",
            {},
            true,
          );
          const id = t.currentId,
            expected = model.toBoard(t.snapshotBoard());
          templateIds.push({ count: Number(n), id: f.id, tacticId: id });
          t.newBoard();
          await t.loadTactic(id);
          await model.nextTick();
          equal(
            model.toBoard(t.snapshotBoard()),
            expected,
            `${n}v${n}/${f.id} complete saved content restored`,
          );
        }
      }
    },
  );
  await check(
    "substitution keeps outgoing coordinates and roundtrips undo/redo",
    async () => {
      formation.changePlayerCount(8);
      formation.applyFormation("2-3-2");
      await model.nextTick();
      const out = roster.players.find((p) => p.fieldId !== null),
        inc = roster.players.find((p) => p.fieldId === null),
        piece = items.items.findById(out.fieldId);
      const before = { x: piece.x, y: piece.y, position: piece.playerPosition },
        outgoing = out.id,
        incoming = inc.id;
      equal(
        roster.substitute(incoming, outgoing),
        true,
        "valid substitution accepted",
      );
      await model.nextTick();
      const after = countPlayers("home").find((p) => p.rosterId === incoming);
      equal(
        { x: after.x, y: after.y, position: after.playerPosition },
        before,
        "substitution coordinates",
      );
      history.handleUndo();
      await model.nextTick();
      equal(
        countPlayers("home").some((p) => p.rosterId === outgoing),
        true,
        "undo returns outgoing",
      );
      history.handleRedo();
      await model.nextTick();
      equal(
        countPlayers("home").some((p) => p.rosterId === incoming),
        true,
        "redo returns incoming",
      );
    },
  );
  await check(
    "injured player cannot enter or be chosen by formation",
    async () => {
      const person = roster.players.find((p) => p.fieldId !== null);
      roster.setStatus(person.id, "injured");
      await model.nextTick();
      equal(roster.playerOn(person.id), false, "injured entry refused");
      formation.applyFormation("3-3-1");
      await model.nextTick();
      equal(
        countPlayers("home").some((p) => p.rosterId === person.id),
        false,
        "injured not auto-selected",
      );
      roster.setStatus(person.id, "ok");
    },
  );
  await check(
    "all shapes and text tool produce correct persisted kind",
    async () => {
      for (const kind of ["pen", "line", "arrow", "rectangle", "ellipse"]) {
        draw.drawingConfig.type = kind;
        draw.createDrawing("shape", 100, 100, 200, 180, [
          [100, 100],
          [150, 160],
          [200, 180],
        ]);
        equal(
          draw.drawings.getDrawings().at(-1).drawingType,
          kind,
          `shape ${kind}`,
        );
      }
      draw.drawingConfig.type = "pen";
      draw.createDrawing("text", 400, 300, 400, 300, [], "真实文字验收");
      equal(
        draw.drawings.getDrawings().at(-1).drawingType,
        "text",
        "text tool creates text rather than pen",
      );
    },
  );
  await check(
    "animation plus plan survive real tactic save, reload and JSON backup/import",
    async () => {
      a.loadSnapshot();
      a.openAnimationFromBoard(countPlayers("home"));
      a.addFrame();
      a.updateFrame({ title: "前插", note: "真实保存的第二步", duration: 4.5 });
      const id = a.currentFrameElements[0].id;
      a.updateElementPosition(id, 600, 300);
      a.exitAnimation();
      model.useCoachingStore().plan = {
        objective: "配合",
        instructions: "两步配合验收",
        durationMinutes: 20,
      };
      await t.saveTactic(
        "独立动画与图形",
        ["验收"],
        t.currentFormationId,
        "动画版本",
        {},
        true,
      );
      const tacticId = t.currentId,
        expected = model.toBoard(t.snapshotBoard());
      animatedTacticId = tacticId;
      t.newBoard();
      await t.loadTactic(tacticId);
      equal(
        model.toBoard(t.snapshotBoard()),
        expected,
        "full animation plan drawing save/reload",
      );
      const backup = JSON.parse(await t.exportBackup());
      const imported = await t.importBackup(backup);
      equal(imported, backup.tactics.length, "restore appends all tactics");
      const all = await api("/api/tactics"),
        latest = all
          .filter((x) => x.title === "独立动画与图形")
          .sort((a, b) => b.tacticId - a.tacticId)[0];
      await t.loadTactic(latest.tacticId);
      equal(
        model.toBoard(t.snapshotBoard()),
        expected,
        "backup/import retains exact board, shapes, plan, animation",
      );
    },
  );
  await check(
    "new blank board undo and redo retain complete animation snapshot",
    async () => {
      const expected = a.getSnapshot(),
        originalOwner = t.currentId;
      equal(expected.frames.length, 2, "two-frame starting state");
      t.newBoard();
      history.handleUndo();
      await model.nextTick();
      equal(
        a.getSnapshot(),
        expected,
        "undo restores complete original animation",
      );
      equal(
        t.currentId,
        originalOwner,
        "undo restores original tactic save ownership",
      );
      history.handleRedo();
      await model.nextTick();
      equal(a.getSnapshot(), undefined, "redo blank clears animation");
      equal(t.currentId, null, "redo blank has no archived tactic save owner");
    },
  );
  await check(
    "latest requested tactic wins when older real HTTP response arrives last",
    async () => {
      const first = templateIds[0].tacticId,
        last = templateIds.at(-1).tacticId;
      blockedPath = `/api/tactics/${first}`;
      const entered = new Promise((r) => {
        startedBlocked = r;
      });
      const older = t.loadTactic(first);
      await entered;
      await t.loadTactic(last);
      releaseBlocked();
      await older;
      equal(
        t.currentId,
        last,
        "late older open must not replace newer selected tactic",
      );
    },
  );
  await check(
    "version rollback preserves original complete board and backs up current owner",
    async () => {
      await t.loadTactic(animatedTacticId);
      const expected = model.toBoard(t.snapshotBoard()),
        original = t.versions[animatedTacticId][0];
      model.useCoachingStore().plan.instructions = "后来版本";
      a.switchFrame(1);
      a.updateFrame({ title: "后来步骤", duration: 2 });
      await t.saveTactic(
        "独立动画与图形",
        ["验收"],
        t.currentFormationId,
        "later version",
      );
      await t.rollback(original);
      equal(
        model.toBoard(t.snapshotBoard()),
        expected,
        "rollback restores original animation, instructions and complete board",
      );
      equal(t.boardDirty, true, "rolled-back draft remains unsaved");
      await t.quickSave();
      equal(
        (await api(`/api/tactics/${animatedTacticId}`)).board,
        JSON.parse(JSON.stringify(expected)),
        "saving rollback writes original board back",
      );
      const versions = await api(`/api/tactics/${animatedTacticId}/versions`);
      equal(
        versions.some(
          (v) =>
            v.note === "回滚前自动备份" &&
            v.board.trainingPlan.instructions === "后来版本",
        ),
        true,
        "rollback backup belongs to correct tactic",
      );
    },
  );
  await check(
    "failed target version-list read leaves rollback canvas and history atomic",
    async () => {
      await t.loadTactic(animatedTacticId);
      const targetVersion = t.versions[animatedTacticId][0];
      const sourceId = templateIds[0].tacticId;
      await t.loadTactic(sourceId);
      a.openAnimationFromBoard(countPlayers("home"));
      a.addFrame();
      a.updateFrame({
        title: "当前未存档动画",
        note: "503后必须保留",
        duration: 6,
      });
      a.exitAnimation();
      model.useCoachingStore().plan.instructions = "503前的当前草稿";
      await model.nextTick();
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const state = () => ({
        owner: t.currentId,
        board: clone(t.snapshotBoard()),
        formation: t.currentFormationId,
        away: t.awayFormationId,
        customized: t.formationCustomized,
        dirty: t.boardDirty,
        roster: clone(roster.players),
        undo: clone(model.useHistoryStore().undoStack),
        redo: clone(model.useHistoryStore().redoStack),
      });
      const before = state(),
        sourceBefore = await api(`/api/tactics/${sourceId}`),
        targetBefore = await api(`/api/tactics/${animatedTacticId}`);
      const versionsBefore = await api(`/api/tactics/${sourceId}/versions`);
      failingVersionPath = `/api/tactics/${animatedTacticId}/versions`;
      let rejection;
      try {
        await t.rollback(targetVersion);
      } catch (error) {
        rejection = error;
      }
      equal(rejection?.status, 503, "rollback exposes target versions 503");
      equal(injectedFailures, 1, "exactly one target version read failed");
      equal(
        state(),
        before,
        "503 preserves owner, full board, formation, animation, roster and undo/redo history",
      );
      equal(
        await api(`/api/tactics/${sourceId}`),
        sourceBefore,
        "503 does not overwrite source stored tactic",
      );
      equal(
        await api(`/api/tactics/${animatedTacticId}`),
        targetBefore,
        "503 does not overwrite target stored tactic",
      );
      const versionsAfter = await api(`/api/tactics/${sourceId}/versions`);
      equal(
        versionsAfter.length,
        versionsBefore.length + 1,
        "pre-read safety backup may already persist",
      );
      equal(
        versionsAfter[0].note,
        "回滚前自动备份",
        "retained side effect is an explicit safety backup",
      );
      equal(
        versionsAfter[0].board,
        JSON.parse(JSON.stringify(model.toBoard(before.board))),
        "safety backup contains original complete current draft",
      );
    },
  );
  await check(
    "board flip twice and undo retain exact personnel and drawings",
    async () => {
      const round = (value) =>
        JSON.parse(
          JSON.stringify(value, (_k, v) =>
            _k === "markingId"
              ? undefined
              : typeof v === "number"
                ? Math.round(v * 1e8) / 1e8
                : v,
          ),
        );
      const expected = round(model.toBoard(t.snapshotBoard()));
      formation.flipBoard();
      formation.flipBoard();
      await model.nextTick();
      equal(
        round(model.toBoard(t.snapshotBoard())),
        expected,
        "double flip exact board/labels/drawings",
      );
      formation.flipBoard();
      history.handleUndo();
      await model.nextTick();
      equal(
        round(model.toBoard(t.snapshotBoard())),
        expected,
        "flip undo restores data including current animation",
      );
    },
  );
  await check(
    "slow explicit save writes its own tactic without rebinding a newer board",
    async () => {
      const first = templateIds[0].tacticId,
        last = templateIds.at(-1).tacticId;
      await t.loadTactic(first);
      model.useCoachingStore().plan.instructions = "只写入原战术";
      blockedPath = `/api/tactics/${first}`;
      const entered = new Promise((r) => {
        startedBlocked = r;
      });
      const pending = t.saveTactic("原战术延迟保存", [], t.currentFormationId);
      await entered;
      await t.loadTactic(last);
      const latest = model.toBoard(t.snapshotBoard());
      releaseBlocked();
      await pending;
      equal(t.currentId, last, "old save must not rebind current tactic");
      equal(
        model.toBoard(t.snapshotBoard()),
        latest,
        "old save does not replace new board",
      );
      equal(
        (await api(`/api/tactics/${first}`)).board.trainingPlan.instructions,
        "只写入原战术",
        "write remains with original target",
      );
    },
  );
  await check(
    "slow import persists its new record but never replaces a later blank board",
    async () => {
      const snapshot = t.snapshotBoard();
      blockedPath = "/api/tactics";
      const entered = new Promise((r) => {
        startedBlocked = r;
      });
      const pending = t.importTactic("延迟导入记录", [], snapshot);
      await entered;
      t.newBoard();
      releaseBlocked();
      await pending;
      equal(t.currentId, null, "old import must not rebind blank board");
      equal(
        items.items.getAll().length,
        0,
        "old import must not overwrite blank contents",
      );
      equal(
        (await api("/api/tactics")).some((x) => x.title === "延迟导入记录"),
        true,
        "authorized import record still exists",
      );
    },
  );
  await check(
    "slow rollback does not replace a newer explicit board",
    async () => {
      await t.loadTactic(animatedTacticId);
      const original = t.versions[animatedTacticId][0];
      blockedPath = `/api/tactics/${animatedTacticId}`;
      const entered = new Promise((r) => {
        startedBlocked = r;
      });
      const pending = t.rollback(original);
      await entered;
      t.newBoard();
      releaseBlocked();
      await pending;
      equal(t.currentId, null, "old rollback must not rebind blank board");
      equal(
        items.items.getAll().length,
        0,
        "old rollback must not overwrite blank contents",
      );
    },
  );
  await check(
    "opening another tactic then undo returns save ownership and animation",
    async () => {
      await t.loadTactic(animatedTacticId);
      const animation = a.getSnapshot(),
        board = model.toBoard(t.snapshotBoard());
      const other = templateIds[2].tacticId,
        untouched = await api(`/api/tactics/${other}`);
      await t.loadTactic(other);
      history.handleUndo();
      await model.nextTick();
      equal(t.currentId, animatedTacticId, "undo opening restores save owner");
      equal(
        a.getSnapshot(),
        animation,
        "undo opening restores original animation",
      );
      await t.quickSave();
      equal(
        (await api(`/api/tactics/${animatedTacticId}`)).board.demonstration,
        board.demonstration,
        "quick-save targets restored owner",
      );
      equal(
        await api(`/api/tactics/${other}`),
        untouched,
        "quick-save does not overwrite other tactic",
      );
    },
  );
  await check("favorite and explicit tactic collection roundtrip", async () => {
    const id = templateIds[0].tacticId;
    const old = await api(`/api/tactics/${id}`);
    await t.toggleFav(id);
    equal(
      (await api(`/api/tactics/${id}`)).favorite,
      !old.favorite,
      "favorite persisted",
    );
    await t.toggleFav(id);
    equal(
      (await api(`/api/tactics/${id}`)).favorite,
      old.favorite,
      "favorite toggled back",
    );
  });
  await check(
    "all stored tactics and versions survive real server restart",
    async () => {
      const before = await api("/api/tactic-collections");
      await stop();
      await start();
      const after = await api("/api/tactic-collections");
      delete before.exportedAt;
      delete after.exportedAt;
      equal(after, before, "complete persisted collection across reopen");
    },
  );
  console.log(
    JSON.stringify(
      {
        result: failures.length ? "FAIL" : "PASS",
        assertions,
        templates: templateIds.length,
        perFormat: Object.fromEntries(
          Object.entries(model.MATCH_FORMATIONS).map(([n, f]) => [
            n,
            f.map((x) => x.id),
          ]),
        ),
        passed: coverage,
        failures,
        sourceHashes,
        sourceUnchanged: isDeepStrictEqual(hashes(), sourceHashes),
        scope:
          "real frontend stores + real loopback HTTP + temporary SQLite; one injected 503 resilience case; NOT browser mouse/painting/playback/export verification",
      },
      null,
      2,
    ),
  );
  if (failures.length) process.exitCode = 1;
} catch (error) {
  console.error(`AUDIT ERROR ${error.message}`);
  process.exitCode = 1;
} finally {
  releaseBlocked?.();
  globalThis.fetch = nativeFetch;
  await stop();
  rmSync(dir, { recursive: true, force: true });
}
