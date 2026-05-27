/**
 * Shared lifecycle for the Locker-managed override VPKs (hero cards + ability
 * sounds). Both are built and owned by Grimoire, ship only the exact cosmetic
 * paths the user picked (disjoint, additive), and must always sit at the FRONT
 * of the load order so they win Deadlock's lowest-pakNN-wins collision.
 *
 * They are hidden from the Installed list (see ipc/mods.ts `get-mods`) and driven
 * solely through the Locker pickers, so the user can't accidentally disable or
 * reorder them. A stray disable silently killed applied sounds before this:
 * the rebuilt VPK landed in .disabled/ and the game never mounted it.
 */
import { scanMods, enableMod, reorderMods } from './mods';
import { getModMetadata } from './metadata';
import { readStash } from './launch';

/** A VPK is Locker-managed when its metadata carries a cards or sounds payload. */
export function isLockerManaged(fileName: string): boolean {
    const meta = getModMetadata(fileName);
    return !!(meta?.lockerCosmetics || meta?.lockerSounds);
}

/**
 * Stable relative order among the managed VPKs so repeated pins converge instead
 * of ping-ponging the two front slots on each apply. Cosmetics ("icons") first,
 * then sounds; both still beat every user mod by sitting at the front, and they
 * touch disjoint paths so the order between them is cosmetic anyway.
 */
function lockerRank(fileName: string): number {
    const meta = getModMetadata(fileName);
    if (meta?.lockerCosmetics) return 0;
    if (meta?.lockerSounds) return 1;
    return 2;
}

/**
 * Pin every enabled Locker-managed VPK to the front of the load order, in a
 * stable relative order. No-ops when they already hold the front slots, so it's
 * cheap to call after each apply/revert.
 */
export async function pinLockerVpksToFront(deadlockPath: string): Promise<void> {
    const mods = await scanMods(deadlockPath);
    const enabled = mods.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
    const managed = enabled
        .filter((m) => isLockerManaged(m.fileName))
        .sort((a, b) => lockerRank(a.fileName) - lockerRank(b.fileName));
    if (managed.length === 0) return;

    // Already at the front in the right order? Nothing to rename.
    const front = enabled.slice(0, managed.length);
    if (managed.every((m, i) => front[i]?.id === m.id)) return;

    const rest = enabled.filter((m) => !isLockerManaged(m.fileName));
    const ordered = [...managed, ...rest].map((m) => m.fileName);
    await reorderMods(deadlockPath, ordered);
}

/**
 * Self-heal: re-enable any Locker-managed VPK that ended up in .disabled/ (it
 * must never sit disabled, since it's hidden from the Installed list and only
 * the Locker controls it), then pin the managed VPKs to the front. Skips
 * entirely while a vanilla launch is in progress so we don't undo the user's
 * vanilla session by un-stashing the mods Launch Vanilla just parked.
 */
export async function healLockerVpks(deadlockPath: string): Promise<void> {
    if (await readStash()) return; // vanilla session active; leave the stash intact

    const mods = await scanMods(deadlockPath);
    const disabledManaged = mods.filter((m) => !m.enabled && isLockerManaged(m.fileName));
    for (const m of disabledManaged) {
        try {
            await enableMod(deadlockPath, m.id);
        } catch (err) {
            console.warn(`[lockerVpk] Failed to re-enable managed VPK ${m.fileName}:`, err);
        }
    }
    await pinLockerVpksToFront(deadlockPath);
}
