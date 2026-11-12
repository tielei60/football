import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seedTacticalRoster, TACTICAL_TEST_PLAYERS } from "./tactical-roster.mjs";

test("tactical roster is explicit fictional API setup preserving generated IDs", async () => {
  const requests = [];
  const players = await seedTacticalRoster({
    async post(path, { data }) {
      requests.push({ path, data });
      return { ok: () => true, json: async () => ({ ...data, id: `generated-${requests.length}` }) };
    },
  });
  assert.equal(players.length, 20);
  assert.equal(requests.length, 20);
  assert.ok(requests.every((r) => r.path === "/api/players" && !Object.hasOwn(r.data, "id")));
  assert.ok(players.every((p) => p.name.startsWith("虚构")));
  assert.equal(players[0].id, "generated-1");
  assert.equal(players[8].id, "generated-9");
  assert.equal(TACTICAL_TEST_PLAYERS.length, 20);
});

test("base business fixture and fresh acceptance suites do not opt into tactical seeding", () => {
  const base = readFileSync(new URL("./fixtures.ts", import.meta.url), "utf8");
  assert.ok(!base.includes("seedTacticalRoster"));
  ["club", "club-review", "fresh-club-board", "realistic-club-acceptance", "print-club-identity", "avatar"].forEach(
    (name) => {
      const source = readFileSync(new URL(`./${name}.spec.ts`, import.meta.url), "utf8");
      assert.ok(!source.includes('from "./tactical-fixtures"'), `${name} must remain unseeded`);
    }
  );
});

test("fixture seeding fails explicitly on a rejected API operation", async () => {
  await assert.rejects(
    seedTacticalRoster({ post: async () => ({ ok: () => false, status: () => 409 }) }),
    /Could not create fictional tactical fixture \(409\)/
  );
});
