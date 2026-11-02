/**
 * Trippy procedural SKIN paints + the shared animated preview sprite.
 *
 * The Locker Effects panel paints a hero's body/weapon materials with a
 * procedural pattern plus runtime VMAT UV-scroll, via the bundled
 * `vpkmerge trippy-skin`. Every applied paint lives in ONE Locker-managed VPK
 * in citadel/grimoire (pak04), rebuilt from a selection set on each
 * apply/revert: the same architecture as the ability-colors VPK (pak03), and
 * deliberately disjoint from it (skin = models/heroes* materials, colors =
 * particles), so a trippy skin composes with an applied ability color.
 *
 * The trippy ability-VFX paint is NOT here: it patches the same particles as
 * recolor/prism, so it lives in heroColors.ts as a third mode of the colors
 * selection set (one recolor per hero, never stacking).
 *
 * The preview sprite (`vpkmerge trippy-preview`) is pure pattern generation:
 * hero-independent, no VPK read, milliseconds per render. Sprites are cached on
 * disk by their normalized parameters and returned as PNG data URLs; the
 * renderer plays them as a flipbook.
 *
 * NOTE: addons mount only at game start, so an applied paint change needs a
 * full Deadlock restart to take effect.
 */
import { promises as fs, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { skinPartPatternSchema } from '../../../src/lib/skinEditSchema';
import { app } from 'electron';
import { getCitadelPath, getGrimoirePath } from './deadlock';
import { invalidateVpkParseCache } from './vpk';
import { runVpkmerge, vpkmergeBinaryPath, verifyVpkOutput } from './modMerger';
import { LOCKER_TRIPPY_SKINS_KEY, lockerTrippySkinsVpkPath, ensureGrimoireConfigured } from './lockerVpk';
import { getModMetadata, setModMetadata, removeModMetadata } from './metadata';
import { colorCodenameForHero } from './heroColors';
import { TRIPPY_STYLES } from '../../../src/types/mod';
import type {
    ActiveTrippySkin,
    ApplyTrippySkinResult,
    LockerTrippySkinSelection,
    LockerTrippySkinsInfo,
    TrippySpriteOptions,
    TrippySpriteResult,
    TrippyStyleName,
} from '../../../src/types/mod';

/** Bumped when the paint pipeline/binary changes in a way that should re-bake
 *  cached skin addons (and re-render cached preview sprites). */
const TRIPPY_CACHE_VERSION = 2;

function clampRound(x: number, min: number, max: number): number {
    const v = Number.isFinite(x) ? x : min;
    return Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
}

function normalizeStyle(style: string | undefined): TrippyStyleName {
    return TRIPPY_STYLES.includes(style as TrippyStyleName)
        ? (style as TrippyStyleName)
        : 'confetti';
}

/** Clamp/quantize a skin paint so the cache key is stable across slider jitter. */
function normalizeSkin(sel: Partial<ActiveTrippySkin>): ActiveTrippySkin {
    return {
        style: normalizeStyle(sel.style),
        intensity: clampRound(sel.intensity ?? 1, 0, 1),
        scroll: clampRound(sel.scroll ?? 1, 0, 4),
        phase: clampRound(sel.phase ?? 0, 0, 1),
        targets: sel.targets === 'body' || sel.targets === 'weapons' ? sel.targets : 'all',
    };
}

// ---------------------------------------------------------------------------
// Preview sprites
// ---------------------------------------------------------------------------

/** Sprite frame/size bounds, matching the binary's clamps. */
const SPRITE_FRAME_BOUNDS = { min: 1, max: 48 } as const;
const SPRITE_SIZE_BOUNDS = { min: 16, max: 512 } as const;

function clampInt(x: number, min: number, max: number): number {
    const v = Number.isFinite(x) ? Math.round(x) : min;
    return Math.min(max, Math.max(min, v));
}

/**
 * Render (or reuse) one animated trippy preview sprite and return it as a PNG
 * data URL. Hero-independent, so the cache is shared across every hero panel;
 * params are quantized before keying so slider jitter can't spawn
 * near-duplicate renders.
 */
export async function previewTrippySprite(opts: TrippySpriteOptions): Promise<TrippySpriteResult> {
    vpkmergeBinaryPath(); // surface a clear error early if the binary is missing/old
    const style = normalizeStyle(opts.style);
    const phase = clampRound(opts.phase ?? 0, 0, 1);
    const scroll = clampRound(opts.scroll ?? 1, 0, 4);
    const intensity = clampRound(opts.intensity ?? 1, 0, 1);
    const frames = clampInt(opts.frames ?? 24, SPRITE_FRAME_BOUNDS.min, SPRITE_FRAME_BOUNDS.max);
    const size = clampInt(opts.size ?? 256, SPRITE_SIZE_BOUNDS.min, SPRITE_SIZE_BOUNDS.max);
    const colors = skinPartPatternSchema.shape.colors.parse(opts.colors)?.map((color) => color.toLowerCase());
    const scale = style === 'moo' ? skinPartPatternSchema.shape.scale.parse(opts.scale) ?? 1 : 1;

    const dir = join(app.getPath('userData'), 'trippy-previews');
    const key = `${style}_p${Math.round(phase * 100)}_s${Math.round(scroll * 100)}_i${Math.round(intensity * 100)}_f${frames}_x${size}_d${scale}${colors ? `_c${colors.map((color) => color.slice(1)).join('_')}` : ''}_v${TRIPPY_CACHE_VERSION}.png`;
    const cachePath = join(dir, key);

    if (!existsSync(cachePath)) {
        await fs.mkdir(dir, { recursive: true });
        const tmp = join(dir, `.sprite_${randomUUID()}.png`);
        try {
            await runVpkmerge([
                'trippy-preview',
                '--style',
                style,
                '--phase',
                String(phase),
                '--scroll',
                String(scroll),
                '--intensity',
                String(intensity),
                '--frames',
                String(frames),
                '--size',
                String(size),
                '--out',
                tmp,
                ...(colors ? ['--palette', colors.join(',')] : []),
                '--scale', String(scale),
            ]);
            await fs.rename(tmp, cachePath);
        } finally {
            await fs.unlink(tmp).catch(() => {});
        }
    }

    const png = await fs.readFile(cachePath);
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, frames, size };
}

// ---------------------------------------------------------------------------
// Skin paints (the managed pak04 VPK)
// ---------------------------------------------------------------------------

/** Current trippy-skin selection set (one per hero), from the synthetic key. */
function currentSkinSelections(): LockerTrippySkinSelection[] {
    return getModMetadata(LOCKER_TRIPPY_SKINS_KEY)?.lockerTrippySkins?.skins ?? [];
}

/** Applied trippy skins, for the Locker Overrides popup and its count badge. */
export function listAppliedTrippySkins(): LockerTrippySkinSelection[] {
    return currentSkinSelections();
}

/** Cache path for one hero's baked trippy-skin addon, keyed by the normalized
 *  paint + version (scales as integer percents, same as the colors caches). */
function skinCachePath(codename: string, s: ActiveTrippySkin): string {
    const dir = join(app.getPath('userData'), 'trippy-skins');
    const i = Math.round(s.intensity * 100);
    const sc = Math.round(s.scroll * 100);
    const p = Math.round(s.phase * 100);
    return join(
        dir,
        `${codename}_${s.style}_i${i}_s${sc}_p${p}_${s.targets}_v${TRIPPY_CACHE_VERSION}_dir.vpk`,
    );
}

/**
 * Ensure a hero's trippy-skin addon exists in the cache, baking it via
 * `vpkmerge trippy-skin` (reading the base skin from pak01) if missing. Bakes
 * to a temp file then renames, so an interrupted bake never leaves a partial
 * cache entry.
 */
async function ensureTrippySkinBake(
    pak01: string,
    codename: string,
    paint: ActiveTrippySkin,
): Promise<string> {
    const cachePath = skinCachePath(codename, paint);
    if (existsSync(cachePath)) return cachePath;

    const dir = join(app.getPath('userData'), 'trippy-skins');
    await fs.mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${codename}_${randomUUID()}_dir.vpk`);
    try {
        await runVpkmerge([
            'trippy-skin',
            '--hero',
            codename,
            '--vpk',
            pak01,
            '--style',
            paint.style,
            '--intensity',
            String(paint.intensity),
            '--scroll',
            String(paint.scroll),
            '--phase',
            String(paint.phase),
            '--targets',
            paint.targets,
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

/**
 * Rebuild the consolidated trippy-skins VPK from `desired`. Bakes each hero's
 * paint (cached) and folds them into the fixed pak04 slot; per-hero material
 * paths are codename-namespaced, so several heroes merge without collision.
 * Empty deletes the VPK + metadata. Mirrors rebuildLockerColors.
 */
async function rebuildTrippySkins(
    deadlockPath: string,
    desired: LockerTrippySkinSelection[],
): Promise<void> {
    const destPath = lockerTrippySkinsVpkPath(deadlockPath);

    // One selection per codename (last wins), so a re-apply replaces, not stacks.
    const byCodename = new Map<string, LockerTrippySkinSelection>();
    for (const sel of desired) byCodename.set(sel.heroCodename, sel);
    const valid = [...byCodename.values()];

    if (valid.length === 0) {
        await fs.unlink(destPath).catch(() => {});
        removeModMetadata(LOCKER_TRIPPY_SKINS_KEY);
        invalidateVpkParseCache(destPath);
        return;
    }

    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    if (!existsSync(pak01)) {
        throw new Error('Base game pak01_dir.vpk not found; check the Deadlock path in Settings.');
    }

    const caches: string[] = [];
    for (const sel of valid) {
        caches.push(await ensureTrippySkinBake(pak01, sel.heroCodename, normalizeSkin(sel)));
    }

    const grimoireDir = getGrimoirePath(deadlockPath);
    await fs.mkdir(grimoireDir, { recursive: true });

    if (caches.length === 1) {
        // Single hero: the cache IS the addon; copy it into the fixed slot
        // (copy, not rename, so the cache survives for the next rebuild).
        await fs.copyFile(caches[0], destPath);
    } else {
        const buildOut = join(grimoireDir, `.locker-trippy-build-${randomUUID()}.out.vpk`);
        try {
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

    const info: LockerTrippySkinsInfo = { skins: valid, rebuiltAt: new Date().toISOString() };
    setModMetadata(LOCKER_TRIPPY_SKINS_KEY, {
        modName: 'Locker Trippy Skins',
        lockerTrippySkins: info,
    });
}

/**
 * Apply a trippy skin paint to hero X, replacing any prior paint for that hero.
 * Bakes the paint (cached) and folds it into the managed trippy-skins VPK.
 */
export async function applyTrippySkin(
    deadlockPath: string,
    heroName: string,
    paint: Partial<ActiveTrippySkin>,
): Promise<ApplyTrippySkinResult> {
    vpkmergeBinaryPath(); // surface a clear error early if the binary is missing/old
    const codename = colorCodenameForHero(heroName);
    if (!codename) {
        throw new Error(`Trippy effects aren't available for ${heroName} yet.`);
    }
    ensureGrimoireConfigured(deadlockPath);

    const normalized = normalizeSkin(paint);
    const current = currentSkinSelections();
    const next: LockerTrippySkinSelection[] = [
        ...current.filter((s) => s.heroCodename !== codename),
        { heroName, heroCodename: codename, ...normalized, addedAt: new Date().toISOString() },
    ];
    await rebuildTrippySkins(deadlockPath, next);
    return normalized;
}

/** Remove hero X's trippy skin, reverting its materials to vanilla. */
export async function revertTrippySkin(
    deadlockPath: string,
    heroName: string,
): Promise<ApplyTrippySkinResult> {
    const reverted: ApplyTrippySkinResult = {
        style: null,
        intensity: null,
        scroll: null,
        phase: null,
        targets: null,
    };
    const codename = colorCodenameForHero(heroName);
    if (!codename) return reverted;
    ensureGrimoireConfigured(deadlockPath);

    const current = currentSkinSelections();
    if (current.length === 0) return reverted;
    const next = current.filter((s) => s.heroCodename !== codename);
    await rebuildTrippySkins(deadlockPath, next);
    return reverted;
}

/** The trippy skin currently applied for a hero, or null. */
export function getActiveTrippySkin(heroName: string): ActiveTrippySkin | null {
    const codename = colorCodenameForHero(heroName);
    if (!codename) return null;
    const sel = currentSkinSelections().find((s) => s.heroCodename === codename);
    return sel
        ? {
              style: sel.style,
              intensity: sel.intensity,
              scroll: sel.scroll,
              phase: sel.phase,
              targets: sel.targets,
          }
        : null;
}

/** Clear every applied trippy skin (rebuild to empty, deleting the VPK). */
export async function clearAllTrippySkins(deadlockPath: string): Promise<void> {
    await rebuildTrippySkins(deadlockPath, []);
}
