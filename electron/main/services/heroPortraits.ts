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
import { metaKeyFor } from './deadlock';
import { listInstalledUserVpks } from './modLibrary';
import { parseVpkDirectoryCached } from './vpk';
import { vpkmergeBinaryPath, runVpkmerge } from './modMerger';
import { getModMetadata } from './metadata';
import type { HeroPortrait } from '../../../src/types/portrait';

import { codenamesForHero } from './heroCodenames';
export { codenameForHero, codenamesForHero } from './heroCodenames';

function sanitize(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

/** User VPKs across Global, every addon folder, and `.disabled`, so a source
 *  remains discoverable after any placement or enable-state change. */
async function listAddonVpks(deadlockPath: string): Promise<string[]> {
    return (await listInstalledUserVpks(deadlockPath)).map((vpk) => vpk.path);
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
 * Scans every installed user VPK, cheaply pre-filters by the VPK file
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
