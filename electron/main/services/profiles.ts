import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { getUserDataPath } from '../utils/paths';
import { scanMods, enableMod, disableMod, reorderMods } from './mods';
import { getModMetadata } from './metadata';
import { isLockerManaged, pinLockerVpksToFront } from './lockerVpk';
import { readAutoexec, writeAutoexec } from './autoexec';

export interface ProfileMod {
    /** Filename when the profile was saved. NOT stable across reorders or
     *  collision-renames; use `gameBananaId` + `gameBananaFileId` as the
     *  primary identifier when present, and fall back to `fileName` only for
     *  pre-stable-id profiles or custom mods that lack GameBanana ids. */
    fileName: string;
    enabled: boolean;
    priority: number;
    /** Stable identity pair. Populated from metadata at save time so apply
     *  can find the mod even if its fileName has changed since. */
    gameBananaId?: number;
    gameBananaFileId?: number;
    /** Content fingerprint, populated from metadata at save time. The identity
     *  of last resort for custom/local mods that carry no GameBanana ids: it
     *  survives a fileName change (reorder, or the free-form rename a mod gets
     *  when disabled), so apply can still re-enable the right local mod. */
    sha256?: string;
}

export interface ProfileCrosshairSettings {
    pipGap: number;
    pipHeight: number;
    pipWidth: number;
    pipOpacity: number;
    pipBorder: boolean;
    dotOpacity: number;
    dotOutlineOpacity: number;
    colorR: number;
    colorG: number;
    colorB: number;
}

export interface Profile {
    id: string;
    name: string;
    mods: ProfileMod[];
    crosshair?: ProfileCrosshairSettings;
    autoexecCommands?: string[];
    createdAt: string;
    updatedAt: string;
}

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

/**
 * Create a new profile from current mod state and provided crosshair settings
 */
export async function createProfile(deadlockPath: string, name: string, crosshairSettings?: ProfileCrosshairSettings): Promise<Profile> {
    const mods = await scanMods(deadlockPath);
    // Only save enabled mods, and never the Locker-managed VPKs (cards/sounds):
    // they're owned by the Locker, hidden, and auto-pinned, so they don't belong
    // in a profile's mod list (and have no gameBananaId to re-resolve anyway).
    const enabledMods = mods.filter(mod => mod.enabled && !isLockerManaged(mod.fileName));

    // Read current autoexec commands
    const autoexecData = readAutoexec(deadlockPath);

    const now = new Date().toISOString();

    const profile: Profile = {
        id: generateProfileId(),
        name,
        mods: enabledMods.map(mod => toProfileMod(mod, true)),
        crosshair: crosshairSettings,
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
function toProfileMod(mod: { fileName: string; priority: number }, enabled: boolean): ProfileMod {
    const meta = getModMetadata(mod.fileName);
    const out: ProfileMod = {
        fileName: mod.fileName,
        enabled,
        priority: mod.priority,
    };
    if (typeof meta?.gameBananaId === 'number') out.gameBananaId = meta.gameBananaId;
    if (typeof meta?.gameBananaFileId === 'number') out.gameBananaFileId = meta.gameBananaFileId;
    if (typeof meta?.sha256 === 'string') out.sha256 = meta.sha256;
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
        const metadata = getModMetadata(mod.fileName);
        return metadata?.gameBananaId !== undefined && idSet.has(metadata.gameBananaId);
    });

    const autoexecData = readAutoexec(deadlockPath);
    const now = new Date().toISOString();

    const profile: Profile = {
        id: generateProfileId(),
        name,
        mods: matching.map((mod) => toProfileMod(mod, true)),
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
    const enabledMods = mods.filter(mod => mod.enabled && !isLockerManaged(mod.fileName));

    // Read current autoexec commands
    const autoexecData = readAutoexec(deadlockPath);

    profiles[index] = {
        ...profiles[index],
        mods: enabledMods.map(mod => toProfileMod(mod, true)),
        // If crosshairSettings is passed, use it. If undefined/null, remove crosshair from profile.
        // This allows the frontend to explicitly control whether crosshair is included based on feature toggle.
        crosshair: crosshairSettings,
        autoexecCommands: autoexecData.commands,
        updatedAt: new Date().toISOString(),
    };

    saveProfiles(profiles);
    return profiles[index];
}

function generateCrosshairCommands(settings: ProfileCrosshairSettings): string {
    const commands = [
        `citadel_crosshair_pip_gap ${settings.pipGap}`,
        `citadel_crosshair_pip_height ${settings.pipHeight}`,
        `citadel_crosshair_pip_width ${settings.pipWidth}`,
        `citadel_crosshair_pip_opacity ${settings.pipOpacity.toFixed(2)}`,
        `citadel_crosshair_pip_border ${settings.pipBorder}`,
        `citadel_crosshair_dot_opacity ${settings.dotOpacity.toFixed(2)}`,
        `citadel_crosshair_dot_outline_opacity ${settings.dotOutlineOpacity.toFixed(2)}`,
        `citadel_crosshair_color_r ${settings.colorR}`,
        `citadel_crosshair_color_g ${settings.colorG}`,
        `citadel_crosshair_color_b ${settings.colorB}`,
    ];
    return commands.join('\n');
}

/** Outcome of resolving one ProfileMod against the current scan. The `via`
 *  field lets callers (and the diagnostic log) distinguish a real stable-id
 *  match from a best-effort fileName fallback, and surfaces the refused
 *  fileName cross-match case that was the cause of the
 *  "Profile apply misrecognizing mods to turn on" bug. */
type ResolvedMatch =
    | { mod: import('../../../src/types/mod').Mod; via: 'stable' | 'fileName' }
    | { mod: undefined; via: 'miss' | 'refused-crossmatch'; candidateFileName?: string };

/**
 * Build a resolver that maps a ProfileMod to one of the current scanned mods.
 *
 * Tries stable id first (`gameBananaId` + `gameBananaFileId`) so a mod can be
 * found after a fileName change. Falls back to fileName ONLY when neither the
 * profile entry nor the candidate currentMod carry GameBanana ids: this keeps
 * local-to-local fileName matching working for custom mods, while refusing to
 * cross-match a legacy stable-id-less profile entry to an unrelated
 * GameBanana mod that just happens to occupy the same pakNN_ slot today. The
 * unconditional fileName fallback used to silently enable the wrong mod after
 * any reorder rotated pakNN_ prefixes (Discord #bugs:
 * "Profile apply misrecognizing mods to turn on", 1.11.2).
 *
 * Stable-id matches that resolve to the same current mod are deduped on a
 * first-come basis so a profile with two entries pointing at the same
 * archive (shouldn't happen but possible after manual edits) can't double-
 * assign the same file.
 */
function buildProfileModResolver(
    currentMods: Array<import('../../../src/types/mod').Mod>
): (pm: ProfileMod) => ResolvedMatch {
    const byFileName = new Map<string, typeof currentMods[number]>();
    const byGbFile = new Map<string, typeof currentMods[number]>();
    const bySha256 = new Map<string, typeof currentMods[number]>();
    const metaByFileName = new Map<string, ReturnType<typeof getModMetadata>>();
    for (const mod of currentMods) {
        byFileName.set(mod.fileName, mod);
        const meta = getModMetadata(mod.fileName);
        metaByFileName.set(mod.fileName, meta);
        const gbId = meta?.gameBananaId;
        const fileId = meta?.gameBananaFileId;
        if (typeof gbId === 'number' && typeof fileId === 'number') {
            const key = `${gbId}:${fileId}`;
            if (!byGbFile.has(key)) byGbFile.set(key, mod);
        }
        if (typeof meta?.sha256 === 'string' && !bySha256.has(meta.sha256)) {
            bySha256.set(meta.sha256, mod);
        }
    }
    const claimed = new Set<string>();
    return (pm: ProfileMod): ResolvedMatch => {
        const profileHasStableIds =
            typeof pm.gameBananaId === 'number' &&
            typeof pm.gameBananaFileId === 'number';

        if (profileHasStableIds) {
            const stable = byGbFile.get(`${pm.gameBananaId}:${pm.gameBananaFileId}`);
            if (stable && !claimed.has(stable.id)) {
                claimed.add(stable.id);
                return { mod: stable, via: 'stable' };
            }
        }

        // Content fingerprint: a reliable identity that survives a fileName
        // change, so it's tried before the (slot-reuse-prone) fileName fallback.
        // Mainly rescues custom/local mods after they've been renamed free-form
        // by a disable, which no plain-fileName lookup could match.
        if (typeof pm.sha256 === 'string') {
            const byHash = bySha256.get(pm.sha256);
            if (byHash && !claimed.has(byHash.id)) {
                claimed.add(byHash.id);
                return { mod: byHash, via: 'stable' };
            }
        }

        const fallback = byFileName.get(pm.fileName);
        if (!fallback || claimed.has(fallback.id)) {
            return { mod: undefined, via: 'miss' };
        }

        // Refuse the fileName fallback whenever either side carries GameBanana
        // ids that the stable-id lookup couldn't reconcile. If both sides have
        // ids that disagree (or the profile entry has ids but the candidate
        // doesn't, or vice versa), the fileName collision is almost certainly
        // a slot reuse after a reorder, not the same mod. Returning the
        // candidate anyway is the bug we're fixing.
        const candidateMeta = metaByFileName.get(fallback.fileName);
        const candidateHasStableIds =
            typeof candidateMeta?.gameBananaId === 'number' &&
            typeof candidateMeta?.gameBananaFileId === 'number';
        if (profileHasStableIds || candidateHasStableIds) {
            return {
                mod: undefined,
                via: 'refused-crossmatch',
                candidateFileName: fallback.fileName,
            };
        }

        claimed.add(fallback.id);
        return { mod: fallback, via: 'fileName' };
    };
}

/** One-line tag for a profile entry in diagnostic logs. We keep it compact so
 *  a ~50-mod apply doesn't blow the rolling log budget, but include enough to
 *  correlate with the metadata sidecar and the user's GameBanana page. */
function describeProfileMod(pm: ProfileMod): string {
    if (typeof pm.gameBananaId === 'number' && typeof pm.gameBananaFileId === 'number') {
        return `gb=${pm.gameBananaId}:${pm.gameBananaFileId} (${pm.fileName})`;
    }
    return `local (${pm.fileName})`;
}

/**
 * Apply a profile - enable/disable mods, restore autoexec and crosshair
 */
export async function applyProfile(deadlockPath: string, profileId: string): Promise<Profile> {
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

    // 1. Apply Mods (enable/disable state).
    //
    // Resolve each profile mod against the current scan by stable id
    // (gameBananaId + gameBananaFileId) first, then by fileName ONLY when
    // both sides are stable-id-less (custom mods + truly-local current
    // mods). See buildProfileModResolver for the cross-match refusal that
    // landed in response to "Profile apply misrecognizing mods to turn on".
    const currentMods = await scanMods(deadlockPath);
    const resolveProfileMod = buildProfileModResolver(currentMods);

    // currentMod.id → ProfileMod, when matched. Drives the enable/disable
    // loop and the reorder pass below.
    const profileModByCurrentId = new Map<string, ProfileMod>();
    let stableHits = 0;
    let fileNameHits = 0;
    let unmatched = 0;
    let refusedCrossmatches = 0;
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

    let enabledCount = 0;
    let disabledCount = 0;
    let orphanedDisabledCount = 0;

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
        if (isLockerManaged(mod.fileName)) continue;
        const profileMod = profileModByCurrentId.get(mod.id);
        if (profileMod && profileMod.enabled) continue; // keep it enabled
        await disableMod(deadlockPath, mod.id);
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
        await enableMod(deadlockPath, mod.id);
        enabledCount++;
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
    const orderedFileNames: string[] = [];
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
        if (seen.has(resolution.mod.fileName)) continue;
        seen.add(resolution.mod.fileName);
        orderedFileNames.push(resolution.mod.fileName);
    }
    if (orderedFileNames.length > 0) {
        console.log(
            `[profiles] reorder: ${orderedFileNames.length} mods -> pak01..pak${orderedFileNames.length} ` +
            `(skipped ${reorderSkippedUnmatched} unmatched, ${reorderSkippedDisabled} disabled)`
        );
        await reorderMods(deadlockPath, orderedFileNames);
    } else {
        console.log(`[profiles] reorder: nothing to reorder`);
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
    return profile;
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
