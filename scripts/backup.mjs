import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.env.FOOTBALL_DB_PATH || resolve(root, 'app/data/football.sqlite'));
const target = process.argv[2] && resolve(process.argv[2]);
if (!target || target === source || !existsSync(source) || existsSync(target)) {
  console.error('Usage: FOOTBALL_DB_PATH=/path/football.sqlite node scripts/backup.mjs /new/path/backup.sqlite');
  console.error('Source must exist; destination must be a new file. Never overwrite a live database.');
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
const database = new DatabaseSync(source);
try {
  database.exec('PRAGMA busy_timeout = 10000');
  database.prepare('VACUUM INTO ?').run(target);
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Backup integrity check failed');
  } finally { copy.close(); }
  console.log(`Verified SQLite backup: ${target}`);
} finally { database.close(); }
