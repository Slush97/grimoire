/**
 * Per-hero pose/camera authoring config for baked 3D Locker card snapshots.
 *
 * READ (dev + prod): the committed `data/heroPoseAuthoring.ts` map is the
 * shipped default. The bake and the authoring tool both read it.
 *
 * WRITE (dev only): the authoring tool commits a hero's framing via
 * writeHeroPoseAuthoringEntry. We (a) stash it in an in-memory override so the
 * running session reflects the change immediately (a static `import` of the
 * data module can't be re-read without a restart), and (b) regenerate the
 * committed `.ts` source under app.getAppPath() so it persists and ships. The
 * write is hard-gated to dev: a packaged app has no writable repo source and
 * must never mutate itself.
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { is } from '@electron-toolkit/utils';
import type { HeroPoseAuthoringEntry, HeroPoseAuthoringMap } from '../../../src/types/portrait';
import { HERO_POSE_AUTHORING } from '../data/heroPoseAuthoring';

/** In-session dev edits, layered over the committed map so commits take effect
 *  without an app restart. Empty in prod (writes are blocked). */
const liveOverrides = new Map<string, HeroPoseAuthoringEntry>();

/** The committed map merged with any in-session dev overrides. */
export function getHeroPoseAuthoring(): HeroPoseAuthoringMap {
    return { ...HERO_POSE_AUTHORING, ...Object.fromEntries(liveOverrides) };
}

/** A single hero's authored entry, or null when unset (caller applies defaults). */
export function getHeroPoseAuthoringEntry(heroName: string): HeroPoseAuthoringEntry | null {
    return liveOverrides.get(heroName) ?? HERO_POSE_AUTHORING[heroName] ?? null;
}

/** Source path of the committed data module (dev only; app root is the repo). */
function authoringSourcePath(): string {
    return join(app.getAppPath(), 'electron', 'main', 'data', 'heroPoseAuthoring.ts');
}

/** Serialize the merged map back into the committed `.ts` module. JSON.stringify
 *  emits a valid TS object literal (quoted keys), so the file stays type-checked
 *  and diff-friendly. */
function renderAuthoringModule(map: HeroPoseAuthoringMap): string {
    const sortedKeys = Object.keys(map).sort();
    const sorted: HeroPoseAuthoringMap = {};
    for (const key of sortedKeys) sorted[key] = map[key];
    const literal = Object.keys(sorted).length === 0 ? '{}' : JSON.stringify(sorted, null, 4);
    return `import type { HeroPoseAuthoringMap } from '../../../src/types/portrait';

/**
 * AUTO-MANAGED per-hero pose/camera framing for baked 3D Locker card snapshots.
 *
 * Authored through the in-app dev pose-authoring tool (the "Commit" action calls
 * writeHeroPoseAuthoringEntry, which regenerates this file via app.getAppPath()).
 * Do NOT hand-edit: the writeback rewrites the whole map with JSON formatting.
 *
 * Heroes absent from this map fall back to the pipeline defaults (default
 * menu/idle pose + DEFAULT_CAMERA_FRAMING). Shipping is just committing this
 * file; the loader bundles it and overlays any in-session dev edits.
 */
export const HERO_POSE_AUTHORING: HeroPoseAuthoringMap = ${literal};
`;
}

/**
 * Persist a hero's authored framing. Dev-only: throws in a packaged build.
 * Updates the in-memory override immediately and rewrites the committed source.
 */
export async function writeHeroPoseAuthoringEntry(
    heroName: string,
    entry: HeroPoseAuthoringEntry
): Promise<HeroPoseAuthoringMap> {
    if (!is.dev) {
        throw new Error('Pose authoring writeback is dev-only (packaged builds are read-only).');
    }
    if (!heroName.trim()) throw new Error('Missing hero name');
    liveOverrides.set(heroName, entry);
    const merged = getHeroPoseAuthoring();
    await fs.writeFile(authoringSourcePath(), renderAuthoringModule(merged), 'utf-8');
    return merged;
}
