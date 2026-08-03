import { describe, it, expect } from 'vitest';
import { isReservedPriorityVpk, isPriorityFolderPath, metaKeyFor, PRIORITY_FIRST_SLOT } from './deadlock';

/**
 * The priority root (citadel/grimoire) mixes two populations: the Locker's own
 * managed VPKs in pak01-pak04, keyed by synthetic metadata keys, and user
 * "Global" mods in pak05+. Confusing the two is the failure that would surface
 * as phantom mods in the user's list (managed VPKs scanned as user mods) or as
 * a destroyed Locker override (a user mod allocated over pak01), so the split
 * is pinned here rather than left to the call sites.
 */
describe('isReservedPriorityVpk', () => {
    it('reserves the four Locker-managed slots', () => {
        expect(isReservedPriorityVpk('pak01_dir.vpk')).toBe(true);
        expect(isReservedPriorityVpk('pak02_dir.vpk')).toBe(true);
        expect(isReservedPriorityVpk('pak03_dir.vpk')).toBe(true);
        expect(isReservedPriorityVpk('pak04_dir.vpk')).toBe(true);
    });

    it('leaves the user range free', () => {
        expect(isReservedPriorityVpk('pak05_dir.vpk')).toBe(false);
        expect(isReservedPriorityVpk('pak99_dir.vpk')).toBe(false);
    });

    it('agrees with PRIORITY_FIRST_SLOT', () => {
        const first = `pak${String(PRIORITY_FIRST_SLOT).padStart(2, '0')}_dir.vpk`;
        const last = `pak${String(PRIORITY_FIRST_SLOT - 1).padStart(2, '0')}_dir.vpk`;
        expect(isReservedPriorityVpk(first)).toBe(false);
        expect(isReservedPriorityVpk(last)).toBe(true);
    });

    it('ignores non-pakNN names', () => {
        expect(isReservedPriorityVpk('something.vpk')).toBe(false);
        expect(isReservedPriorityVpk('pak01.vpk')).toBe(false);
    });
});

describe('isPriorityFolderPath', () => {
    it('matches only the grimoire root', () => {
        expect(isPriorityFolderPath('/game/citadel/grimoire/pak05_dir.vpk')).toBe(true);
        expect(isPriorityFolderPath('/game/citadel/addons/pak05_dir.vpk')).toBe(false);
        expect(isPriorityFolderPath('/game/citadel/addons1/pak05_dir.vpk')).toBe(false);
        expect(isPriorityFolderPath('/game/citadel/.disabled/whatever.vpk')).toBe(false);
    });
});

describe('metaKeyFor', () => {
    // A priority-root mod must not share a key with a base-addons mod holding
    // the same pakNN, or moving a mod into Global would collide with an
    // unrelated mod's metadata and swap their identities.
    it('namespaces priority-root mods', () => {
        expect(metaKeyFor('/game/citadel/grimoire/pak05_dir.vpk')).toBe('grimoire/pak05_dir.vpk');
    });

    it('leaves base addons and .disabled keys bare (no migration for existing installs)', () => {
        expect(metaKeyFor('/game/citadel/addons/pak05_dir.vpk')).toBe('pak05_dir.vpk');
        expect(metaKeyFor('/game/citadel/.disabled/pak05_dir.vpk')).toBe('pak05_dir.vpk');
    });

    it('still namespaces overflow folders', () => {
        expect(metaKeyFor('/game/citadel/addons1/pak05_dir.vpk')).toBe('addons1/pak05_dir.vpk');
    });
});
