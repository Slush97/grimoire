/**
 * Hero card APPLY pipeline.
 *
 * The Locker "Hero Card" picker lets a user choose alternative card art
 * (`panorama/images/heroes/<codename>_<variant>`) per hero, independent of skin
 * selection. Every applied card lives in ONE Locker-managed cosmetics VPK,
 * rebuilt from a selection set on each apply/revert, slotted at a low pakNN so
 * it wins Deadlock's lowest-pakNN-wins collision against any skin or icon pack
 * that ships the same card path. See docs/locker-hero-card-apply.md.
 *
 * The card files are extracted byte-for-byte with `vpkmerge split` (the raw
 * `.vtex_c` the game loads). Decoding to PNG (`vpkmerge portrait`) is only for
 * the preview grid in heroPortraits.ts.
 */
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { getAddonsPath, getDisabledPath } from './deadlock';
import { parseVpkDirectoryCached, invalidateVpkParseCache } from './vpk';
import {
    runVpkmerge,
    vpkmergeBinaryPath,
    verifyVpkOutput,
    reserveOutputSlot,
} from './modMerger';
import { findNextAvailablePriority } from './mods';
import { pinLockerVpksToFront } from './lockerVpk';
import { getModMetadata, setModMetadata, removeModMetadata } from './metadata';
import { fingerprintFile } from './fileMatch';
import { codenamesForHero } from './heroPortraits';
import type {
    ApplyHeroCardResult,
    LockerCardSelection,
    LockerCosmeticsInfo,
} from '../../../src/types/mod';

const PANORAMA_HERO_PREFIX = 'panorama/images/heroes/';

/** Split predicate / collision prefix for one hero's card art. The trailing
 *  underscore keeps `hornet_` from leaking into a hero whose codename shares a
 *  stem and matches the `<codename>_<variant>` / `<codename>_card_psd/`
 *  conventions. */
function cardPrefix(codename: string): string {
    return `${PANORAMA_HERO_PREFIX}${codename}_`;
}

interface VpkRef {
    fileName: string;
    path: string;
    enabled: boolean;
}

/** Enabled addon VPKs plus the ones parked in `.disabled/`. */
async function listAddonVpks(deadlockPath: string): Promise<VpkRef[]> {
    const out: VpkRef[] = [];
    const folders: Array<[string, boolean]> = [
        [getAddonsPath(deadlockPath), true],
        [getDisabledPath(deadlockPath), false],
    ];
    for (const [dir, enabled] of folders) {
        let entries: string[];
        try {
            entries = await fs.readdir(dir);
        } catch {
            continue; // .disabled may not exist
        }
        for (const entry of entries) {
            if (entry.toLowerCase().endsWith('_dir.vpk')) {
                out.push({ fileName: entry, path: join(dir, entry), enabled });
            }
        }
    }
    return out;
}

/** The single Locker cosmetics VPK (the one whose metadata carries the
 *  `lockerCosmetics` manifest), or null when no card has ever been applied. */
function findCosmeticsVpk(
    vpks: VpkRef[]
): { ref: VpkRef; info: LockerCosmeticsInfo } | null {
    for (const v of vpks) {
        const info = getModMetadata(v.fileName)?.lockerCosmetics;
        if (info) return { ref: v, info };
    }
    return null;
}

/** Locate a source VPK by filename, falling back to content hash if reconcile
 *  renamed it since apply time (same recovery unmergeMod uses). */
async function locateSource(
    vpks: VpkRef[],
    fileName: string,
    sha256?: string
): Promise<VpkRef | null> {
    const byName = vpks.find((v) => v.fileName === fileName);
    if (byName) return byName;
    if (!sha256) return null;
    const wanted = sha256.toLowerCase();
    for (const v of vpks) {
        try {
            const fp = await fingerprintFile(v.path);
            if (fp.sha256.toLowerCase() === wanted) return v;
        } catch {
            // unreadable VPK; keep looking
        }
    }
    return null;
}

/** Every card prefix a hero's art might be filed under (current class_name +
 *  legacy aliases). */
function heroCardPrefixes(heroName: string): string[] {
    return codenamesForHero(heroName).map(cardPrefix);
}

/** Paths under any of this hero's card prefixes that the VPK actually ships.
 *  Matched case-insensitively (Deadlock VPK paths are lowercase by convention). */
function heroCardPaths(vpkPath: string, heroName: string): string[] {
    const tree = parseVpkDirectoryCached(vpkPath);
    if (!tree) return [];
    const prefixes = heroCardPrefixes(heroName);
    return tree.filter((p) => prefixes.some((pre) => p.toLowerCase().startsWith(pre)));
}

/** Distinct variant tokens (card, vertical, mm, ...) derived from the matched
 *  card filenames. Informational for the manifest; the split takes the whole
 *  per-hero prefix regardless. */
function variantsFor(cardPaths: string[], heroName: string): string[] {
    const leads = codenamesForHero(heroName).map((c) => `${c}_`);
    const variants = new Set<string>();
    for (const p of cardPaths) {
        const base = (p.split('/').pop() ?? '').toLowerCase().replace(/\.[^.]+$/, '');
        const lead = leads.find((l) => base.startsWith(l));
        if (lead) {
            const v = base.slice(lead.length);
            if (v) variants.add(v);
        }
    }
    return [...variants];
}

interface RebuildResult {
    /** Final cosmetics VPK filename, or null when the set emptied (deleted). */
    fileName: string | null;
    /** Source filenames dropped because the VPK was gone at rebuild time. */
    missing: string[];
}

/**
 * Rebuild the consolidated Locker cosmetics VPK from `desired` selections.
 * Apply/revert are just "edit the set, then rebuild". Split each source down to
 * its hero's card prefix, combine the disjoint chunks into one VPK, swap it in,
 * and slot it below any enabled competitor for the same card path.
 */
async function rebuildLockerCosmetics(
    deadlockPath: string,
    desired: LockerCardSelection[]
): Promise<RebuildResult> {
    const addonsPath = getAddonsPath(deadlockPath);
    const vpks = await listAddonVpks(deadlockPath);
    const existing = findCosmeticsVpk(vpks);

    // Resolve each selection's source (relocating by hash if renamed) and
    // confirm it still ships this hero's cards. Anything unresolved is dropped.
    const valid: LockerCardSelection[] = [];
    const missing: string[] = [];
    for (const sel of desired) {
        const src = await locateSource(vpks, sel.source.fileName, sel.source.sha256AtApplyTime);
        if (!src || heroCardPaths(src.path, sel.heroName).length === 0) {
            missing.push(sel.source.fileName);
            continue;
        }
        valid.push({ ...sel, source: { ...sel.source, fileName: src.fileName } });
    }

    // Empty set: tear down the cosmetics VPK entirely.
    if (valid.length === 0) {
        if (existing) {
            await fs.unlink(existing.ref.path).catch(() => {});
            removeModMetadata(existing.ref.fileName);
            invalidateVpkParseCache(existing.ref.path);
        }
        return { fileName: null, missing };
    }

    // Build artifacts live in the addons dir as dotfiles (not `_dir.vpk`, so
    // scanMods ignores them) to keep every rename same-filesystem. Plans go to
    // userData. Everything here is cleaned up in the finally block.
    const tag = `.locker-cards-build-${randomUUID()}`;
    const planDir = join(app.getPath('userData'), 'locker-cosmetics-build', randomUUID());
    const buildOut = join(addonsPath, `${tag}.out.vpk`);
    const chunkPaths: string[] = [];
    try {
        await fs.mkdir(planDir, { recursive: true });
        for (let i = 0; i < valid.length; i++) {
            const sel = valid[i];
            const src = vpks.find((v) => v.fileName === sel.source.fileName)!;
            const chunkPath = join(addonsPath, `${tag}.chunk${i}.vpk`);
            const planPath = join(planDir, `plan${i}.json`);
            await fs.writeFile(
                planPath,
                JSON.stringify({ outputs: [{ path: chunkPath, prefixes: heroCardPrefixes(sel.heroName) }] })
            );
            await runVpkmerge(['split', '--plan', planPath, src.path], 120000);
            await verifyVpkOutput(chunkPath);
            chunkPaths.push(chunkPath);
        }

        if (chunkPaths.length === 1) {
            await fs.rename(chunkPaths[0], buildOut);
            chunkPaths.length = 0;
        } else {
            // Per-hero prefixes are disjoint, so --strict should never fire;
            // if it does, a selection set invariant is broken and we want to know.
            await runVpkmerge(['--strict', buildOut, ...chunkPaths], 120000);
        }
        await verifyVpkOutput(buildOut);

        // Swap the freshly built VPK into place. Reuse the existing slot ONLY when
        // it's enabled (keeps the load-order position + metadata). A prior copy in
        // .disabled/ must not be reused as the target: rebuilding into that path
        // would leave the applied cards disabled and silent in game. Drop the stale
        // disabled copy and reserve a fresh enabled slot instead.
        let destFileName: string;
        let destPath: string;
        if (existing && existing.ref.enabled) {
            destFileName = existing.ref.fileName;
            destPath = existing.ref.path;
            await fs.rename(buildOut, destPath);
        } else {
            if (existing) {
                await fs.unlink(existing.ref.path).catch(() => {});
                removeModMetadata(existing.ref.fileName);
                invalidateVpkParseCache(existing.ref.path);
            }
            const slot = await findNextAvailablePriority(deadlockPath);
            destFileName = `pak${String(slot).padStart(2, '0')}_dir.vpk`;
            destPath = join(addonsPath, destFileName);
            await reserveOutputSlot(destPath);
            await fs.rename(buildOut, destPath);
            removeModMetadata(destFileName); // scrub any orphan from a prior occupant
        }
        invalidateVpkParseCache(destPath);

        const info: LockerCosmeticsInfo = { cards: valid, rebuiltAt: new Date().toISOString() };
        // globalType: null keeps the multi-hero panorama payload out of the
        // Locker's Global "Icon Packs" bucket (enrichMod skips classification).
        setModMetadata(destFileName, { modName: 'Locker Cards', lockerCosmetics: info, globalType: null });

        await pinLockerVpksToFront(deadlockPath);
        return { fileName: destFileName, missing };
    } finally {
        await Promise.all([
            ...chunkPaths.map((p) => fs.unlink(p).catch(() => {})),
            fs.unlink(buildOut).catch(() => {}),
            fs.rm(planDir, { recursive: true, force: true }).catch(() => {}),
        ]);
    }
}

/**
 * Apply hero X's card from `sourceFileName`, replacing any prior choice for X.
 */
export async function applyHeroCard(
    deadlockPath: string,
    heroName: string,
    sourceFileName: string
): Promise<ApplyHeroCardResult> {
    vpkmergeBinaryPath(); // surface a clear error early if the binary is missing/old
    const codenames = codenamesForHero(heroName);
    if (codenames.length === 0) throw new Error(`Unknown hero: ${heroName}`);
    const primaryCodename = codenames[0];

    const vpks = await listAddonVpks(deadlockPath);
    const src = vpks.find((v) => v.fileName === sourceFileName);
    if (!src) throw new Error(`Source mod not found: ${sourceFileName}`);

    const cardPaths = heroCardPaths(src.path, heroName);
    if (cardPaths.length === 0) {
        throw new Error(`${basename(sourceFileName)} has no card art for ${heroName}.`);
    }

    const fp = await fingerprintFile(src.path);
    const srcMeta = getModMetadata(src.fileName);
    const selection: LockerCardSelection = {
        heroCodename: primaryCodename,
        heroName,
        variants: variantsFor(cardPaths, heroName),
        source: {
            fileName: src.fileName,
            modName: srcMeta?.modName,
            gameBananaId: srcMeta?.gameBananaId,
            sha256AtApplyTime: fp.sha256,
        },
        addedAt: new Date().toISOString(),
    };

    const current = findCosmeticsVpk(vpks)?.info.cards ?? [];
    const next = [...current.filter((c) => c.heroCodename !== primaryCodename), selection];
    const { missing } = await rebuildLockerCosmetics(deadlockPath, next);
    return {
        activeSourceFileName: missing.includes(src.fileName) ? null : src.fileName,
        missingSourceFileNames: missing,
    };
}

/** Remove hero X's card, reverting it to whatever else ships it (skin / default). */
export async function revertHeroCard(
    deadlockPath: string,
    heroName: string
): Promise<ApplyHeroCardResult> {
    const codenames = codenamesForHero(heroName);
    if (codenames.length === 0) throw new Error(`Unknown hero: ${heroName}`);
    const primaryCodename = codenames[0];

    const vpks = await listAddonVpks(deadlockPath);
    const existing = findCosmeticsVpk(vpks);
    if (!existing) return { activeSourceFileName: null, missingSourceFileNames: [] };

    const next = existing.info.cards.filter((c) => c.heroCodename !== primaryCodename);
    const { missing } = await rebuildLockerCosmetics(deadlockPath, next);
    return { activeSourceFileName: null, missingSourceFileNames: missing };
}

/** The card currently applied for a hero (to reflect selection in the picker). */
export async function getActiveHeroCard(
    deadlockPath: string,
    heroName: string
): Promise<{ sourceFileName: string; variants: string[] } | null> {
    const codenames = codenamesForHero(heroName);
    if (codenames.length === 0) return null;
    const primaryCodename = codenames[0];
    const vpks = await listAddonVpks(deadlockPath);
    const card = findCosmeticsVpk(vpks)?.info.cards.find((c) => c.heroCodename === primaryCodename);
    return card ? { sourceFileName: card.source.fileName, variants: card.variants } : null;
}
