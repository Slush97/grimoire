/**
 * Locker effects per profile: ability colors and trippy skins.
 *
 * A profile stores the picks (hue, style and so on), not a VPK. Applying it
 * rebuilds the two managed packs in citadel/grimoire to match, reusing the
 * per-hero bake caches. Hero cards and ability sounds stay install-wide: they
 * point at a source mod the other profile may not have enabled.
 *
 * Lives outside profiles.ts because modMerger imports that file, and the color
 * services import modMerger.
 */
import type { ProfileLocker } from '../../../src/types/electron';
import { listAppliedColors, setLockerColors } from './heroColors';
import { listAppliedTrippySkins, setTrippySkins } from './trippyEffects';
import { setProfileLocker } from './profiles';
import { loadSettings, saveSettings } from './settings';

/** The ability colors and trippy skins applied in the Locker right now. */
export function currentProfileLocker(): ProfileLocker {
    return { colors: listAppliedColors(), trippySkins: listAppliedTrippySkins() };
}

/**
 * Rebuild the Locker effects to a profile's saved set. A profile without one
 * (saved before profiles carried effects, or imported) leaves the Locker as it
 * is. Returns the error message when a rebuild fails (a bake error, or a pack
 * locked by the running game) instead of throwing: the profile's mods are
 * already applied by then. A failure holds the profile's saved effects
 * (`lockerUnappliedProfileId`) until a later apply succeeds.
 */
export async function applyProfileLocker(
    deadlockPath: string,
    profileId: string,
    locker: ProfileLocker | undefined,
): Promise<string | undefined> {
    let message: string | undefined;
    if (locker) {
        try {
            await setLockerColors(deadlockPath, locker.colors ?? []);
            await setTrippySkins(deadlockPath, locker.trippySkins ?? []);
        } catch (err) {
            message = err instanceof Error ? err.message : String(err);
            console.warn(`[profiles] Locker effects failed to apply: ${message}`);
        }
    }
    saveSettings({ ...loadSettings(), lockerUnappliedProfileId: message ? profileId : null });
    return message;
}

/** An Update stores the Locker as it is in the profile on purpose, which ends a failed apply's hold on it. */
export function releaseLockerHold(profileId: string): void {
    const settings = loadSettings();
    if (settings.lockerUnappliedProfileId === profileId) saveSettings({ ...settings, lockerUnappliedProfileId: null });
}

/**
 * Store the Locker's current effects in the active profile. Called after every
 * Locker color or trippy-skin edit, so each profile keeps its own effects
 * without a manual Update. No-op when no saved profile is active, or when the
 * active profile's effects failed to apply: the Locker then holds a mix of two
 * profiles, which would replace the effects the profile saved.
 */
export function saveLockerToActiveProfile(): void {
    const { activeProfileId, lockerUnappliedProfileId } = loadSettings();
    if (activeProfileId && activeProfileId !== lockerUnappliedProfileId) setProfileLocker(activeProfileId, currentProfileLocker());
}
