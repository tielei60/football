import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";

function contents(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='app_migrations' ORDER BY name",
    )
    .all()
    .map(({ name }) => [
      name,
      db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ]);
}
for (const mode of [
  "fresh-empty",
  "modern-missing-markers",
  "modern-table-only",
  "modern-marker-only",
]) {
  test(`${mode}: future bg IDs and imported presets are never rewritten on restart`, async (t) => {
    const directory = await mkdtemp(
      join(tmpdir(), "football-legacy-boundary-"),
    );
    t.after(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, "test.sqlite");
    let store = openFootballStore(path);
    assert.equal(
      store.database
        .prepare(
          "SELECT count(*) AS n FROM app_migrations WHERE migration_name LIKE 'berlin-garden-%'",
        )
        .get().n,
      3,
    );
    if (mode !== "fresh-empty" && mode !== "modern-marker-only")
      createClubStore(store.database, store);
    const board = {
      pieces: [
        {
          pieceId: "custom-1",
          playerId: "bg-6",
          x: 911,
          y: 123,
          label: "用户自定",
          position: "GK",
          shirtNumber: 88,
        },
        {
          pieceId: "custom-2",
          playerId: "bg-2",
          x: 812,
          y: 234,
          label: "不许改动",
          position: "FW",
          shirtNumber: 0,
        },
      ],
      markings: [],
      trainingPlan: {},
    };
    store.saveDesk({
      edition: 0,
      desk: {
        board,
        selectedTacticId: null,
        players: [
          {
            playerId: "bg-6",
            name: "虚构自定球员",
            number: 88,
            positions: ["门将"],
            preferredFoot: "左",
            status: "ok",
            note: "保留",
            avatar: null,
            fieldPieceId: "custom-1",
          },
        ],
      },
    });
    store.importCollection({
      collectionName: "modern-preset-import",
      tactics: Array.from({ length: 10 }, (_, i) => ({
        title: `现代预置 ${i}`,
        tags: [],
        favorite: false,
        formationName: "3-3-1",
        board,
        thumbnail: null,
        presetName: `modern-${i}`,
        presetEdition: 10,
      })),
      versions: [{ tacticNumber: 0, note: "历史原值", board, createdAt: 123 }],
    });
    if (mode !== "fresh-empty")
      store.database.exec(
        "DELETE FROM app_migrations WHERE migration_name LIKE 'berlin-garden-%'",
      );
    if (mode === "modern-table-only")
      store.database.exec(
        "DELETE FROM app_migrations WHERE migration_name='club-management-v1'",
      );
    if (mode === "modern-marker-only")
      store.database.exec(
        "INSERT INTO app_migrations VALUES ('club-management-v1',123)",
      );
    const before = contents(store.database);
    store.close();
    let firstRestartMigrations;
    for (let i = 0; i < 2; i++) {
      store = openFootballStore(path);
      assert.deepEqual(contents(store.database), before);
      assert.equal(
        store.database
          .prepare(
            "SELECT count(*) AS n FROM app_migrations WHERE migration_name LIKE 'berlin-garden-%'",
          )
          .get().n,
        3,
      );
      assert.deepEqual(
        store.database.prepare("PRAGMA foreign_key_check").all(),
        [],
      );
      const migrationRows = store.database
        .prepare("SELECT * FROM app_migrations ORDER BY migration_name")
        .all();
      if (i === 0) firstRestartMigrations = migrationRows;
      else assert.deepEqual(migrationRows, firstRestartMigrations);
      store.close();
    }
  });
}
