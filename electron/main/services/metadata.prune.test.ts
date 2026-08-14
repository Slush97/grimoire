/**
 * Coverage for pruneOrphanMetadata's refusal to empty a populated sidecar.
 *
 * The prune exists to drop rows whose VPK is gone (issue #26: a dead mod's
 * gameBananaId leaking onto whatever install next lands in its pakNN slot). It
 * runs on every get-mods against whatever the scan returned, and a scan returns
 * nothing whenever the Deadlock folder stops resolving for a moment (Steam
 * mid-update after a reboot, a moved library, a drive that has not come up).
 * The scan roots are created on demand, so that case reads as a clean empty
 * addons folder rather than an error. Reported 2026-08-14: 26 mods reduced to
 * "Pak01".."Pak31", every name, id and thumbnail gone with no way back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const harness = vi.hoisted(() => ({ userData: '' }));

vi.mock('electron', () => ({ app: { getPath: () => harness.userData } }));
vi.mock('./vpkIdentity', () => ({
    resolveVpkIdentity: vi.fn(async () => ({ sha256: 'f'.repeat(64) })),
}));

import { loadMetadata, pruneOrphanMetadata, saveMetadata } from './metadata';

const POPULATED = {
    'pak01_dir.vpk': { modName: 'Bikinidicta', gameBananaId: 554012 },
    'pak02_dir.vpk': { modName: 'Ghost Bride Vindicta', gameBananaId: 663268 },
    'grimoire/pak05_dir.vpk': { modName: 'Top Bar HUD', gameBananaId: 703330 },
    'locker:cards': { lockerCosmetics: { cards: [], rebuiltAt: '2026-08-14T00:00:00.000Z' } },
};

beforeEach(() => {
    harness.userData = mkdtempSync(join(tmpdir(), 'metadata-prune-user-'));
    saveMetadata({});
});

describe('pruneOrphanMetadata', () => {
    it('refuses to clear the sidecar when the scan found nothing', () => {
        saveMetadata({ ...POPULATED });

        pruneOrphanMetadata(new Set());

        expect(loadMetadata()).toEqual(POPULATED);
    });

    it('still drops real orphans when the scan found something', () => {
        saveMetadata({ ...POPULATED });

        pruneOrphanMetadata(new Set(['pak01_dir.vpk', 'grimoire/pak05_dir.vpk']));

        const after = loadMetadata();
        expect(Object.keys(after).sort()).toEqual([
            'grimoire/pak05_dir.vpk',
            'locker:cards',
            'pak01_dir.vpk',
        ]);
        expect(after['pak02_dir.vpk']).toBeUndefined();
    });

    it('never treats a Locker selection set as an orphan', () => {
        // locker:* rows key the Locker-managed VPKs in citadel/grimoire, which
        // are not scanned filenames, so they can never appear in validKeys.
        saveMetadata({ 'locker:cards': { lockerCosmetics: { cards: [], rebuiltAt: '2026-08-14T00:00:00.000Z' } }, 'pak01_dir.vpk': {} });

        pruneOrphanMetadata(new Set(['pak01_dir.vpk']));

        expect(loadMetadata()['locker:cards']).toBeDefined();
    });

    it('leaves an already-empty sidecar alone', () => {
        pruneOrphanMetadata(new Set());

        expect(loadMetadata()).toEqual({});
    });
});
