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
import { getAddonsPath, getDisabledPath, getGrimoirePath } from './deadlock';
import { parseVpkDirectoryCached, invalidateVpkParseCache } from './vpk';
import {
    runVpkmerge,
    vpkmergeBinaryPath,
    verifyVpkOutput,
} from './modMerger';
import {
    LOCKER_CARDS_KEY,
    lockerCardsVpkPath,
    ensureGrimoireConfigured,
    migrateManagedVpksToGrimoire,
} from './lockerVpk';
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

/** The current card selection set, read from the synthetic key (post-migration)
 *  or, as a fallback during the pre-migration window, from an in-addons managed
 *  VPK. */
async function currentCardSelections(deadlockPath: string): Promise<LockerCardSelection[]> {
    const synth = getModMetadata(LOCKER_CARDS_KEY)?.lockerCosmetics?.cards;
    if (synth) return synth;
    const vpks = await listAddonVpks(deadlockPath);
    return findCosmeticsVpk(vpks)?.info.cards ?? [];
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
    const grimoireDir = getGrimoirePath(deadlockPath);
    const destPath = lockerCardsVpkPath(deadlockPath);
    const vpks = await listAddonVpks(deadlockPath);

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
        await fs.unlink(destPath).catch(() => {});
        removeModMetadata(LOCKER_CARDS_KEY);
        invalidateVpkParseCache(destPath);
        return { fileName: null, missing };
    }

    // Build artifacts live in the grimoire dir as dotfiles (not `_dir.vpk`) to
    // keep every rename same-filesystem. Plans go to userData. Everything here is
    // cleaned up in the finally block.
    const tag = `.locker-cards-build-${randomUUID()}`;
    const planDir = join(app.getPath('userData'), 'locker-cosmetics-build', randomUUID());
    const buildOut = join(grimoireDir, `${tag}.out.vpk`);
    const chunkPaths: string[] = [];
    try {
        await fs.mkdir(planDir, { recursive: true });
        for (let i = 0; i < valid.length; i++) {
            const sel = valid[i];
            const src = vpks.find((v) => v.fileName === sel.source.fileName)!;
            const chunkPath = join(grimoireDir, `${tag}.chunk${i}.vpk`);
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

        // Swap into the FIXED grimoire slot (overwrite). The grimoire folder wins
        // by SearchPaths precedence, so no load-order pinning is needed and the
        // selection set lives under the synthetic key, not the VPK filename.
        await fs.unlink(destPath).catch(() => {});
        await fs.rename(buildOut, destPath);
        invalidateVpkParseCache(destPath);

        const info: LockerCosmeticsInfo = { cards: valid, rebuiltAt: new Date().toISOString() };
        setModMetadata(LOCKER_CARDS_KEY, { modName: 'Locker Cards', lockerCosmetics: info });

        return { fileName: destPath, missing };
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
    ensureGrimoireConfigured(deadlockPath);
    const codenames = codenamesForHero(heroName);
    if (codenames.length === 0) throw new Error(`Unknown hero: ${heroName}`);
    const primaryCodename = codenames[0];
    // Idempotent: relocates any not-yet-migrated managed VPK so `current` reads
    // from the synthetic key even if config was fixed mid-session.
    await migrateManagedVpksToGrimoire(deadlockPath);

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

    const current = await currentCardSelections(deadlockPath);
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
    ensureGrimoireConfigured(deadlockPath);
    await migrateManagedVpksToGrimoire(deadlockPath);

    const current = await currentCardSelections(deadlockPath);
    if (current.length === 0) return { activeSourceFileName: null, missingSourceFileNames: [] };

    const next = current.filter((c) => c.heroCodename !== primaryCodename);
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
    const cards = await currentCardSelections(deadlockPath);
    const card = cards.find((c) => c.heroCodename === primaryCodename);
    return card ? { sourceFileName: card.source.fileName, variants: card.variants } : null;
}
