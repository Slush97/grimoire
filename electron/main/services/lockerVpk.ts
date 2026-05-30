/**
 * Lifecycle for the Locker-managed override VPKs (hero cards + ability sounds).
 *
 * They live in their OWN addon folder, citadel/grimoire, listed first in
 * gameinfo.gi's SearchPaths so they outrank every user mod by folder precedence.
 * That keeps them off the user's 99-slot citadel/addons budget entirely (the
 * grimoire folder is never scanned by scanMods), while still winning every
 * cosmetic collision. Each has a FIXED filename in grimoire (pak01=cards,
 * pak02=sounds; disjoint paths, so the order between them is cosmetic), and its
 * selection set is stored under a synthetic metadata key (`locker:cards` /
 * `locker:sounds`) rather than the VPK's filename, so it can never collide with
 * a user mod that later takes the freed addons/pak01 slot.
 *
 * Migration: 1.13.x users have their cards VPK in citadel/addons. Once the
 * grimoire search path is configured (via the existing Fix Configuration flow),
 * `migrateManagedVpksToGrimoire` relocates it and moves its selections to the
 * synthetic key. Until then, `healLockerVpks` keeps it enabled + pinned in
 * addons so applied cards keep loading through the transition.
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { getGrimoirePath } from './deadlock';
import { getGameinfoStatus, fixGameinfo } from './system';
import { scanMods, enableMod, reorderMods } from './mods';
import { getModMetadata, setModMetadata, removeModMetadata } from './metadata';
import { invalidateVpkParseCache } from './vpk';
import { readStash } from './launch';

/** Synthetic metadata keys for the managed selection sets (decoupled from the
 *  VPK filename so they never collide with a user mod). */
export const LOCKER_CARDS_KEY = 'locker:cards';
export const LOCKER_SOUNDS_KEY = 'locker:sounds';
export const LOCKER_COLORS_KEY = 'locker:colors';

/** Fixed filenames inside citadel/grimoire. */
const GRIMOIRE_CARDS_FILE = 'pak01_dir.vpk';
const GRIMOIRE_SOUNDS_FILE = 'pak02_dir.vpk';
const GRIMOIRE_COLORS_FILE = 'pak03_dir.vpk';

/** Absolute path to the managed cards VPK in citadel/grimoire. */
export function lockerCardsVpkPath(deadlockPath: string): string {
    return join(getGrimoirePath(deadlockPath), GRIMOIRE_CARDS_FILE);
}

/** Absolute path to the managed sounds VPK in citadel/grimoire. */
export function lockerSoundsVpkPath(deadlockPath: string): string {
    return join(getGrimoirePath(deadlockPath), GRIMOIRE_SOUNDS_FILE);
}

/** Absolute path to the managed ability-colors VPK in citadel/grimoire. The
 *  colors VPK never lived in citadel/addons (it's a feature newer than the
 *  grimoire search path), so unlike cards/sounds it has no migration path. */
export function lockerColorsVpkPath(deadlockPath: string): string {
    return join(getGrimoirePath(deadlockPath), GRIMOIRE_COLORS_FILE);
}

/** Whether the grimoire search path (and addons) is active in gameinfo.gi. The
 *  managed VPKs only load once it is, so apply gates on this. */
export function isGrimoireConfigured(deadlockPath: string): boolean {
    return getGameinfoStatus(deadlockPath).configured;
}

/**
 * Ensure the grimoire search path is active in gameinfo.gi, running the same
 * fixGameinfo repair the Settings button uses if it's missing. A managed VPK
 * written to grimoire wouldn't load without it. Called on a deliberate apply (not
 * at launch), so this isn't a silent launch-time write. Throws only when the
 * repair can't succeed (gameinfo absent or unparseable), where the user must
 * recover the file via Settings first.
 */
export function ensureGrimoireConfigured(deadlockPath: string): void {
    if (isGrimoireConfigured(deadlockPath)) return;
    const status = fixGameinfo(deadlockPath);
    if (!status.configured) {
        throw new Error(
            `Couldn't configure the mod folders${status.message ? `: ${status.message}` : ''}. ` +
                'Open Settings and use Fix Configuration, then try again.',
        );
    }
}

/**
 * Relocate a managed VPK currently in citadel/addons (or .disabled) into
 * citadel/grimoire under its fixed name, moving its selection set from the old
 * filename-keyed metadata to the synthetic key. Idempotent: a no-op once the
 * source is gone.
 */
async function relocateManaged(
    fromPath: string,
    fromKey: string,
    toPath: string,
    toKey: string,
    metaToWrite: Parameters<typeof setModMetadata>[1],
): Promise<void> {
    await fs.unlink(toPath).catch(() => {}); // overwrite any partial prior migration
    await fs.rename(fromPath, toPath);
    setModMetadata(toKey, metaToWrite);
    removeModMetadata(fromKey);
    invalidateVpkParseCache(fromPath);
    invalidateVpkParseCache(toPath);
}

/**
 * Move any Locker-managed VPK still living in citadel/addons (enabled or
 * disabled) into citadel/grimoire, and migrate its selections to the synthetic
 * key. Run once the grimoire search path is configured. Idempotent.
 */
export async function migrateManagedVpksToGrimoire(deadlockPath: string): Promise<void> {
    const mods = await scanMods(deadlockPath);
    for (const m of mods) {
        const meta = getModMetadata(m.metaKey);
        if (meta?.lockerCosmetics) {
            await relocateManaged(m.path, m.metaKey, lockerCardsVpkPath(deadlockPath), LOCKER_CARDS_KEY, {
                modName: 'Locker Cards',
                lockerCosmetics: meta.lockerCosmetics,
            });
        } else if (meta?.lockerSounds) {
            await relocateManaged(m.path, m.metaKey, lockerSoundsVpkPath(deadlockPath), LOCKER_SOUNDS_KEY, {
                modName: 'Locker Sounds',
                lockerSounds: meta.lockerSounds,
            });
        }
    }
}

/**
 * A VPK is Locker-managed when its (filename-keyed) metadata carries a cards or
 * sounds payload. Only true for the pre-migration in-addons copy: once migrated,
 * the selections live under the synthetic keys and the grimoire VPK is never
 * scanned. Used by addons-scanning surfaces (get-mods, conflicts, profiles) to
 * hide a not-yet-migrated managed VPK.
 */
export function isLockerManaged(metaKey: string): boolean {
    const meta = getModMetadata(metaKey);
    return !!(meta?.lockerCosmetics || meta?.lockerSounds);
}

/** Stable relative order among in-addons managed VPKs (fallback path only). */
function lockerRank(metaKey: string): number {
    const meta = getModMetadata(metaKey);
    if (meta?.lockerCosmetics) return 0;
    if (meta?.lockerSounds) return 1;
    return 2;
}

/**
 * FALLBACK (pre-migration only): keep any managed VPK still in citadel/addons
 * enabled and pinned to the front, so applied cosmetics keep loading until the
 * grimoire search path is configured and they migrate out. No-ops once the
 * managed VPKs have moved to grimoire (nothing managed left in addons).
 */
export async function pinLockerVpksToFront(deadlockPath: string): Promise<void> {
    const mods = await scanMods(deadlockPath);
    const enabled = mods.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
    const managed = enabled
        .filter((m) => isLockerManaged(m.metaKey))
        .sort((a, b) => lockerRank(a.metaKey) - lockerRank(b.metaKey));
    if (managed.length === 0) return;

    const front = enabled.slice(0, managed.length);
    if (managed.every((m, i) => front[i]?.id === m.id)) return;

    const rest = enabled.filter((m) => !isLockerManaged(m.metaKey));
    const ordered = [...managed, ...rest].map((m) => m.id);
    await reorderMods(deadlockPath, ordered);
}

/**
 * Startup self-heal. When the grimoire search path is configured, migrate any
 * managed VPK out of addons into grimoire. When it isn't yet (a fresh 1.13.x
 * update before Fix Configuration), keep the in-addons managed VPKs enabled and
 * pinned so applied cosmetics still load. Skips entirely during a vanilla launch
 * so it can't un-stash the mods Launch Vanilla just parked.
 */
export async function healLockerVpks(deadlockPath: string): Promise<void> {
    if (await readStash()) return; // vanilla session active; leave the stash intact

    if (isGrimoireConfigured(deadlockPath)) {
        await migrateManagedVpksToGrimoire(deadlockPath);
        return;
    }

    // grimoire not configured yet: re-enable any managed VPK parked in .disabled/
    // and pin it to the front of addons so applied cosmetics keep loading.
    const mods = await scanMods(deadlockPath);
    const disabledManaged = mods.filter((m) => !m.enabled && isLockerManaged(m.metaKey));
    for (const m of disabledManaged) {
        try {
            await enableMod(deadlockPath, m.id);
        } catch (err) {
            console.warn(`[lockerVpk] Failed to re-enable managed VPK ${m.fileName}:`, err);
        }
    }
    await pinLockerVpksToFront(deadlockPath);
}
