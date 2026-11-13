import { createHash } from 'node:crypto';
export const tacticVersion = tactic => createHash('sha256').update(JSON.stringify(tactic)).digest('hex');
