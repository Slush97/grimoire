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
import { cardArtSets, codenamesForHero } from './heroCodenames';
import type { HeroPortrait } from '../../../src/types/portrait';

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
        source_path: string;
        output_path: string | null;
    }>;
}

/** One card texture `vpkmerge portrait` decoded to a PNG on disk. */
export interface DecodedCardArt {
    variant: string;
    width: number;
    height: number;
    formatName: string;
    sourcePath: string;
    outputPath: string;
}

/**
 * Decode all of one codename's card art in a VPK to PNGs under `cacheDir`,
 * alternate forms included. A set that fails to decode is logged and skipped so
 * it can't sink the others.
 */
export async function decodeHeroCardArt(
    vpkPath: string,
    codename: string,
    cacheDir: string
): Promise<DecodedCardArt[]> {
    const decoded: DecodedCardArt[] = [];
    for (const set of cardArtSets(parseVpkDirectoryCached(vpkPath) ?? [], codename)) {
        const outDir = join(cacheDir, set.codename);
        const manifestPath = join(outDir, 'manifest.json');
        try {
            await runVpkmerge(
                ['portrait', vpkPath, '--hero', set.codename, '--out', outDir, '--manifest', manifestPath],
                60000
            );
            const manifest = JSON.parse(
                await fs.readFile(manifestPath, 'utf-8')
            ) as PortraitManifest;
            for (const p of manifest.portraits) {
                if (!p.output_path) continue;
                decoded.push({
                    variant: `${set.variantPrefix}${p.variant}`,
                    width: p.width,
                    height: p.height,
                    formatName: p.format_name,
                    sourcePath: p.source_path,
                    outputPath: p.output_path,
                });
            }
        } catch (err) {
            console.warn(`[heroPortraits] skipping ${basename(vpkPath)} (${set.codename}): ${String(err)}`);
        }
    }
    return decoded;
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
            const art = await decodeHeroCardArt(vpk, codename, join(cacheRoot, sanitize(metaKey)));
            for (const p of art) {
                const png = await fs.readFile(p.outputPath);
                results.push({
                    modFileName: metaKey,
                    variant: p.variant,
                    width: p.width,
                    height: p.height,
                    formatName: p.formatName,
                    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
                });
            }
        }
    }
    return results;
}
