import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { getUserDataPath } from '../utils/paths';
import {
    scanMods,
    runExclusiveModMutation,
    enableModUnlocked,
    disableModUnlocked,
    reorderModsUnlocked,
} from './mods';
import { getModMetadata } from './metadata';
import {
    normalizeVpkIndex,
    inferMissingVpkIndexes as resolverInferMissingVpkIndexes,
    dedupeEnabledForProfile as resolverDedupeEnabledForProfile,
    buildProfileModResolver as resolverBuildProfileModResolver,
    type ResolvedMatch,
} from './profileResolver';
import { isLockerManaged, pinLockerVpksToFront } from './lockerVpk';
import { readAutoexec, writeAutoexec } from './autoexec';
import {
    assertCanMoveLoadedGameMods,
    syncRunningGameModSnapshotFromMods,
} from './gameSessionMods';
import { generateCrosshairCommands, normalizeCrosshairSettings } from '../../../src/lib/crosshair';

// The Profile wire types are single-sourced in src/types/electron.ts
// (docstrings included); re-exported because portableProfile.ts and the
// ipc layer import them from this service.
import type { Profile, ProfileMod, ProfileCrosshairSettings, ApplyProfileResult } from '../../../src/types/electron';
export type { Profile, ProfileMod, ProfileCrosshairSettings, ApplyProfileResult };

/**
 * Get the profiles file path
 */
function getProfilesPath(): string {
    return join(getUserDataPath(), 'profiles.json');
}

/**
 * Generate a unique profile ID
 */
export function generateProfileId(): string {
    return `profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append a fully-formed profile to disk. Used by import paths that build the
 * Profile object themselves (e.g. portable profile imports).
 */
export function addProfile(profile: Profile): Profile {
    const profiles = loadProfiles();
    profiles.push(profile);
    saveProfiles(profiles);
    return profile;
}

/**
 * Load all profiles from disk
 */
export function loadProfiles(): Profile[] {
    const path = getProfilesPath();

    if (!existsSync(path)) {
        return [];
    }

    try {
        const content = readFileSync(path, 'utf-8');
        return JSON.parse(content) as Profile[];
    } catch (error) {
        console.warn('[Profiles] Failed to load profiles, returning empty:', error);
        return [];
    }
}

/**
 * Save profiles to disk atomically (P1 fix #8, #10)
 * Uses write-to-temp-then-rename pattern to prevent corruption on crash
 */
function saveProfiles(profiles: Profile[]): void {
    const path = getProfilesPath();
    const tempPath = `${path}.tmp`;
    const dir = dirname(path);

    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    try {
        writeFileSync(tempPath, JSON.stringify(profiles, null, 2), 'utf-8');
        renameSync(tempPath, path);
    } catch (error) {
        try {
            if (existsSync(tempPath)) unlinkSync(tempPath);
        } catch { /* ignore */ }
        throw error;
    }
}

// The profile <-> installed-mod matching logic (index inference, dedupe, the
// resolver) lives in profileResolver.ts so it can be unit-tested without the
// main-process graph. These binders inject the real metadata sidecar reader so
// the call sites in this file stay unchanged.
function inferMissingVpkIndexes<T extends { metaKey: string; fileName: string; size: number }>(
    mods: T[]
): Map<string, number> {
    return resolverInferMissingVpkIndexes(mods, getModMetadata);
}

function dedupeEnabledForProfile<T extends { metaKey: string; fileName: string; priority: number; size: number }>(
    mods: T[]
): T[] {
    return resolverDedupeEnabledForProfile(mods, getModMetadata);
}

/**
 * Create a new profile from current mod state and provided crosshair settings
 */
export async function createProfile(deadlockPath: string, name: string, crosshairSettings?: ProfileCrosshairSettings): Promise<Profile> {
    const mods = await scanMods(deadlockPath);
    // Only save enabled mods, and never the Locker-managed VPKs (cards/sounds):
    // they're owned by the Locker, hidden, and auto-pinned, so they don't belong
    // in a profile's mod list (and have no gameBananaId to re-resolve anyway).
    const enabledMods = dedupeEnabledForProfile(
        mods.filter(mod => mod.enabled && !isLockerManaged(mod.metaKey))
    );

    // Read current autoexec commands
    const autoexecData = readAutoexec(deadlockPath);

    const now = new Date().toISOString();

    const inferredVpkIndexes = inferMissingVpkIndexes(enabledMods);
    const profile: Profile = {
        id: generateProfileId(),
        name,
        mods: enabledMods.map(mod => toProfileMod(mod, true, inferredVpkIndexes)),
        crosshair: crosshairSettings ? normalizeCrosshairSettings(crosshairSettings) : undefined,
        autoexecCommands: autoexecData.commands,
        createdAt: now,
        updatedAt: now,
    };

    const profiles = loadProfiles();
    profiles.push(profile);
    saveProfiles(profiles);

    return profile;
}

/**
 * Build a ProfileMod from a current scanned Mod, attaching stable identifiers
 * (GameBanana mod/file ids) from the metadata sidecar when available. These
 * ids are what `applyProfile` resolves against so a mod can still be found
 * after its fileName has changed (reorder, collision-rename, multi-vpk pick).
 */
function toProfileMod(
    mod: { fileName: string; metaKey: string; priority: number },
    enabled: boolean,
    inferredVpkIndexes?: Map<string, number>
): ProfileMod {
    const meta = getModMetadata(mod.metaKey);
    const vpkIndex = normalizeVpkIndex(meta?.vpkIndex) ?? inferredVpkIndexes?.get(mod.metaKey);
    const out: ProfileMod = {
        fileName: mod.fileName,
        enabled,
        priority: mod.priority,
    };
    if (typeof meta?.gameBananaId === 'number') out.gameBananaId = meta.gameBananaId;
    if (typeof meta?.gameBananaFileId === 'number') out.gameBananaFileId = meta.gameBananaFileId;
    if (vpkIndex !== undefined) out.vpkIndex = vpkIndex;
    return out;
}

/**
 * Create a profile from a specific subset of installed mods, identified by
 * GameBanana mod ids. Used by the collection import flow: the resulting
 * profile contains ONLY the mods that were just imported, not every other
 * enabled mod in the user's library.
 *
 * Mods are recorded as enabled=true regardless of their current filesystem
 * state. The download pipeline installs new mods to the disabled folder,
 * so capturing live state would save the profile with everything disabled.
 * The user's intent in saving a collection as a profile is "make these the
 * active set when I apply this", so we encode that explicitly.
 */
export async function createProfileFromGameBananaIds(
    deadlockPath: string,
    name: string,
    gameBananaIds: number[]
): Promise<Profile> {
    const idSet = new Set(gameBananaIds);
    const mods = await scanMods(deadlockPath);
    // scanMods returns filesystem-only state. gameBananaId lives in the
    // metadata sidecar (read at the IPC layer via enrichMod), so we look
    // it up per-mod here. Without this the filter never matches and the
    // profile saves zero mods.
    const matching = mods.filter((mod) => {
        const metadata = getModMetadata(mod.metaKey);
        return metadata?.gameBananaId !== undefined && idSet.has(metadata.gameBananaId);
    });

    const autoexecData = readAutoexec(deadlockPath);
    const now = new Date().toISOString();

    const inferredVpkIndexes = inferMissingVpkIndexes(matching);
    const profile: Profile = {
        id: generateProfileId(),
        name,
        mods: matching.map((mod) => toProfileMod(mod, true, inferredVpkIndexes)),
        autoexecCommands: autoexecData.commands,
        createdAt: now,
        updatedAt: now,
    };

    const profiles = loadProfiles();
    profiles.push(profile);
    saveProfiles(profiles);

    return profile;
}

/**
 * Update an existing profile with current mod state
 * Only saves enabled mods - disabled mods are not included
 */
export async function updateProfile(deadlockPath: string, profileId: string, crosshairSettings?: ProfileCrosshairSettings): Promise<Profile> {
    const profiles = loadProfiles();
    const index = profiles.findIndex(p => p.id === profileId);

    if (index === -1) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    const mods = await scanMods(deadlockPath);
    // Only save enabled mods, and never the Locker-managed VPKs (cards/sounds):
    // they're owned by the Locker, hidden, and auto-pinned, so they don't belong
    // in a profile's mod list (and have no gameBananaId to re-resolve anyway).
    const enabledMods = dedupeEnabledForProfile(
        mods.filter(mod => mod.enabled && !isLockerManaged(mod.metaKey))
    );

    // Read current autoexec commands
    const autoexecData = readAutoexec(deadlockPath);

    const inferredVpkIndexes = inferMissingVpkIndexes(enabledMods);
    profiles[index] = {
        ...profiles[index],
        mods: enabledMods.map(mod => toProfileMod(mod, true, inferredVpkIndexes)),
        // If crosshairSettings is passed, use it. If undefined/null, remove crosshair from profile.
        // This allows the frontend to explicitly control whether crosshair is included based on feature toggle.
        crosshair: crosshairSettings ? normalizeCrosshairSettings(crosshairSettings) : undefined,
        autoexecCommands: autoexecData.commands,
        updatedAt: new Date().toISOString(),
    };

    saveProfiles(profiles);
    return profiles[index];
}

/** Binds the pure resolver (profileResolver.ts) to the real metadata sidecar so
 *  applyProfile resolves each ProfileMod against the current scan. */
function buildProfileModResolver(
    currentMods: Array<import('../../../src/types/mod').Mod>
): (pm: ProfileMod) => ResolvedMatch {
    return resolverBuildProfileModResolver(currentMods, getModMetadata);
}

/** One-line tag for a profile entry in diagnostic logs. We keep it compact so
 *  a ~50-mod apply doesn't blow the rolling log budget, but include enough to
 *  correlate with the metadata sidecar and the user's GameBanana page. */
function describeProfileMod(pm: ProfileMod): string {
    if (typeof pm.gameBananaId === 'number' && typeof pm.gameBananaFileId === 'number') {
        const indexPart = normalizeVpkIndex(pm.vpkIndex) === undefined ? '' : `:${pm.vpkIndex}`;
        return `gb=${pm.gameBananaId}:${pm.gameBananaFileId}${indexPart} (${pm.fileName})`;
    }
    return `local (${pm.fileName})`;
}

/**
 * Apply a profile - enable/disable mods, restore autoexec and crosshair
 */
export async function applyProfile(deadlockPath: string, profileId: string): Promise<ApplyProfileResult> {
    const profiles = loadProfiles();
    const profile = profiles.find(p => p.id === profileId);

    if (!profile) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    const profileStableCount = profile.mods.filter(
        (pm) =>
            typeof pm.gameBananaId === 'number' &&
            typeof pm.gameBananaFileId === 'number'
    ).length;
    console.log(
        `[profiles] apply '${profile.name}' (id=${profile.id}): ` +
        `${profile.mods.length} entries, ${profileStableCount} with stable ids`
    );

    // 1. Apply Mods (enable/disable state) as ONE atomic batch.
    //
    // The whole disable -> enable -> reorder sequence runs inside a single
    // runExclusiveModMutation, so it holds the mod-mutation queue for its full
    // duration. A Locker toggle (or a second apply) can no longer slip between
    // sub-steps, rename files, and invalidate the scan ids this apply is driving
    // off of - the interleave that used to throw "Mod not found" partway and drop
    // every remaining mod (#bugs: profile apply "dropped like 5 mods").
    //
    // Per-mod enable/disable failures are caught and counted, not rethrown: a
    // single locked VPK (game running, antivirus, our own VPK readers) must not
    // abort the rest of the apply. renameWithRetry in mods.ts already clears the
    // transient case; a genuinely stuck file is logged and skipped.
    let stableHits = 0;
    let fileNameHits = 0;
    let unmatched = 0;
    let refusedCrossmatches = 0;
    let enabledCount = 0;
    let disabledCount = 0;
    let orphanedDisabledCount = 0;
    const failures: string[] = [];

    await runExclusiveModMutation(async () => {
        // Resolve by archive id first, using vpkIndex for multi-VPK siblings.
        // FileName fallback is only for stable-id-less local mods.
        const currentMods = await scanMods(deadlockPath);
        await syncRunningGameModSnapshotFromMods(currentMods);
        const resolveProfileMod = buildProfileModResolver(currentMods);

        // currentMod.id -> ProfileMod, when matched. Drives the enable/disable
        // loop and the reorder pass below.
        const profileModByCurrentId = new Map<string, ProfileMod>();
        for (const profileMod of profile.mods) {
            const resolution = resolveProfileMod(profileMod);
            if (resolution.mod !== undefined) {
                profileModByCurrentId.set(resolution.mod.id, profileMod);
                if (resolution.via === 'stable') {
                    stableHits++;
                    console.log(
                        `[profiles] resolve stable: ${describeProfileMod(profileMod)} ` +
                        `-> ${resolution.mod.fileName}`
                    );
                } else {
                    fileNameHits++;
                    console.log(
                        `[profiles] resolve fileName (local-to-local): ` +
                        `${describeProfileMod(profileMod)} -> ${resolution.mod.fileName}`
                    );
                }
            } else if (resolution.via === 'refused-crossmatch') {
                refusedCrossmatches++;
                console.warn(
                    `[profiles] resolve refused: ${describeProfileMod(profileMod)} ` +
                    `would have cross-matched current mod ${resolution.candidateFileName} ` +
                    `(stable-id mismatch). Entry left unmatched to avoid enabling the wrong mod.`
                );
            } else {
                unmatched++;
                console.log(
                    `[profiles] resolve miss: ${describeProfileMod(profileMod)} ` +
                    `(mod not currently installed)`
                );
            }
        }

        console.log(
            `[profiles] resolution summary: ${stableHits} stable, ${fileNameHits} fileName, ` +
            `${refusedCrossmatches} refused, ${unmatched} unmatched`
        );

        assertCanMoveLoadedGameMods(currentMods.filter((mod) => {
            if (!mod.enabled || isLockerManaged(mod.metaKey)) return false;
            const profileMod = profileModByCurrentId.get(mod.id);
            return !profileMod || !profileMod.enabled || profileMod.priority !== mod.priority;
        }));

        // Two passes, disables BEFORE enables. The disabled library is uncapped now,
        // so a profile that swaps a large enabled set for a large disabled one could,
        // in a single interleaved pass, enable past the 99 active-slot ceiling before
        // freeing the slots it's about to vacate - throwing mid-apply and leaving a
        // half-applied profile. Freeing first guarantees every slot the profile needs
        // is available, and the enable pass can never exceed 99 (a profile holds at
        // most 99 enabled mods). The two passes act on disjoint sets of currentMods
        // (was-enabled vs was-disabled), so the snapshot ids stay valid across both.
        for (const mod of currentMods) {
            if (!mod.enabled) continue;
            // Locker-managed VPKs (hero cards + ability sounds) aren't part of any
            // profile: they're hidden, auto-pinned, and owned by the Locker. Never
            // disable them on a profile switch, or applied cosmetics would silently
            // stop loading. They get re-pinned to the front after the reorder pass.
            if (isLockerManaged(mod.metaKey)) continue;
            const profileMod = profileModByCurrentId.get(mod.id);
            if (profileMod && profileMod.enabled) continue; // keep it enabled
            try {
                await disableModUnlocked(deadlockPath, mod.id);
            } catch (err) {
                failures.push(`disable ${mod.fileName}: ${String(err)}`);
                console.warn(`[profiles] disable failed (continuing): ${mod.fileName}: ${String(err)}`);
                continue;
            }
            if (profileMod) {
                console.log(`[profiles] toggle disable: ${mod.fileName}`);
                disabledCount++;
            } else {
                console.log(`[profiles] toggle disable (not in profile): ${mod.fileName}`);
                orphanedDisabledCount++;
            }
        }
        for (const mod of currentMods) {
            if (mod.enabled) continue;
            const profileMod = profileModByCurrentId.get(mod.id);
            if (!profileMod || !profileMod.enabled) continue;
            console.log(`[profiles] toggle enable: ${mod.fileName}`);
            try {
                await enableModUnlocked(deadlockPath, mod.id);
                enabledCount++;
            } catch (err) {
                failures.push(`enable ${mod.fileName}: ${String(err)}`);
                console.warn(`[profiles] enable failed (continuing): ${mod.fileName}: ${String(err)}`);
            }
        }
        console.log(
            `[profiles] toggle summary: ${enabledCount} enabled, ${disabledCount} disabled, ` +
            `${orphanedDisabledCount} disabled-not-in-profile`
        );

        // 1b. Apply priority order in a single two-phase pass via reorderMods.
        // The previous implementation called setModPriority per mod and swallowed
        // "Priority X is already in use" errors. Common when switching between
        // profiles, since the OTHER profile's mods still occupy the target slots
        // until later iterations move them. reorderMods stages every rename via
        // a tmp prefix first, so transient mid-loop collisions can't happen.
        //
        // Re-resolve after enable/disable: enableMod assigns a fresh pakNN slot and
        // disableMod renames to a free-form name, so the previous resolver's
        // id-to-mod (and fileName) mapping is stale.
        const refreshedMods = await scanMods(deadlockPath);
        const resolveAgainstRefreshed = buildProfileModResolver(refreshedMods);
        const orderedIds: string[] = [];
        const seen = new Set<string>();
        let reorderSkippedDisabled = 0;
        let reorderSkippedUnmatched = 0;
        for (const pm of [...profile.mods].sort((a, b) => a.priority - b.priority)) {
            if (!pm.enabled) continue;
            const resolution = resolveAgainstRefreshed(pm);
            if (resolution.mod === undefined) {
                reorderSkippedUnmatched++;
                continue;
            }
            if (!resolution.mod.enabled) {
                reorderSkippedDisabled++;
                continue;
            }
            if (seen.has(resolution.mod.id)) continue;
            seen.add(resolution.mod.id);
            orderedIds.push(resolution.mod.id);
        }
        if (orderedIds.length > 0) {
            console.log(
                `[profiles] reorder: ${orderedIds.length} mods laid out densely across addon folders ` +
                `(skipped ${reorderSkippedUnmatched} unmatched, ${reorderSkippedDisabled} disabled)`
            );
            await reorderModsUnlocked(deadlockPath, orderedIds);
        } else {
            console.log(`[profiles] reorder: nothing to reorder`);
        }
    });

    if (failures.length > 0) {
        console.warn(
            `[profiles] apply '${profile.name}' completed with ${failures.length} ` +
            `mod op failure(s) (file likely locked by the running game): ${failures.join('; ')}`
        );
    }

    // Re-assert the Locker-managed VPKs at the front: the profile reorder only
    // sequences the profile's own mods (managed VPKs are excluded), so pin them
    // back to pak01.. so applied cards/sounds keep winning every collision.
    await pinLockerVpksToFront(deadlockPath);

    // 2. Apply Autoexec & Crosshair
    const currentAutoexec = readAutoexec(deadlockPath);

    // Update commands if present in profile
    if (profile.autoexecCommands) {
        currentAutoexec.commands = profile.autoexecCommands;
    }

    // Update crosshair if present in profile
    if (profile.crosshair) {
        currentAutoexec.crosshair = generateCrosshairCommands(profile.crosshair);
    }

    writeAutoexec(deadlockPath, currentAutoexec);

    console.log(`[profiles] apply '${profile.name}' complete`);
    return { profile, failures };
}

/**
 * Delete a profile
 */
export function deleteProfile(profileId: string): void {
    const profiles = loadProfiles();
    const filtered = profiles.filter(p => p.id !== profileId);

    if (filtered.length === profiles.length) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    saveProfiles(filtered);
}

/**
 * Rename a profile
 */
export function renameProfile(profileId: string, newName: string): Profile {
    const profiles = loadProfiles();
    const index = profiles.findIndex(p => p.id === profileId);

    if (index === -1) {
        throw new Error(`Profile not found: ${profileId}`);
    }

    profiles[index].name = newName;
    profiles[index].updatedAt = new Date().toISOString();

    saveProfiles(profiles);
    return profiles[index];
}
