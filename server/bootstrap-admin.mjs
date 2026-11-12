import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openFootballStore } from "./football-store.mjs";
import { createClubStore } from "./club-store.mjs";
const username = process.env.FOOTBALL_ADMIN_USERNAME;
const password = process.env.FOOTBALL_ADMIN_PASSWORD;
if (!username || !password)
  throw new Error(
    "Set FOOTBALL_ADMIN_USERNAME and FOOTBALL_ADMIN_PASSWORD (10–200 characters).",
  );
const databasePath =
  process.env.FOOTBALL_DB_PATH ||
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../app/data/football.sqlite",
  );
const store = openFootballStore(databasePath);
try {
  createClubStore(store.database, store, {
    bootstrapAdmin: { username, password },
  });
  console.log(
    "Administrator is provisioned. Existing administrator passwords are never overwritten.",
  );
} finally {
  store.close();
}
