/**
 * Custom hero-card UPLOAD pipeline.
 *
 * The Locker "Hero Card" picker (heroCards.ts) lets a user choose card art their
 * installed mods ship. This module adds the other source: the user's own PNGs.
 *
 * Deadlock card art is one `.vtex_c` per variant under
 * `panorama/images/heroes/<codename>_<variant>_(psd or png).vtex_c`, each at a
 * fixed size. Rather than encode a `.vtex_c` from scratch, we reuse the base
 * game's own texture as a template: `vpkmerge icon` reads the base entry for its
 * format and dimensions, resizes the user's PNG to match, and splices it in
 * (see vpkmerge's `icon` subcommand / `morphic::replace_mip_chain`). The result
 * is packed into a persistent per-hero staging VPK under userData, then folded
 * into the single Locker cosmetics VPK by the same `rebuildLockerCosmetics` path
 * an installed-mod card uses, so custom and mod cards compose identically.
 */
import { promises as fs, existsSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import {
    runVpkmerge,
    vpkmergeBinaryPath,
    verifyVpkOutput,
} from './modMerger';
import { codenamesForHero } from './heroPortraits';
import {
    baseCardPakPath,
    customCardVpkPath,
    currentCardSelections,
    rebuildLockerCosmetics,
} from './heroCards';
import { ensureGrimoireConfigured, migrateManagedVpksToGrimoire } from './lockerVpk';
import { invalidateVpkParseCache } from './vpk';
import { fingerprintFile } from './fileMatch';
import type { ApplyHeroCardResult, LockerCardSelection } from '../../../src/types/mod';
import type { CustomCardSlot } from '../../../src/types/portrait';

/** One variant slot the user fills with a PNG. `dataUrl` is a `data:image/png`
 *  base64 URL (the cropper output, already at the variant's target aspect); an
 *  empty/absent dataUrl means "leave this variant default". */
export interface CustomCardVariantUpload {
    variant: string;
    dataUrl: string;
}

/** Largest accepted decoded image, a guard against a runaway IPC payload. Card
 *  PNGs are a few KB, so this is generous headroom, not a real limit. */
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** Decode a `data:image/png;base64,...` URL to PNG bytes, validating the shape,
 *  the size, and the PNG magic so a bad payload fails clearly here, not deep in
 *  vpkmerge. Returns the raw bytes for a temp file the `icon` build reads. */
function decodePngDataUrl(dataUrl: string, variant: string): Buffer {
    const match = /^data:image\/png;base64,(.+)$/s.exec(dataUrl);
    if (!match) {
        throw new Error(`The "${variant}" image must be a PNG data URL.`);
    }
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length === 0) throw new Error(`The "${variant}" image is empty.`);
    if (bytes.length > MAX_IMAGE_BYTES) {
        throw new Error(`The "${variant}" image is too large (max 32 MB).`);
    }
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A.
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(sig)) {
        throw new Error(`The "${variant}" image is not a valid PNG.`);
    }
    return bytes;
}

/** Display/sort order for variant slots (full card first, then by prominence). */
const VARIANT_ORDER = ['card', 'vertical', 'card_critical', 'card_gloat', 'minimap', 'small', 'other'];
function variantRank(variant: string): number {
    const i = VARIANT_ORDER.indexOf(variant);
    return i === -1 ? VARIANT_ORDER.length : i;
}

interface BasePortraitManifest {
    portraits: Array<{
        variant: string;
        width: number;
        height: number;
        source_path: string;
        output_path: string | null;
    }>;
}

/**
 * The uploadable variant slots for a hero, derived from the base game's own card
 * art: one slot per variant `pak01_dir.vpk` ships, carrying the template entry
 * path, the dimensions an upload will be resized to, and a decoded preview of
 * the default art. Returns the first codename that yields art (packs use one).
 */
export async function getCustomCardSlots(
    deadlockPath: string,
    heroName: string
): Promise<CustomCardSlot[]> {
    vpkmergeBinaryPath(); // clear error early if the binary is missing/too old
    const codenames = codenamesForHero(heroName);
    if (codenames.length === 0) return [];

    const basePak = baseCardPakPath(deadlockPath);
    if (!existsSync(basePak)) {
        throw new Error(`Base game pak not found at ${basePak}.`);
    }

    const cacheRoot = join(app.getPath('userData'), 'custom-card-slots');
    for (const codename of codenames) {
        const outDir = join(cacheRoot, codename);
        const manifestPath = join(outDir, 'manifest.json');
        try {
            await runVpkmerge(
                ['portrait', basePak, '--hero', codename, '--out', outDir, '--manifest', manifestPath],
                60000
            );
            const manifest = JSON.parse(
                await fs.readFile(manifestPath, 'utf-8')
            ) as BasePortraitManifest;
            const slots: CustomCardSlot[] = [];
            for (const p of manifest.portraits) {
                if (!p.output_path || !p.source_path) continue;
                const png = await fs.readFile(p.output_path);
                slots.push({
                    variant: p.variant,
                    entry: p.source_path,
                    width: p.width,
                    height: p.height,
                    baseDataUrl: `data:image/png;base64,${png.toString('base64')}`,
                });
            }
            if (slots.length > 0) {
                return slots.sort((a, b) => variantRank(a.variant) - variantRank(b.variant));
            }
        } catch (err) {
            console.warn(`[customHeroCards] base slots for ${codename}: ${String(err)}`);
        }
    }
    return [];
}

/**
 * Build a standalone custom-card addon VPK at `outPath` from `uploads` (one PNG
 * per variant), using each variant's base-game texture as the template. Shared
 * by apply (out = staging VPK) and export (out = a user-chosen file). Returns
 * the variants actually written.
 */
async function buildCustomCardVpk(
    deadlockPath: string,
    heroName: string,
    uploads: CustomCardVariantUpload[],
    outPath: string
): Promise<string[]> {
    vpkmergeBinaryPath();
    const provided = uploads.filter((u) => u.dataUrl);
    if (provided.length === 0) throw new Error('Upload at least one card image.');

    // Map each chosen variant to the base template entry (+ verifies the variant
    // is one the base game actually ships, so the dimensions are knowable).
    const slots = await getCustomCardSlots(deadlockPath, heroName);
    if (slots.length === 0) {
        throw new Error(`No base card art found for ${heroName} to use as a template.`);
    }
    const slotByVariant = new Map(slots.map((s) => [s.variant, s]));

    const basePak = baseCardPakPath(deadlockPath);
    await fs.mkdir(dirname(outPath), { recursive: true });

    // Decode each upload to a temp PNG the `icon` build reads, then clean them
    // up regardless of outcome. Temp files live beside the output so the build
    // never crosses a filesystem boundary.
    const tmpDir = join(dirname(outPath), `.build-${randomUUID()}`);
    await fs.mkdir(tmpDir, { recursive: true });
    try {
        const sets: string[] = [];
        for (const u of provided) {
            const slot = slotByVariant.get(u.variant);
            if (!slot) throw new Error(`No base template for the "${u.variant}" card variant.`);
            const bytes = decodePngDataUrl(u.dataUrl, u.variant);
            const pngPath = join(tmpDir, `${u.variant}.png`);
            await fs.writeFile(pngPath, bytes);
            sets.push(`${slot.entry}=${pngPath}`);
        }

        const args = ['icon', '--template-vpk', basePak];
        for (const set of sets) {
            args.push('--set', set);
        }
        args.push('--encode-vpk', outPath);
        await runVpkmerge(args, 120000);
    } finally {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    await verifyVpkOutput(outPath);
    return provided.map((u) => u.variant);
}

/**
 * Build a custom card from `uploads` (one PNG per variant), pack it into this
 * hero's staging VPK, register it as a custom selection, and rebuild the
 * consolidated cosmetics VPK. Replaces any prior card (mod or custom) for the
 * hero, exactly like applyHeroCard.
 */
export async function applyCustomHeroCard(
    deadlockPath: string,
    heroName: string,
    uploads: CustomCardVariantUpload[]
): Promise<ApplyHeroCardResult> {
    ensureGrimoireConfigured(deadlockPath);
    const codenames = codenamesForHero(heroName);
    if (codenames.length === 0) throw new Error(`Unknown hero: ${heroName}`);
    const primaryCodename = codenames[0];
    await migrateManagedVpksToGrimoire(deadlockPath);

    const stagingPath = customCardVpkPath(deadlockPath, primaryCodename);
    const variants = await buildCustomCardVpk(deadlockPath, heroName, uploads, stagingPath);
    invalidateVpkParseCache(stagingPath);

    const fp = await fingerprintFile(stagingPath);
    const fileName = `custom:${primaryCodename}`;
    const selection: LockerCardSelection = {
        heroCodename: primaryCodename,
        heroName,
        variants,
        source: {
            kind: 'custom',
            fileName,
            modName: 'Custom upload',
            sha256AtApplyTime: fp.sha256,
        },
        addedAt: new Date().toISOString(),
    };

    const current = await currentCardSelections(deadlockPath);
    const next = [...current.filter((c) => c.heroCodename !== primaryCodename), selection];
    const { missing } = await rebuildLockerCosmetics(deadlockPath, next);
    return {
        activeSourceFileName: missing.includes(fileName) ? null : fileName,
        missingSourceFileNames: missing,
    };
}

/**
 * Build the custom card as a standalone addon VPK at `destPath` (a user-chosen
 * file), without applying it. The exported VPK is self-contained: dropping it
 * into citadel/addons overrides those card variants in place. Returns the path.
 */
export async function exportCustomHeroCard(
    deadlockPath: string,
    heroName: string,
    uploads: CustomCardVariantUpload[],
    destPath: string
): Promise<string> {
    if (!destPath) throw new Error('No export path chosen.');
    await buildCustomCardVpk(deadlockPath, heroName, uploads, destPath);
    return destPath;
}

/**
 * The images of the custom card currently applied for `heroName`, decoded back
 * to data URLs from this hero's staging VPK on disk. Empty unless a custom card
 * is applied. Lets the picker repopulate the user's uploaded art after an app
 * restart (the applied card persists on disk; this re-surfaces it in the UI).
 */
export async function getAppliedCustomCard(
    deadlockPath: string,
    heroName: string
): Promise<{ variant: string; dataUrl: string }[]> {
    const codenames = codenamesForHero(heroName);
    if (codenames.length === 0) return [];
    const primaryCodename = codenames[0];

    // Only surface images when a custom card is actually the active selection.
    const selections = await currentCardSelections(deadlockPath);
    const sel = selections.find(
        (c) => c.heroCodename === primaryCodename && c.source.kind === 'custom'
    );
    if (!sel) return [];

    const stagingPath = customCardVpkPath(deadlockPath, primaryCodename);
    if (!existsSync(stagingPath)) return [];

    vpkmergeBinaryPath();
    const cacheRoot = join(app.getPath('userData'), 'custom-card-applied');
    for (const codename of codenames) {
        const outDir = join(cacheRoot, primaryCodename, codename);
        const manifestPath = join(outDir, 'manifest.json');
        try {
            await runVpkmerge(
                ['portrait', stagingPath, '--hero', codename, '--out', outDir, '--manifest', manifestPath],
                60000
            );
            const manifest = JSON.parse(
                await fs.readFile(manifestPath, 'utf-8')
            ) as BasePortraitManifest;
            const out: { variant: string; dataUrl: string }[] = [];
            for (const p of manifest.portraits) {
                if (!p.output_path) continue;
                const png = await fs.readFile(p.output_path);
                out.push({
                    variant: p.variant,
                    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
                });
            }
            if (out.length > 0) {
                return out.sort((a, b) => variantRank(a.variant) - variantRank(b.variant));
            }
        } catch (err) {
            console.warn(`[customHeroCards] applied images for ${codename}: ${String(err)}`);
        }
    }
    return [];
}
