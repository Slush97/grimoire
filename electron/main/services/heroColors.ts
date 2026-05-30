/**
 * Per-hero ability-COLOR apply pipeline.
 *
 * The Locker color picker lets a user recolor a hero's ability VFX to a single
 * hue. The recolor spans all three color mechanisms at once (particle params +
 * color textures + baked mesh vertex colors) via the bundled
 * `vpkmerge recolor-hero` (one `--hue` lands them on the same color). Every
 * applied choice lives in ONE Locker-managed VPK in citadel/grimoire (pak03),
 * rebuilt from a selection set on each apply/revert. The grimoire folder wins by
 * SearchPaths precedence, so the recolor overrides the base game VFX (and any
 * skin's particles) in place.
 *
 * `recolor-hero` is EXPENSIVE (a full BCn texture re-encode: tens of seconds for
 * Paige), so each (codename, hue) bake is cached under userData. A rebuild only
 * re-bakes a hero whose hue actually changed; everyone else's cached addon is
 * merged in. Clearing a hero just drops it from the set and rebuilds.
 *
 * Only heroes with a pinned recipe in vpkmerge are supported (Paige / `bookworm`
 * today); colorCodenameForHero gates the rest.
 *
 * NOTE: addons mount only at game start, so an applied color change needs a full
 * Deadlock restart to take effect.
 */
import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { getCitadelPath, getGrimoirePath } from './deadlock';
import { invalidateVpkParseCache } from './vpk';
import { runVpkmerge, vpkmergeBinaryPath, verifyVpkOutput } from './modMerger';
import { LOCKER_COLORS_KEY, lockerColorsVpkPath, ensureGrimoireConfigured } from './lockerVpk';
import { getModMetadata, setModMetadata, removeModMetadata } from './metadata';
import type {
    ActiveHeroColor,
    ApplyHeroColorResult,
    LockerColorSelection,
    LockerColorsInfo,
} from '../../../src/types/mod';

/**
 * Display name -> model/particle recolor codename, scoped to heroes that have a
 * pinned recipe in vpkmerge's `recolor-hero` (the recipe key must match exactly).
 * This is deliberately its OWN table, not the sound/panorama codename maps: the
 * recolor recipe is keyed by the `models/` + `particles/abilities/` codename,
 * which can diverge from those. Add a hero here in lockstep with adding its
 * recipe to vpkmerge (`recipe_for` in vpkmerge-core/src/hero_recolor.rs).
 */
const COLOR_CODENAME_BY_HERO: Readonly<Record<string, string>> = {
    Paige: 'bookworm',
};

/** Bumped when the recolor recipe/binary changes in a way that should re-bake
 *  cached addons. Part of the cache filename so a stale bake is never reused. */
const RECIPE_CACHE_VERSION = 1;

/** The recolor codename for a hero, or null when no recipe is pinned for it. */
export function colorCodenameForHero(heroName: string): string | null {
    return COLOR_CODENAME_BY_HERO[heroName] ?? null;
}

/** Whether ability-color recolor is available for this hero (a recipe exists). */
export function getHeroColorSupport(heroName: string): boolean {
    return colorCodenameForHero(heroName) !== null;
}

/** Normalize any hue to an integer in [0, 360). */
function normalizeHue(hue: number): number {
    return (((Math.round(hue) % 360) + 360) % 360);
}

/** Current color selection set (one per hero), from the synthetic metadata key.
 *  Unlike sounds/cards there's no in-addons fallback: colors never lived there. */
function currentColorSelections(): LockerColorSelection[] {
    return getModMetadata(LOCKER_COLORS_KEY)?.lockerColors?.colors ?? [];
}

/** Cache path for one hero's baked recolor addon, keyed by codename+hue+version
 *  so the same color is baked once and reused across rebuilds. */
function colorCachePath(codename: string, hue: number): string {
    const dir = join(app.getPath('userData'), 'ability-colors');
    return join(dir, `${codename}_h${hue}_v${RECIPE_CACHE_VERSION}_dir.vpk`);
}

/**
 * Ensure a hero's recolor addon for `hue` exists in the cache, baking it via
 * `vpkmerge recolor-hero` (reading the base game VFX from pak01) if missing.
 * Bakes to a temp file then renames, so an interrupted bake never leaves a
 * partial cache entry. Returns the cache path.
 */
async function ensureHeroColorBake(pak01: string, codename: string, hue: number): Promise<string> {
    const cachePath = colorCachePath(codename, hue);
    if (existsSync(cachePath)) return cachePath;

    const dir = join(app.getPath('userData'), 'ability-colors');
    await fs.mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${codename}_h${hue}_${randomUUID()}_dir.vpk`);
    try {
        await runVpkmerge([
            'recolor-hero',
            '--hero',
            codename,
            '--vpk',
            pak01,
            '--hue',
            String(hue),
            '--encode-vpk',
            tmp,
        ]);
        await verifyVpkOutput(tmp);
        await fs.rename(tmp, cachePath);
    } finally {
        await fs.unlink(tmp).catch(() => {});
    }
    return cachePath;
}

interface RebuildResult {
    fileName: string | null;
}

/**
 * Rebuild the consolidated Locker colors VPK from `desired`. Bakes each hero's
 * recolor addon (cached by codename+hue) and folds them into one VPK at the fixed
 * grimoire slot. One selection copies straight in; several merge (each hero's
 * paths are codename-namespaced, so disjoint). Empty deletes the VPK + metadata.
 */
async function rebuildLockerColors(
    deadlockPath: string,
    desired: LockerColorSelection[],
): Promise<RebuildResult> {
    const destPath = lockerColorsVpkPath(deadlockPath);

    // One selection per codename (last wins), so a re-apply replaces, not stacks.
    const byCodename = new Map<string, LockerColorSelection>();
    for (const sel of desired) byCodename.set(sel.heroCodename, sel);
    const valid = [...byCodename.values()];

    if (valid.length === 0) {
        await fs.unlink(destPath).catch(() => {});
        removeModMetadata(LOCKER_COLORS_KEY);
        invalidateVpkParseCache(destPath);
        return { fileName: null };
    }

    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    if (!existsSync(pak01)) {
        throw new Error('Base game pak01_dir.vpk not found; check the Deadlock path in Settings.');
    }

    // Bake (or reuse) each hero's recolor addon.
    const caches: string[] = [];
    for (const sel of valid) {
        caches.push(await ensureHeroColorBake(pak01, sel.heroCodename, sel.hue));
    }

    const grimoireDir = getGrimoirePath(deadlockPath);
    await fs.mkdir(grimoireDir, { recursive: true });

    if (caches.length === 1) {
        // Single hero: the cache IS the addon; copy it into the fixed slot
        // (copy, not rename, so the cache survives for the next rebuild).
        await fs.copyFile(caches[0], destPath);
    } else {
        const buildOut = join(grimoireDir, `.locker-colors-build-${randomUUID()}.out.vpk`);
        try {
            // Disjoint per-hero paths, so no collision; merge into the slot.
            await runVpkmerge([buildOut, ...caches]);
            await verifyVpkOutput(buildOut);
            await fs.unlink(destPath).catch(() => {});
            await fs.rename(buildOut, destPath);
        } finally {
            await fs.unlink(buildOut).catch(() => {});
        }
    }
    await verifyVpkOutput(destPath);
    invalidateVpkParseCache(destPath);

    const info: LockerColorsInfo = { colors: valid, rebuiltAt: new Date().toISOString() };
    setModMetadata(LOCKER_COLORS_KEY, { modName: 'Locker Ability Colors', lockerColors: info });
    return { fileName: destPath };
}

/**
 * Apply hero X's ability VFX recolor to `hue`, replacing any prior color for
 * that hero. Bakes the recolor (cached) and folds it into the managed colors VPK.
 */
export async function applyHeroColor(
    deadlockPath: string,
    heroName: string,
    hue: number,
): Promise<ApplyHeroColorResult> {
    vpkmergeBinaryPath(); // surface a clear error early if the binary is missing/old
    const codename = colorCodenameForHero(heroName);
    if (!codename) {
        throw new Error(`Ability color recolor isn't available for ${heroName} yet.`);
    }
    ensureGrimoireConfigured(deadlockPath);

    const normHue = normalizeHue(hue);
    const current = currentColorSelections();
    const next: LockerColorSelection[] = [
        ...current.filter((s) => s.heroCodename !== codename),
        { heroName, heroCodename: codename, hue: normHue, addedAt: new Date().toISOString() },
    ];
    await rebuildLockerColors(deadlockPath, next);
    return { hue: normHue };
}

/** Remove hero X's ability color, reverting its VFX to vanilla. */
export async function revertHeroColor(
    deadlockPath: string,
    heroName: string,
): Promise<ApplyHeroColorResult> {
    const codename = colorCodenameForHero(heroName);
    if (!codename) return { hue: null };
    ensureGrimoireConfigured(deadlockPath);

    const current = currentColorSelections();
    if (current.length === 0) return { hue: null };
    const next = current.filter((s) => s.heroCodename !== codename);
    await rebuildLockerColors(deadlockPath, next);
    return { hue: null };
}

/** The hue currently applied for a hero's ability VFX, or null. */
export function getActiveHeroColor(heroName: string): ActiveHeroColor | null {
    const codename = colorCodenameForHero(heroName);
    if (!codename) return null;
    const sel = currentColorSelections().find((s) => s.heroCodename === codename);
    return sel ? { hue: sel.hue } : null;
}

/** Clear every applied ability color (rebuild to empty, deleting the VPK). */
export async function clearAllHeroColors(deadlockPath: string): Promise<void> {
    await rebuildLockerColors(deadlockPath, []);
}
