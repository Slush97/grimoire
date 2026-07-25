import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const harness = vi.hoisted(() => ({
    userData: '',
    identities: new Map<string, string>(),
}));

vi.mock('electron', () => ({ app: { getPath: () => harness.userData } }));
vi.mock('./vpkIdentity', () => ({
    resolveVpkIdentity: vi.fn(async (filePath: string) => ({
        sha256: harness.identities.get(filePath) ?? 'f'.repeat(64),
    })),
}));

import {
    backfillMissingMetadataHashes,
    getModMetadata,
    migrateModMetadata,
    saveMetadata,
} from './metadata';
import { resolveVpkIdentity } from './vpkIdentity';

const hash = (letter: string) => letter.repeat(64);

function createDeadlockRoot(): { root: string; addons: string; disabled: string } {
    const root = mkdtempSync(join(tmpdir(), 'metadata-backfill-game-'));
    const addons = join(root, 'game', 'citadel', 'addons');
    const disabled = join(addons, '.disabled');
    mkdirSync(disabled, { recursive: true });
    return { root, addons, disabled };
}

beforeEach(() => {
    harness.userData = mkdtempSync(join(tmpdir(), 'metadata-backfill-user-'));
    harness.identities.clear();
    saveMetadata({});
    vi.mocked(resolveVpkIdentity).mockClear();
});

describe('backfillMissingMetadataHashes', () => {
    it('creates a minimal hash row for a raw VPK and skips an existing valid row', async () => {
        const { root, addons } = createDeadlockRoot();
        const knownPath = join(addons, 'pak01_dir.vpk');
        const rawPath = join(addons, 'pak02_dir.vpk');
        writeFileSync(knownPath, 'known');
        writeFileSync(rawPath, 'raw');
        saveMetadata({
            'pak01_dir.vpk': { modName: 'Known', sha256: hash('a') },
        });
        harness.identities.set(rawPath, hash('b'));

        const updated = await backfillMissingMetadataHashes(root);

        expect(updated).toBe(1);
        expect(getModMetadata('pak01_dir.vpk')).toEqual({
            modName: 'Known',
            sha256: hash('a'),
        });
        expect(getModMetadata('pak02_dir.vpk')).toEqual({ sha256: hash('b') });
        expect(resolveVpkIdentity).toHaveBeenCalledTimes(1);
        expect(resolveVpkIdentity).toHaveBeenCalledWith(rawPath);
    });

    it('stores the embed-aware canonical identity returned for an imprinted VPK', async () => {
        const { root, disabled } = createDeadlockRoot();
        const imprintedPath = join(disabled, 'local_skin_dir.vpk');
        writeFileSync(imprintedPath, 'post-imprint bytes');
        harness.identities.set(imprintedPath, hash('c'));

        await backfillMissingMetadataHashes(root);

        expect(getModMetadata('local_skin_dir.vpk')).toEqual({ sha256: hash('c') });
        expect(resolveVpkIdentity).toHaveBeenCalledWith(imprintedPath);
    });

    it('migrates a minimal hash row with its mod across a metaKey rename', () => {
        saveMetadata({ 'pak03_dir.vpk': { sha256: hash('d') } });

        migrateModMetadata([
            { from: 'pak03_dir.vpk', to: 'local_skin_dir.vpk' },
        ]);

        expect(getModMetadata('pak03_dir.vpk')).toBeUndefined();
        expect(getModMetadata('local_skin_dir.vpk')).toEqual({ sha256: hash('d') });
    });
});
