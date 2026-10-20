import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getUserDataPath } from '../utils/paths';
import { requirementKey } from '../../../src/lib/modRequirements';
import type { GameBananaItemRef, ModRequirementSnapshot } from '../../../src/types/gamebanana';

export const requirementTargetsSchema = z.array(z.object({
  id: z.number().int().positive(), section: z.enum(['Mod', 'Sound', 'Wip']),
})).max(5000);
const snapshotSchema = z.object({ status: z.literal('loaded'), checkedAt: z.number(), items: z.array(z.object({
  name: z.string(), url: z.string().optional(), importance: z.enum(['required', 'optional', 'unknown']), state: z.enum(['on', 'off', 'unknown']),
})) });
const cacheSchema = z.record(snapshotSchema);
let currentPath = '';
let cache: Record<string, ModRequirementSnapshot> = {};
function load(): string {
  const path = join(getUserDataPath(), 'mod-requirements.json');
  if (path !== currentPath) {
    currentPath = path;
    try { cache = cacheSchema.parse(JSON.parse(readFileSync(path, 'utf8'))); } catch { cache = {}; }
  }
  return path;
}
export function getCachedRequirements(target: GameBananaItemRef): ModRequirementSnapshot | undefined {
  load();
  const hit = cache[requirementKey(target)];
  return hit && Date.now() - hit.checkedAt < 24 * 60 * 60 * 1000 ? hit : undefined;
}
export function cacheRequirements(target: GameBananaItemRef, snapshot: ModRequirementSnapshot): void {
  const path = load();
  if (snapshot.status !== 'loaded') return;
  cache[requirementKey(target)] = snapshot;
  try {
    mkdirSync(getUserDataPath(), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(cache));
    renameSync(`${path}.tmp`, path);
  } catch (error) { console.warn('[requirements] Could not save cache:', error); }
}
