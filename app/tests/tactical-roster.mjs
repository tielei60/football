// Explicit test-only profiles. Production startup must never import this module.
const positions = [
  ["中后卫", "后腰"],
  ["门将"],
  ["后腰"],
  ["中后卫"],
  ["中锋"],
  ["前腰", "右边前"],
  ["边前卫"],
  ["边后卫", "边前卫"],
  ["中锋"],
  ["中锋", "边前卫"],
  ["右边前"],
  ["左边前"],
  ["后卫"],
  ["后卫"],
  ["后卫"],
  ["后卫"],
  ["后腰"],
  ["边前卫", "前腰"],
  ["后腰"],
  ["前腰"],
];
export const TACTICAL_TEST_PLAYERS = positions.map((playerPositions, index) => ({
  name: `虚构战术队员${String(index + 1).padStart(2, "0")}`,
  number: index + 1,
  positions: [...playerPositions],
}));

export async function seedTacticalRoster(request) {
  const players = [];
  // Ordering is intentional: roster row 1/9 substitution tests depend on stable creation order.
  // eslint-disable-next-line no-restricted-syntax -- Keep API-created roster IDs in deterministic sequence.
  for (const data of TACTICAL_TEST_PLAYERS) {
    // eslint-disable-next-line no-await-in-loop -- A deterministic sequential test fixture.
    const response = await request.post("/api/players", { data });
    if (!response.ok()) throw new Error(`Could not create fictional tactical fixture (${response.status()}).`);
    // eslint-disable-next-line no-await-in-loop -- Preserve server-generated ID mapping in creation order.
    players.push(await response.json());
  }
  return players;
}
