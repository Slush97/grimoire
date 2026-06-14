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
import { promises as fs, existsSync } from 'fs';
import { basename, join } from 'path';
import { randomUUID, createHash } from 'crypto';
import { app } from 'electron';
import {
    getAddonFolderPaths,
    getCitadelPath,
    getDisabledPath,
    getGrimoirePath,
    metaKeyFor,
} from './deadlock';
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
    LockerCardThumbnail,
    LockerCosmeticsInfo,
    LockerOverviewCard,
} from '../../../src/types/mod';

const PANORAMA_HERO_PREFIX = 'panorama/images/heroes/';

/** Split predicate / collision prefix for one hero's card art. The trailing
 *  underscore keeps `hornet_` from leaking into a hero whose codename shares a
 *  stem and matches the `<codename>_<variant>` / `<codename>_card_psd/`
 *  conventions. */
function cardPrefix(codename: string): string {
    return `${PANORAMA_HERO_PREFIX}${codename}_`;
}

/** Base game pak that ships every hero's default card art, used as the template
 *  source for custom uploads (each variant's `.vtex_c` lends its format/dims). */
export function baseCardPakPath(deadlockPath: string): string {
    return join(getCitadelPath(deadlockPath), 'pak01_dir.vpk');
}

/**
 * Persistent on-disk home for a custom-uploaded card's staging VPK, keyed by
 * hero codename and namespaced per install. It lives under userData (NOT a
 * mounted search path), so it never loads on its own: the rebuild splits it into
 * the single consolidated cosmetics VPK exactly like an installed-mod source.
 * Survives rebuilds so reverting another hero doesn't drop this hero's upload.
 */
export function customCardVpkPath(deadlockPath: string, codename: string): string {
    const installKey = createHash('sha1').update(deadlockPath).digest('hex').slice(0, 12);
    // `_dir.vpk` so vpkmerge split + the VPK parser treat it as a directory VPK.
    return join(app.getPath('userData'), 'custom-hero-cards', installKey, `${codename}_dir.vpk`);
}

interface VpkRef {
    fileName: string;
    path: string;
    metaKey: string;
    enabled: boolean;
}

/** Enabled addon VPKs across every addon folder (base citadel/addons plus any
 *  overflow addonsN) plus the ones parked in `.disabled/`, so a card source that
 *  overflowed past slot 99 is still found at apply/rebuild time. */
async function listAddonVpks(deadlockPath: string): Promise<VpkRef[]> {
    const out: VpkRef[] = [];
    const folders: Array<[string, boolean]> = [
        ...getAddonFolderPaths(deadlockPath).map((p) => [p, true] as [string, boolean]),
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
                const path = join(dir, entry);
                out.push({ fileName: entry, path, metaKey: metaKeyFor(path), enabled });
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
        const info = getModMetadata(v.metaKey)?.lockerCosmetics;
        if (info) return { ref: v, info };
    }
    return null;
}

/** The current card selection set, read from the synthetic key (post-migration)
 *  or, as a fallback during the pre-migration window, from an in-addons managed
 *  VPK. */
export async function currentCardSelections(deadlockPath: string): Promise<LockerCardSelection[]> {
    const synth = getModMetadata(LOCKER_CARDS_KEY)?.lockerCosmetics?.cards;
    if (synth) return synth;
    const vpks = await listAddonVpks(deadlockPath);
    return findCosmeticsVpk(vpks)?.info.cards ?? [];
}

/** Locate a source VPK by its folder-relative metaKey, falling back to content
 *  hash if reconcile renamed or overflow moved it since apply time (same
 *  recovery unmergeMod uses). Keying by metaKey (not the bare filename) keeps two
 *  same-named sources in different addon folders distinct. Selections written
 *  before overflow stored a bare filename, which is exactly the base mod's
 *  metaKey, so they still resolve here. */
async function locateSource(
    vpks: VpkRef[],
    sourceKey: string,
    sha256?: string
): Promise<VpkRef | null> {
    const byKey = vpks.find((v) => v.metaKey === sourceKey);
    if (byKey) return byKey;
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
export async function rebuildLockerCosmetics(
    deadlockPath: string,
    desired: LockerCardSelection[]
): Promise<RebuildResult> {
    const grimoireDir = getGrimoirePath(deadlockPath);
    const destPath = lockerCardsVpkPath(deadlockPath);
    const vpks = await listAddonVpks(deadlockPath);

    // The resolved source path each valid selection splits from, parallel to
    // `valid` (custom sources resolve to their staging VPK, not an addon).
    const srcPathFor = new Map<LockerCardSelection, string>();

    // Resolve each selection's source (relocating by hash if renamed) and
    // confirm it still ships this hero's cards. Anything unresolved is dropped.
    const valid: LockerCardSelection[] = [];
    const missing: string[] = [];
    for (const sel of desired) {
        // Custom uploads resolve to a persistent staging VPK keyed by codename,
        // not an installed addon. Keep the selection's synthetic fileName as-is.
        if (sel.source.kind === 'custom') {
            const path = customCardVpkPath(deadlockPath, sel.heroCodename);
            if (!existsSync(path) || heroCardPaths(path, sel.heroName).length === 0) {
                missing.push(sel.source.fileName);
                continue;
            }
            srcPathFor.set(sel, path);
            valid.push(sel);
            continue;
        }
        const src = await locateSource(vpks, sel.source.fileName, sel.source.sha256AtApplyTime);
        if (!src || heroCardPaths(src.path, sel.heroName).length === 0) {
            missing.push(sel.source.fileName);
            continue;
        }
        // Re-key to the located file's current metaKey so a source that moved
        // folders (overflow) or was renamed (reconcile) stays addressable.
        const rekeyed = { ...sel, source: { ...sel.source, fileName: src.metaKey } };
        srcPathFor.set(rekeyed, src.path);
        valid.push(rekeyed);
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
            const srcPath = srcPathFor.get(sel)!;
            const chunkPath = join(grimoireDir, `${tag}.chunk${i}.vpk`);
            const planPath = join(planDir, `plan${i}.json`);
            await fs.writeFile(
                planPath,
                JSON.stringify({ outputs: [{ path: chunkPath, prefixes: heroCardPrefixes(sel.heroName) }] })
            );
            await runVpkmerge(['split', '--plan', planPath, srcPath], 120000);
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
 * Apply hero X's card from the source identified by `sourceKey` (its
 * folder-relative metaKey, as surfaced by getHeroPortraits.modFileName),
 * replacing any prior choice for X.
 */
export async function applyHeroCard(
    deadlockPath: string,
    heroName: string,
    sourceKey: string
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
    const src = vpks.find((v) => v.metaKey === sourceKey);
    if (!src) throw new Error(`Source mod not found: ${sourceKey}`);

    const cardPaths = heroCardPaths(src.path, heroName);
    if (cardPaths.length === 0) {
        throw new Error(`${basename(src.fileName)} has no card art for ${heroName}.`);
    }

    const fp = await fingerprintFile(src.path);
    const srcMeta = getModMetadata(src.metaKey);
    const selection: LockerCardSelection = {
        heroCodename: primaryCodename,
        heroName,
        variants: variantsFor(cardPaths, heroName),
        source: {
            fileName: src.metaKey,
            modName: srcMeta?.modName,
            gameBananaId: srcMeta?.gameBananaId,
            sha256AtApplyTime: fp.sha256,
        },
        addedAt: new Date().toISOString(),
    };

    const current = await currentCardSelections(deadlockPath);
    const next = [...current.filter((c) => c.heroCodename !== primaryCodename), selection];
    const { missing } = await rebuildLockerCosmetics(deadlockPath, next);
    // A mod card replacing a prior custom upload for this hero leaves the custom
    // staging VPK orphaned; drop it (it's unmounted, just unused).
    if (current.some((c) => c.heroCodename === primaryCodename && c.source.kind === 'custom')) {
        await fs.unlink(customCardVpkPath(deadlockPath, primaryCodename)).catch(() => {});
    }
    return {
        // missing[] carries metaKeys (a selection's source key), so compare and
        // report the metaKey, which the picker round-trips as the tile identity.
        activeSourceFileName: missing.includes(src.metaKey) ? null : src.metaKey,
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

    const removed = current.filter((c) => c.heroCodename === primaryCodename);
    const next = current.filter((c) => c.heroCodename !== primaryCodename);
    const { missing } = await rebuildLockerCosmetics(deadlockPath, next);
    // Drop the staging VPK behind any custom upload we just reverted, so a stale
    // PNG set doesn't linger in userData (it's not mounted, just unused).
    for (const sel of removed) {
        if (sel.source.kind === 'custom') {
            await fs.unlink(customCardVpkPath(deadlockPath, sel.heroCodename)).catch(() => {});
        }
    }
    return { activeSourceFileName: null, missingSourceFileNames: missing };
}

/** Applied hero cards, summarized for the Installed-tab Locker Overrides card. */
export async function listAppliedCards(deadlockPath: string): Promise<LockerOverviewCard[]> {
    const cards = await currentCardSelections(deadlockPath);
    return cards.map((c) => ({
        heroName: c.heroName,
        sourceFileName: c.source.fileName,
        modName: c.source.modName,
    }));
}

/** Clear every applied card (rebuild to empty, which deletes the cards VPK). */
export async function clearAllHeroCards(deadlockPath: string): Promise<void> {
    await rebuildLockerCosmetics(deadlockPath, []);
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

/** Which applied variant best represents a hero in a small tile: the full card
 *  cover first, then the rest by prominence; anything unlisted sorts last. */
const THUMB_VARIANT_ORDER = ['card', 'vertical', 'card_critical', 'card_gloat', 'minimap', 'small'];

function thumbVariantRank(variant: string): number {
    const i = THUMB_VARIANT_ORDER.indexOf(variant);
    return i === -1 ? THUMB_VARIANT_ORDER.length : i;
}

/**
 * Decode the ACTUAL applied card art into one representative thumbnail per hero,
 * for the Locker Overrides popup. Reads straight from the managed cosmetics VPK
 * (which holds exactly the applied cards) rather than the source mod's
 * GameBanana cover, and picks the most cover-like variant per hero.
 *
 * Separate from the (cheap) overview/count on purpose: this shells out to
 * `vpkmerge portrait` per applied hero, so it's fetched lazily only when the
 * popup opens. A hero whose art fails to decode is simply omitted (the popup
 * falls back to a placeholder), so one bad entry never sinks the rest.
 */
export async function getAppliedCardThumbnails(
    deadlockPath: string
): Promise<LockerCardThumbnail[]> {
    const selections = await currentCardSelections(deadlockPath);
    if (selections.length === 0) return [];
    const vpkPath = lockerCardsVpkPath(deadlockPath);
    if (!existsSync(vpkPath)) return [];
    vpkmergeBinaryPath(); // clear early error if the binary is missing/old

    const cacheRoot = join(app.getPath('userData'), 'locker-card-thumbs');
    const out: LockerCardThumbnail[] = [];
    for (const sel of selections) {
        // The split folds in the whole per-hero prefix, so the art may sit under
        // a legacy alias codename, not the primary. Try each and keep the best.
        let best: { rank: number; outputPath: string } | null = null;
        for (const codename of codenamesForHero(sel.heroName)) {
            const outDir = join(cacheRoot, codename);
            const manifestPath = join(outDir, 'manifest.json');
            try {
                await runVpkmerge(
                    ['portrait', vpkPath, '--hero', codename, '--out', outDir, '--manifest', manifestPath],
                    60000
                );
                const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as PortraitManifest;
                for (const p of manifest.portraits) {
                    if (!p.output_path) continue;
                    const rank = thumbVariantRank(p.variant);
                    if (!best || rank < best.rank) best = { rank, outputPath: p.output_path };
                }
            } catch (err) {
                console.warn(`[heroCards] thumb decode failed for ${sel.heroName} (${codename}): ${String(err)}`);
            }
        }
        if (best) {
            const png = await fs.readFile(best.outputPath);
            out.push({ heroName: sel.heroName, dataUrl: `data:image/png;base64,${png.toString('base64')}` });
        }
    }
    return out;
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
