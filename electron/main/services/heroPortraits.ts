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
import { getAddonsPath } from './deadlock';
import { parseVpkDirectoryCached } from './vpk';
import { vpkmergeBinaryPath, runVpkmerge } from './modMerger';
import { getModMetadata } from './metadata';
import type { HeroPortrait } from '../../../src/types/portrait';

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

/** Enabled addon VPKs plus the ones parked in `.disabled/`. */
async function listAddonVpks(deadlockPath: string): Promise<string[]> {
    const addonsPath = getAddonsPath(deadlockPath);
    const vpks: string[] = [];
    for (const dir of [addonsPath, join(addonsPath, '.disabled')]) {
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
        // Skip our own Locker-managed VPKs: the cosmetics VPK holds the
        // already-applied card, so decoding it would surface a duplicate tile of
        // whatever source it was built from (the source itself is still scanned
        // and stays the selectable, "Applied"-marked option). The sound VPK has
        // no card art, but is excluded on the same "managed artifact" grounds.
        const portraitMeta = getModMetadata(basename(vpk));
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
            const outDir = join(cacheRoot, sanitize(basename(vpk)), codename);
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
                        modFileName: basename(vpk),
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
