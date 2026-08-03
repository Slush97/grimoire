/**
 * Skin -> icon links: the main-process side.
 *
 * A link says "whenever this skin is enabled, apply that hero's card art from
 * that icon mod". The heavy lifting is already built (heroCards.ts splits one
 * hero's `panorama/images/heroes/<codename>_` art into the Locker-managed
 * cosmetics VPK in citadel/grimoire, which wins by SearchPaths folder
 * precedence). This module owns the bindings and keeps the applied card set in
 * sync as skins toggle.
 *
 * Why the main process and not the renderer: skins change from FOUR surfaces
 * (Locker toggle, Installed toggle, apply-profile, apply-mod-toggle-batch for
 * launch shuffle / solo). A renderer-side reconcile would silently desync on
 * three of them, which is exactly the "my icons stopped matching my skin"
 * failure this feature exists to prevent. reconcileLinkedCards is therefore
 * called from the IPC layer after every mutation that can change the enabled set.
 *
 * INVARIANT (enforced here and in heroCards.ts): for any hero, either its link
 * set owns the card or a manual/custom pick does, never both. Multiple skins
 * for one hero may each have a link; load order selects the live one.
 *
 * See docs/locker-hero-card-apply.md for the underlying card apply pipeline.
 */
import {
    lockerLinkKey,
    loadOrderFromMetaKey,
    planLinkedCards,
    selectionsSignature,
    upsertLink,
    withoutSkin,
    type ActiveSkin,
} from '../../../src/lib/lockerCardLinks';
import type { LockerCardLink } from '../../../src/types/mod';
import { getModMetadata } from './metadata';
import { ensureGrimoireConfigured } from './lockerVpk';
import { getCardLinks, saveCardLinks } from './lockerCardLinkStore';
import {
    currentCardSelections,
    heroCardPathsForHero,
    rebuildLockerCosmetics,
    variantsForHeroPaths,
} from './heroCards';
import { codenamesForHero } from './heroPortraits';
import { scanMods } from './mods';
import { resolveVpkIdentity } from './vpkIdentity';
import { vpkmergeBinaryPath } from './modMerger';

export { getCardLinks } from './lockerCardLinkStore';

/** The enabled skins as the planner wants them: stable key + global load order. */
async function activeSkins(deadlockPath: string): Promise<ActiveSkin[]> {
    const mods = await scanMods(deadlockPath);
    const out: ActiveSkin[] = [];
    for (const mod of mods) {
        if (!mod.enabled) continue;
        // gameBananaId / sha256 live in the metadata sidecar, not the scan row.
        const meta = getModMetadata(mod.metaKey);
        out.push({
            key: lockerLinkKey({
                id: mod.id,
                gameBananaId: meta?.gameBananaId,
                sha256: meta?.sha256,
            }),
            loadOrder: loadOrderFromMetaKey(mod.metaKey, mod.priority),
        });
    }
    return out;
}

export interface ReconcileResult {
    /** True when the cosmetics VPK was actually rebuilt. */
    rebuilt: boolean;
    /** Source identities dropped because their VPK was gone at rebuild time. */
    missing: string[];
}

interface ReconcileOptions {
    /** Codenames whose manual/custom selection a newly-created link set takes
     * over during this reconcile. */
    takeOverHeroes?: readonly string[];
    /** Continue when the stored link set is empty so the final removed link can
     * also remove its already-applied selection. */
    allowEmptyLinks?: boolean;
    /** Rebuild even when the desired manifest is unchanged. Used after deletes
     * to validate that every selected source still exists. */
    forceRebuild?: boolean;
}

/**
 * Bring the applied card set in line with the bindings and the current enabled
 * set. Idempotent, and safe to call after any mod mutation.
 *
 * Two cheap exits guard the hot path, because this runs after EVERY enable and
 * disable:
 *  1. No bindings at all (the overwhelming majority of installs): return before
 *     touching the disk.
 *  2. Bindings exist but the resulting selection set is identical to what is
 *     already applied: return before shelling out to vpkmerge. Toggling an
 *     unrelated mod therefore costs one scan, not a VPK rebuild.
 *
 * `takeOverHeroes` (codenames) clears any manual/custom pick for those heroes
 * first, so a freshly created link can claim a hero the user had hand-picked in
 * ONE rebuild instead of two.
 */
export async function reconcileLinkedCards(
    deadlockPath: string,
    options: ReconcileOptions = {}
): Promise<ReconcileResult> {
    const {
        takeOverHeroes = [],
        allowEmptyLinks = false,
        forceRebuild = false,
    } = options;
    const links = getCardLinks();
    if (
        links.length === 0 &&
        takeOverHeroes.length === 0 &&
        !allowEmptyLinks
    ) {
        return { rebuilt: false, missing: [] };
    }

    const stored = await currentCardSelections(deadlockPath);
    const takeOver = new Set(takeOverHeroes);
    const current = takeOver.size
        ? stored.filter((sel) => sel.origin === 'link' || !takeOver.has(sel.heroCodename))
        : stored;

    const next = planLinkedCards({
        links,
        current,
        // Removing a dormant final link needs no mod scan: with no links there
        // is nothing that can consume the enabled set.
        activeSkins: links.length > 0 ? await activeSkins(deadlockPath) : [],
        now: new Date().toISOString(),
    });
    if (!forceRebuild && selectionsSignature(next) === selectionsSignature(stored)) {
        return { rebuilt: false, missing: [] };
    }

    ensureGrimoireConfigured(deadlockPath);
    const { missing } = await rebuildLockerCosmetics(deadlockPath, next);
    return { rebuilt: true, missing };
}

/**
 * Reconcile without ever throwing. The IPC mutation handlers use this: a broken
 * link, a missing vpkmerge binary or an unconfigured gameinfo must never turn a
 * plain "enable this mod" click into a failure. The applied cards just stay as
 * they were, and the next successful reconcile catches up.
 */
export async function reconcileLinkedCardsQuietly(
    deadlockPath: string,
    options: ReconcileOptions = {}
): Promise<void> {
    try {
        await reconcileLinkedCards(deadlockPath, options);
    } catch (err) {
        console.warn('[lockerCardLinks] reconcile failed (applied cards left unchanged):', err);
    }
}

export interface SetCardLinkArgs {
    /** Stable Locker skin key (see lockerLinkKey). */
    skinKey: string;
    skinName?: string;
    heroName: string;
    /** Folder-relative metaKey of the icon mod to bind. */
    sourceKey: string;
}

/**
 * Bind `skinKey` to the icon mod at `sourceKey`, then reconcile so the change is
 * live immediately when the skin is already enabled.
 *
 * Snapshots the source's identity (metaKey + sha256 + name) into the binding so
 * later rebuilds can relocate it after a rename or an overflow move, the same
 * recovery the card rebuild already does for manual picks.
 */
export async function setCardLink(
    deadlockPath: string,
    args: SetCardLinkArgs
): Promise<ReconcileResult> {
    vpkmergeBinaryPath(); // surface a clear error early if the binary is missing/old
    const { skinKey, skinName, heroName, sourceKey } = args;
    const codename = codenamesForHero(heroName)[0];
    if (!codename) throw new Error(`Unknown hero: ${heroName}`);

    const mods = await scanMods(deadlockPath);
    const source = mods.find((m) => m.metaKey === sourceKey);
    if (!source) throw new Error(`Icon mod not found: ${sourceKey}`);

    const cardPaths = heroCardPathsForHero(source.path, heroName);
    if (cardPaths.length === 0) {
        throw new Error(`${source.fileName} has no card art for ${heroName}.`);
    }

    const identity = await resolveVpkIdentity(source.path);
    const meta = getModMetadata(source.metaKey);
    const link: LockerCardLink = {
        skinKey,
        skinName,
        heroName,
        heroCodename: codename,
        sourceKey: source.metaKey,
        sourceModName: meta?.modName,
        sourceGameBananaId: meta?.gameBananaId,
        sourceSha256: identity.sha256,
        variants: variantsForHeroPaths(cardPaths, heroName),
        linkedAt: new Date().toISOString(),
    };

    // One binding per skin, but any number of linked skins per hero. The planner
    // chooses the live one by load order. takeOverHeroes drops a manual/custom
    // pick so the hero is owned by the link set instead.
    const previous = getCardLinks();
    saveCardLinks(upsertLink(previous, link));
    try {
        return await reconcileLinkedCards(deadlockPath, { takeOverHeroes: [codename] });
    } catch (err) {
        // A failed build must not leave a link persisted over the still-current
        // manual card. Restore the metadata transaction before surfacing it.
        saveCardLinks(previous);
        throw err;
    }
}

/** Remove the binding for one skin and revert whatever it had applied. */
export async function removeCardLink(
    deadlockPath: string,
    skinKey: string
): Promise<ReconcileResult> {
    const links = getCardLinks();
    const next = withoutSkin(links, skinKey);
    if (next.length === links.length) return { rebuilt: false, missing: [] };
    saveCardLinks(next);
    try {
        return await reconcileLinkedCards(deadlockPath, { allowEmptyLinks: true });
    } catch (err) {
        // Keep the binding when its applied output could not be reverted; the UI
        // can retry instead of claiming an unlink that never took effect.
        saveCardLinks(links);
        throw err;
    }
}
