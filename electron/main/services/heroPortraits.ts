/**
 * Hero portrait / card extraction (PROTOTYPE).
 *
 * Deadlock skins and icon packs ship hero portrait art under
 * `panorama/images/heroes/<codename>_<variant>`. This service finds which
 * installed mods carry that art for a given hero and shells out to the bundled
 * `vpkmerge portrait` subcommand to decode it to PNG, returning data URLs for
 * the Locker "pick your hero card" picker.
 *
 * Note: this only SURFACES the available card art. Actually applying a chosen
 * card to the game (splitting it out of its source mod and rolling it into the
 * load order) is a separate, not-yet-built step.
 */
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { app } from 'electron';
import { getAddonFolderPaths, getDisabledPath, metaKeyFor, getCitadelPath } from './deadlock';
import { parseVpkDirectoryCached } from './vpk';
import { vpkmergeBinaryPath, runVpkmerge } from './modMerger';
import { getModMetadata } from './metadata';
// HeroPoseSkinSource is imported from the shared portrait types (not from
// heroPoseModels) to avoid a cycle: heroPoseModels already imports
// codenamesForHero from this module.
import type { HeroPortrait, HeroBackdrop, HeroPoseSkinSource } from '../../../src/types/portrait';

// Display name -> panorama codename. This is the `class_name` namespace
// (deadlock-api `hero_<codename>`, stripped of the `hero_` prefix) that hero
// card art lives under as `panorama/images/heroes/<codename>_<variant>`.
//
// This deliberately does NOT reuse the sound-codename table (heroSoundCodenames
// .ts). That table is scoped to the ~35 heroes that ship ability sounds, so it
// (a) omits heroes whose only modded art is panorama cards (Doorman, Graves,
// Rem, Sinclair, Venator, Victor, Warden, Wraith) and (b) uses the sound-path
// codename, which diverges from the panorama/class_name codename for Abrams
// (sound `abrams` vs panorama `atlas`) and Mo & Krill (`mokrill` vs `krill`).
// Both bugs made the card picker silently return nothing for those heroes.
//
// Source of truth: assets.deadlock-api.com/v2/heroes `class_name`. Both
// "Doorman" (GameBanana's category name) and "The Doorman" (the API/roster
// name) are keyed so the lookup works whichever name flows in.
const PANORAMA_CODENAME_BY_HERO: Readonly<Record<string, string>> = {
    Abrams: 'atlas',
    Apollo: 'fencer',
    Bebop: 'bebop',
    Billy: 'punkgoat',
    Calico: 'nano',
    Celeste: 'unicorn',
    Doorman: 'doorman',
    'The Doorman': 'doorman',
    Drifter: 'drifter',
    Dynamo: 'dynamo',
    Graves: 'necro',
    'Grey Talon': 'orion',
    Haze: 'haze',
    Holliday: 'astro',
    Infernus: 'inferno',
    Ivy: 'tengu',
    Kelvin: 'kelvin',
    'Lady Geist': 'ghost',
    Lash: 'lash',
    McGinnis: 'forge',
    Mina: 'vampirebat',
    Mirage: 'mirage',
    'Mo & Krill': 'krill',
    Paige: 'bookworm',
    Paradox: 'chrono',
    Pocket: 'synth',
    Rem: 'familiar',
    Seven: 'gigawatt',
    Shiv: 'shiv',
    Silver: 'werewolf',
    Sinclair: 'magician',
    Venator: 'priest',
    Victor: 'frank',
    Vindicta: 'hornet',
    Viscous: 'viscous',
    Vyper: 'viper',
    Warden: 'warden',
    Wraith: 'wraith',
    Yamato: 'yamato',
};

// LEGACY panorama codenames. Six heroes were renamed during development; the
// deadlock-api `class_name` (above) is the current name, but a lot of shipped
// community icon packs (catlock, irl_hero_icons, "did you see that", ...) still
// author their card art under the OLD codename. Verified against the user's
// installed packs: e.g. "did_you_see_that_icons" ships `archer`/`engineer`/
// `bull`/`spectre`/`digger`/`sumo`, never `orion`/`forge`/`atlas`/`ghost`/
// `krill`/`dynamo`. We match BOTH so cards from old and new packs both show.
const PANORAMA_CODENAME_ALIASES: Readonly<Record<string, string[]>> = {
    'Grey Talon': ['archer'],
    McGinnis: ['engineer'],
    Abrams: ['bull'],
    'Lady Geist': ['spectre'],
    'Mo & Krill': ['digger'],
    Dynamo: ['sumo'],
};

/** Resolve a hero display name (e.g. "Vindicta") to its primary panorama
 *  codename (e.g. "hornet"), or undefined when the name is unknown. */
export function codenameForHero(heroName: string): string | undefined {
    return PANORAMA_CODENAME_BY_HERO[heroName];
}

/** Every panorama codename a hero's card art might be filed under: the current
 *  class_name first, then any legacy aliases. Empty when the name is unknown.
 *  Card scanning and apply both iterate this so neither old nor new packs are
 *  missed. */
export function codenamesForHero(heroName: string): string[] {
    const primary = PANORAMA_CODENAME_BY_HERO[heroName];
    if (!primary) return [];
    return [primary, ...(PANORAMA_CODENAME_ALIASES[heroName] ?? [])];
}

function sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/** Enabled addon VPKs across every addon folder (base citadel/addons plus any
 *  overflow addonsN) plus the ones parked in `.disabled/`, so a source that
 *  overflowed past slot 99 still surfaces in the picker. */
async function listAddonVpks(deadlockPath: string): Promise<string[]> {
    const vpks: string[] = [];
    for (const dir of [...getAddonFolderPaths(deadlockPath), getDisabledPath(deadlockPath)]) {
        let entries: string[];
        try {
            entries = await fs.readdir(dir);
        } catch {
            continue; // .disabled may not exist
        }
        for (const entry of entries) {
            if (entry.endsWith('_dir.vpk')) vpks.push(join(dir, entry));
        }
    }
    return vpks;
}

interface PortraitManifest {
    portraits: Array<{
        variant: string;
        width: number;
        height: number;
        format_name: string;
        output_path: string | null;
    }>;
}

/**
 * Decode every hero portrait/card the installed mods ship for `heroName`.
 *
 * Scans enabled + disabled addon VPKs, cheaply pre-filters by the VPK file
 * tree (reusing the cached parser so we don't re-read every pak), then shells
 * out to `vpkmerge portrait` only for VPKs that actually carry this hero's
 * panorama art.
 */
export async function getHeroPortraits(
    deadlockPath: string,
    heroName: string
): Promise<HeroPortrait[]> {
    const codenames = codenamesForHero(heroName);
    if (codenames.length === 0) return [];
    // Surface a clear error early if the bundled binary is missing/too old.
    vpkmergeBinaryPath();

    const cacheRoot = join(app.getPath('userData'), 'portrait-cache');
    const vpks = await listAddonVpks(deadlockPath);

    const results: HeroPortrait[] = [];
    for (const vpk of vpks) {
        // Identify the source by its folder-relative metaKey, not the bare
        // filename: once a user overflows, the same pakNN_dir.vpk name exists in
        // several folders, so the filename alone can't tell two sources apart
        // (the picker round-trips this value straight back into applyHeroCard).
        const metaKey = metaKeyFor(vpk);
        // Skip our own Locker-managed VPKs: the cosmetics VPK holds the
        // already-applied card, so decoding it would surface a duplicate tile of
        // whatever source it was built from (the source itself is still scanned
        // and stays the selectable, "Applied"-marked option). The sound VPK has
        // no card art, but is excluded on the same "managed artifact" grounds.
        const portraitMeta = getModMetadata(metaKey);
        if (portraitMeta?.lockerCosmetics || portraitMeta?.lockerSounds) continue;

        const tree = parseVpkDirectoryCached(vpk);
        if (!tree) continue;
        // A pack uses one codename per hero, but packs disagree on which (the
        // current class_name vs a legacy alias), so decode whichever this VPK
        // actually carries. Usually one; both is harmless.
        const matched = codenames.filter((c) =>
            tree.some((p) => p.startsWith(`panorama/images/heroes/${c}`))
        );
        if (matched.length === 0) continue;

        for (const codename of matched) {
            // Cache dir keyed by the unique metaKey so two same-named sources in
            // different folders don't clobber each other's decoded portraits.
            const outDir = join(cacheRoot, sanitize(metaKey), codename);
            const manifestPath = join(outDir, 'manifest.json');
            try {
                await runVpkmerge(
                    ['portrait', vpk, '--hero', codename, '--out', outDir, '--manifest', manifestPath],
                    60000
                );
                const manifest = JSON.parse(
                    await fs.readFile(manifestPath, 'utf-8')
                ) as PortraitManifest;
                for (const p of manifest.portraits) {
                    if (!p.output_path) continue;
                    const png = await fs.readFile(p.output_path);
                    results.push({
                        modFileName: metaKey,
                        variant: p.variant,
                        width: p.width,
                        height: p.height,
                        formatName: p.format_name,
                        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
                    });
                }
            } catch (err) {
                // One malformed VPK shouldn't sink the whole picker.
                console.warn(`[heroPortraits] skipping ${basename(vpk)} (${codename}): ${String(err)}`);
            }
        }
    }
    return results;
}

/** Variant preference for a card BACKDROP: the full hero-select cover art
 *  first, then the tall portrait, then the situational card variants, then
 *  whatever the source carries. (Excludes the tiny minimap/small icons, which
 *  make poor backdrops; they're only used as a last resort below.) */
const BACKDROP_VARIANT_PRIORITY = ['card', 'vertical', 'card_gloat', 'card_critical'];

function pickBackdropVariant(portraits: HeroPortrait[]): HeroPortrait | null {
    for (const variant of BACKDROP_VARIANT_PRIORITY) {
        const hit = portraits.find((p) => p.variant === variant);
        if (hit) return hit;
    }
    // Fall back to any decoded variant (e.g. a pack that ships only `other`).
    return portraits[0] ?? null;
}

/**
 * Decode the panorama card art a single VPK carries for one codename. Mirrors
 * the inner loop of getHeroPortraits but standalone (no managed-VPK skipping):
 * the caller chooses exactly which VPK to read. Returns [] when the VPK doesn't
 * carry this codename's art or decoding fails (logged, never throws), so the
 * caller can fall through to the next candidate.
 */
async function decodeHeroPanorama(
    vpk: string,
    codename: string,
    sourceId: string
): Promise<HeroPortrait[]> {
    const tree = parseVpkDirectoryCached(vpk);
    if (!tree || !tree.some((p) => p.startsWith(`panorama/images/heroes/${codename}`))) return [];

    const outDir = join(app.getPath('userData'), 'portrait-cache', sanitize(sourceId), codename);
    const manifestPath = join(outDir, 'manifest.json');
    const out: HeroPortrait[] = [];
    try {
        await runVpkmerge(
            ['portrait', vpk, '--hero', codename, '--out', outDir, '--manifest', manifestPath],
            60000
        );
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as PortraitManifest;
        for (const p of manifest.portraits) {
            if (!p.output_path) continue;
            const png = await fs.readFile(p.output_path);
            out.push({
                modFileName: sourceId,
                variant: p.variant,
                width: p.width,
                height: p.height,
                formatName: p.format_name,
                dataUrl: `data:image/png;base64,${png.toString('base64')}`,
            });
        }
    } catch (err) {
        console.warn(
            `[heroPortraits] panorama backdrop decode failed for ${basename(vpk)} (${codename}): ${String(err)}`
        );
    }
    return out;
}

function toBackdrop(p: HeroPortrait, source: 'skin' | 'vanilla'): HeroBackdrop {
    return { dataUrl: p.dataUrl, width: p.width, height: p.height, variant: p.variant, source };
}

/**
 * Resolve the panorama card art to use as the backdrop behind a hero's baked 3D
 * card snapshot.
 *
 * Preference order:
 *   1. The active skin stack's OWN card art, highest priority first (a skin that
 *      ships its own `panorama/images/heroes/<codename>_card` wins). Most body
 *      skins don't, so this usually misses.
 *   2. The base game's vanilla card art from pak01 (the chosen fallback).
 *
 * Returns null only when the hero is unknown or neither source carries any
 * panorama art (the bake then renders the model on a plain backdrop).
 */
export async function getHeroPanoramaBackdrop(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[] = []
): Promise<HeroBackdrop | null> {
    const codenames = codenamesForHero(heroName);
    if (codenames.length === 0) return null;
    vpkmergeBinaryPath(); // fail fast with a clear error if the binary is missing/old

    // 1) The active skin stack's own card art (highest priority first).
    const installed = await listAddonVpks(deadlockPath);
    const byMetaKey = new Map(installed.map((vpk) => [metaKeyFor(vpk), vpk]));
    const orderedSkinVpks = [...skinSources]
        .sort((a, b) => b.priority - a.priority)
        .map((source) => byMetaKey.get(source.metaKey))
        .filter((vpk): vpk is string => Boolean(vpk));

    for (const vpk of orderedSkinVpks) {
        for (const codename of codenames) {
            const pick = pickBackdropVariant(await decodeHeroPanorama(vpk, codename, metaKeyFor(vpk)));
            if (pick) return toBackdrop(pick, 'skin');
        }
    }

    // 2) Vanilla fallback from the base pak.
    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    for (const codename of codenames) {
        const pick = pickBackdropVariant(await decodeHeroPanorama(pak01, codename, 'vanilla'));
        if (pick) return toBackdrop(pick, 'vanilla');
    }

    return null;
}
