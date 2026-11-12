import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Compile only this dependency-free module so the test works on every supported
// Node 22 release, including versions without built-in TypeScript stripping.
const source = readFileSync(new URL("../src/data/berlinGarden.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const roster = await import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
const {
  BERLIN_GARDEN_PLAYERS: players,
  assignPlayersToFormation,
  normalizePlayerPositions,
  resolveRosterPlayer,
  resolveAvatar,
} = roster;

test("restores all twenty backend roster identities without invented personal details", () => {
  assert.equal(players.length, 20);
  assert.equal(new Set(players.map((player) => player.id)).size, 20);
  assert.equal(players[0].name, "刘作涛");
  assert.equal(players[19].name, "刘刚");
  assert.deepEqual(players[0].positions, ["中后卫", "后腰"]);
  assert.ok(players.every((player, index) => player.number === index + 1 && !player.avatar && player.foot === ""));
});
test("normalizes old codes, JSON, multiple positions and empty input", () => {
  assert.deepEqual(normalizePlayerPositions("GK"), ["门将"]);
  assert.deepEqual(normalizePlayerPositions('["DF","后腰","DF"]'), ["后卫", "后腰"]);
  assert.deepEqual(normalizePlayerPositions(" 前腰、右边前 "), ["前腰", "右边前"]);
  assert.deepEqual(normalizePlayerPositions(["待定", "前锋"]), ["前锋"]);
  for (const input of [undefined, null, [], "invalid", "[broken"])
    assert.deepEqual(normalizePlayerPositions(input), ["待定"]);
});
test("default lineup matches server migration and does not mutate its inputs", () => {
  const starters = players.slice(0, 8);
  const before = JSON.stringify(starters);
  const spots = ["GK", "DF", "DF", "MF", "MF", "MF", "FW", "FW"].map((role) => ({ role }));
  assert.deepEqual(
    assignPlayersToFormation(starters, spots).map((player) => player.id),
    ["bg-2", "bg-1", "bg-4", "bg-3", "bg-7", "bg-8", "bg-5", "bg-6"]
  );
  assert.equal(JSON.stringify(starters), before);
  for (const count of [5, 6, 7, 8, 9, 11]) {
    const slots = Array.from({ length: count }, (_, index) => ({ role: index ? "MF" : "GK" }));
    const assigned = assignPlayersToFormation(players.slice(0, count), slots);
    assert.equal(assigned.length, count);
    assert.equal(new Set(assigned.map((player) => player.id)).size, count);
    assert.equal(assigned[0].id, "bg-2");
    assert.deepEqual(assigned, assignPlayersToFormation(players.slice(0, count), slots));
  }
  assert.deepEqual(assignPlayersToFormation([], spots), []);
  assert.equal(assignPlayersToFormation(players.slice(0, 2), spots).length, 2);
});
test("identity resolution excludes opponents, respects stable IDs and avoids ambiguous shirts", () => {
  assert.equal(resolveRosterPlayer(players, { rosterId: "bg-2", number: 1 })?.name, "刘建宏");
  assert.equal(resolveRosterPlayer(players, { rosterId: "deleted", number: 1 }), undefined);
  assert.equal(resolveRosterPlayer(players, { number: 1, team: "away" }), undefined);
  assert.equal(resolveRosterPlayer(players, { text: "刘作涛" })?.id, "bg-1");
  assert.equal(resolveRosterPlayer(players, { number: 1 })?.id, "bg-1");
  assert.equal(resolveRosterPlayer([players[0], { ...players[1], number: 1 }], { number: 1 }), undefined);
});
test("missing legacy photos fall back while supplied portraits remain available", () => {
  assert.equal(roster.avatarPath("bg-1"), undefined);
  assert.equal(resolveAvatar([{ ...players[0], avatar: "/avatars/bg-1.jpg" }], { rosterId: "bg-1" }), undefined);
  assert.equal(
    resolveAvatar([{ ...players[0], avatar: "data:image/png;base64,abc" }], { rosterId: "bg-1" }),
    "data:image/png;base64,abc"
  );
});
