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

// Display name -> hero-select BACKGROUND codename. The clean full-bleed scene
// art (no character) lives at `panorama/images/heroes/backgrounds/<codename>_bg`
// and is the natural backdrop for a composited 3D render. This is a THIRD
// codename namespace, distinct from BOTH the card-art class_name above AND the
// body-model basename (heroPoseModels): e.g. Paige's card is `bookworm`, model
// `bookworm`, but background `patience`; Abrams card `atlas`, model `abrams`,
// background `abrams`. Extracted from base pak01's
// `panorama/images/heroes/backgrounds/*_bg_psd.vtex_c` set (39 heroes + a
// `generic` fallback). Both Doorman spellings keyed like the card map.
const BACKGROUND_CODENAME_BY_HERO: Readonly<Record<string, string>> = {
    Abrams: 'abrams',
    Apollo: 'fencer',
    Bebop: 'bebop',
    Billy: 'billy',
    Calico: 'calico',
    Celeste: 'unicorn',
    Doorman: 'doorman',
    'The Doorman': 'doorman',
    Drifter: 'drifter',
    Dynamo: 'dynamo',
    Graves: 'necro',
    'Grey Talon': 'grey_talon',
    Haze: 'haze',
    Holliday: 'astro',
    Infernus: 'infernus',
    Ivy: 'ivy',
    Kelvin: 'kelvin',
    'Lady Geist': 'geist',
    Lash: 'lash',
    McGinnis: 'mcginnis',
    Mina: 'mina',
    Mirage: 'mirage',
    'Mo & Krill': 'krill',
    Paige: 'patience',
    Paradox: 'paradox',
    Pocket: 'pocket',
    Rem: 'familiar',
    Seven: 'seven',
    Shiv: 'shiv',
    Silver: 'werewolf',
    Sinclair: 'magician',
    Venator: 'priest',
    Victor: 'victor',
    Vindicta: 'vindicta',
    Viscous: 'viscous',
    Vyper: 'vyper',
    Warden: 'warden',
    Wraith: 'wraith',
    Yamato: 'yamato',
};

/** The base game's universal fallback background (a generic scene with no hero),
 *  used when a hero has no known background codename or its `_bg` can't decode. */
const GENERIC_BACKGROUND_CODENAME = 'generic';

/** Resolve a hero display name (e.g. "Vindicta") to its primary panorama
 *  codename (e.g. "hornet"), or undefined when the name is unknown. */
export function codenameForHero(heroName: string): string | undefined {
    return PANORAMA_CODENAME_BY_HERO[heroName];
}

/** Resolve a hero display name to its hero-select background codename (e.g.
 *  "Paige" -> "patience"), or undefined when unknown. */
export function backgroundCodenameForHero(heroName: string): string | undefined {
    return BACKGROUND_CODENAME_BY_HERO[heroName];
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

/**
 * Decode the hero-select BACKGROUND a single VPK carries for one background
 * codename (`panorama/images/heroes/backgrounds/<codename>_bg`). The caller
 * chooses exactly which VPK to read. Returns the decoded `background`-variant
 * portrait, or null when the VPK doesn't carry it or decoding fails (logged,
 * never throws), so the caller can fall through to the next candidate.
 *
 * `vpkmerge portrait --hero <codename>` matches the `backgrounds/` subfolder by
 * the bg codename (the `Background` variant landed in vpkmerge for exactly this
 * use); we still filter the manifest to that variant in case a future pack
 * happens to share a codename across art kinds.
 */
async function decodeHeroBackground(
    vpk: string,
    bgCodename: string,
    sourceId: string
): Promise<HeroPortrait | null> {
    const tree = parseVpkDirectoryCached(vpk);
    if (
        !tree ||
        !tree.some((p) => p.startsWith(`panorama/images/heroes/backgrounds/${bgCodename}`))
    ) {
        return null;
    }

    const outDir = join(
        app.getPath('userData'),
        'portrait-cache',
        sanitize(sourceId),
        `bg_${bgCodename}`
    );
    const manifestPath = join(outDir, 'manifest.json');
    try {
        await runVpkmerge(
            ['portrait', vpk, '--hero', bgCodename, '--out', outDir, '--manifest', manifestPath],
            60000
        );
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as PortraitManifest;
        const bg = manifest.portraits.find((p) => p.variant === 'background' && p.output_path);
        if (!bg?.output_path) return null;
        const png = await fs.readFile(bg.output_path);
        return {
            modFileName: sourceId,
            variant: bg.variant,
            width: bg.width,
            height: bg.height,
            formatName: bg.format_name,
            dataUrl: `data:image/png;base64,${png.toString('base64')}`,
        };
    } catch (err) {
        console.warn(
            `[heroPortraits] background decode failed for ${basename(vpk)} (${bgCodename}): ${String(err)}`
        );
        return null;
    }
}

function toBackdrop(p: HeroPortrait, source: 'skin' | 'vanilla'): HeroBackdrop {
    return { dataUrl: p.dataUrl, width: p.width, height: p.height, variant: p.variant, source };
}

/**
 * Resolve the hero-select BACKGROUND to use as the backdrop behind a hero's
 * baked 3D card snapshot: the clean full-bleed scene art (no character), under
 * `panorama/images/heroes/backgrounds/<bg-codename>_bg`.
 *
 * Preference order:
 *   1. The active skin stack's OWN background, highest priority first (an icon/
 *      background pack like Paige's ships its own `_bg`). Most body skins don't,
 *      so this usually misses.
 *   2. The base game's vanilla background for this hero from pak01.
 *   3. The base game's `generic` background (a hero-less scene) as a last resort.
 *
 * Returns null only when no background can be decoded at all (the bake then
 * renders the model on a plain backdrop). NOTE: this intentionally uses the
 * background art, NOT the `_card` portrait (which bakes a character into the
 * image) the picker offers for user-chosen card images.
 */
export async function getHeroPanoramaBackdrop(
    deadlockPath: string,
    heroName: string,
    skinSources: HeroPoseSkinSource[] = []
): Promise<HeroBackdrop | null> {
    const bgCodename = backgroundCodenameForHero(heroName);
    vpkmergeBinaryPath(); // fail fast with a clear error if the binary is missing/old

    // 1) The active skin stack's own background (highest priority first).
    if (bgCodename) {
        const installed = await listAddonVpks(deadlockPath);
        const byMetaKey = new Map(installed.map((vpk) => [metaKeyFor(vpk), vpk]));
        const orderedSkinVpks = [...skinSources]
            .sort((a, b) => b.priority - a.priority)
            .map((source) => byMetaKey.get(source.metaKey))
            .filter((vpk): vpk is string => Boolean(vpk));

        for (const vpk of orderedSkinVpks) {
            const pick = await decodeHeroBackground(vpk, bgCodename, metaKeyFor(vpk));
            if (pick) return toBackdrop(pick, 'skin');
        }
    }

    // 2) Vanilla per-hero background, then 3) the generic scene, both from pak01.
    const pak01 = join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
    for (const codename of [bgCodename, GENERIC_BACKGROUND_CODENAME]) {
        if (!codename) continue;
        const pick = await decodeHeroBackground(pak01, codename, 'vanilla');
        if (pick) return toBackdrop(pick, 'vanilla');
    }

    return null;
}
