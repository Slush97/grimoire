/**
 * Coverage for pruneOrphanMetadata: a metadata row is only dropped when its VPK
 * is confirmed gone from disk, never because a scan failed to mention it.
 *
 * The prune exists to drop rows whose VPK is gone (issue #26: a dead mod's
 * gameBananaId leaking onto whatever install next lands in its pakNN slot). It
 * runs on every get-mods against whatever the scan returned, and the scan can
 * come back short for reasons that say nothing about what the user deleted:
 *
 *  - the Deadlock folder stops resolving for a moment (Steam mid-update after a
 *    reboot, a moved library, a drive that has not come up), and because the
 *    scan roots are created on demand it reads as a clean empty addons folder
 *    rather than an error. Reported 2026-08-14: 26 mods reduced to
 *    "Pak01".."Pak31", every name, id and thumbnail gone with no way back;
 *  - getAddonFolderPaths falls back to base-only when citadel/ is unreadable,
 *    dropping every overflow-folder mod from the set at once;
 *  - scanFolder skips any file whose stat throws, e.g. antivirus holding one
 *    VPK open.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
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
    'addons1/pak03_dir.vpk': { modName: 'Vatican Vindicta', gameBananaId: 694568 },
    'grimoire/pak05_dir.vpk': { modName: 'Top Bar HUD', gameBananaId: 703330 },
    'ghost_bride_vindicta_dir.vpk': { modName: 'Ghost Bride (disabled copy)' },
    'locker:cards': { lockerCosmetics: { cards: [], rebuiltAt: '2026-08-14T00:00:00.000Z' } },
};

/** Every VPK in POPULATED, laid out on disk the way metaKeyFor addresses it:
 *  bare keys in citadel/addons (or its .disabled parking lot), prefixed keys in
 *  the priority root and the overflow folders. */
function createInstall(): string {
    const root = mkdtempSync(join(tmpdir(), 'metadata-prune-game-'));
    const citadel = join(root, 'game', 'citadel');
    for (const folder of ['addons', join('addons', '.disabled'), 'addons1', 'grimoire']) {
        mkdirSync(join(citadel, folder), { recursive: true });
    }
    writeFileSync(join(citadel, 'addons', 'pak01_dir.vpk'), 'vpk');
    writeFileSync(join(citadel, 'addons', 'pak02_dir.vpk'), 'vpk');
    writeFileSync(join(citadel, 'addons1', 'pak03_dir.vpk'), 'vpk');
    writeFileSync(join(citadel, 'grimoire', 'pak05_dir.vpk'), 'vpk');
    writeFileSync(join(citadel, 'addons', '.disabled', 'ghost_bride_vindicta_dir.vpk'), 'vpk');
    return root;
}

const created: string[] = [];

beforeEach(() => {
    harness.userData = mkdtempSync(join(tmpdir(), 'metadata-prune-user-'));
    created.push(harness.userData);
    saveMetadata({});
});

afterEach(() => {
    for (const dir of created.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function install(): string {
    const root = createInstall();
    created.push(root);
    return root;
}

describe('pruneOrphanMetadata', () => {
    it('refuses to clear the sidecar when the scan found nothing', () => {
        const game = install();
        saveMetadata({ ...POPULATED });

        pruneOrphanMetadata(new Set(), game);

        expect(loadMetadata()).toEqual(POPULATED);
    });

    it('refuses even when the whole install has gone missing under it', () => {
        // Nothing resolves, so every row looks orphaned by the disk check too.
        // This is the reported failure: a path that stopped resolving.
        saveMetadata({ ...POPULATED });

        pruneOrphanMetadata(new Set(), join(tmpdir(), 'metadata-prune-not-here'));

        expect(loadMetadata()).toEqual(POPULATED);
    });

    it('keeps rows for VPKs the scan missed but disk still has', () => {
        // citadel/ unreadable => getAddonFolderPaths returns base-only, so every
        // overflow mod drops out of the scan; and one stat failure drops
        // pak02. Both files are still there, so both rows must survive.
        const game = install();
        saveMetadata({ ...POPULATED });

        pruneOrphanMetadata(new Set(['pak01_dir.vpk', 'grimoire/pak05_dir.vpk']), game);

        const after = loadMetadata();
        expect(after['addons1/pak03_dir.vpk']).toBeDefined();
        expect(after['pak02_dir.vpk']).toBeDefined();
        expect(after).toEqual(POPULATED);
    });

    it('finds a bare key parked in .disabled, not just in addons', () => {
        const game = install();
        saveMetadata({ ...POPULATED });

        // A disabled mod is absent from the enabled scan by definition.
        pruneOrphanMetadata(new Set(['pak01_dir.vpk']), game);

        expect(loadMetadata()['ghost_bride_vindicta_dir.vpk']).toBeDefined();
    });

    it('still drops a row whose VPK is genuinely gone (the #26 self-heal)', () => {
        const game = install();
        saveMetadata({ ...POPULATED, 'pak09_dir.vpk': { modName: 'Deleted Behind Our Back' } });

        pruneOrphanMetadata(new Set(['pak01_dir.vpk']), game);

        const after = loadMetadata();
        expect(after['pak09_dir.vpk']).toBeUndefined();
        // and nothing else went with it
        expect(after).toEqual(POPULATED);
    });

    it('never treats a Locker selection set as an orphan', () => {
        // locker:* rows key the Locker-managed VPKs in citadel/grimoire, which
        // are not scanned filenames, so they can never appear in validKeys.
        const game = install();
        saveMetadata({ ...POPULATED });

        pruneOrphanMetadata(new Set(['pak01_dir.vpk']), game);

        expect(loadMetadata()['locker:cards']).toBeDefined();
    });

    it('leaves an already-empty sidecar alone', () => {
        pruneOrphanMetadata(new Set(), install());

        expect(loadMetadata()).toEqual({});
    });
});
