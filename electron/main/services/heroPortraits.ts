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
import { HERO_SOUND_CODENAMES } from './heroSoundCodenames';
import type { HeroPortrait } from '../../../src/types/portrait';

// Display name -> internal codename. Reverse of the sound-codename table; the
// panorama portrait paths use the same internal codename (e.g. Vindicta ->
// "hornet"), so this table doubles as the portrait codename lookup.
const CODENAME_BY_HERO: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(HERO_SOUND_CODENAMES).map(([codename, display]) => [display, codename])
);

/** Resolve a hero display name (e.g. "Vindicta") to its panorama/sound codename
 *  (e.g. "hornet"), or undefined when the name is unknown. Shared with the
 *  card-apply pipeline so both halves agree on the codename mapping. */
export function codenameForHero(heroName: string): string | undefined {
    return CODENAME_BY_HERO[heroName];
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
    const codename = codenameForHero(heroName);
    if (!codename) return [];
    // Surface a clear error early if the bundled binary is missing/too old.
    vpkmergeBinaryPath();

    const prefix = `panorama/images/heroes/${codename}`;
    const cacheRoot = join(app.getPath('userData'), 'portrait-cache');
    const vpks = await listAddonVpks(deadlockPath);

    const results: HeroPortrait[] = [];
    for (const vpk of vpks) {
        const tree = parseVpkDirectoryCached(vpk);
        if (!tree || !tree.some((p) => p.startsWith(prefix))) continue;

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
            console.warn(`[heroPortraits] skipping ${basename(vpk)}: ${String(err)}`);
        }
    }
    return results;
}
