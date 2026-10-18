import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => harness.userData } }));

import { getMetadataPath } from '../utils/paths';
import * as vpkIdentity from './vpkIdentity';
import {
    backfillMissingMetadataHashes,
    backupMetadataSidecar,
    getModMetadata,
    loadMetadata,
    pruneOrphanMetadata,
    recoverPrunedIdentities,
    removeModMetadata,
    saveMetadata,
    setModMetadata,
    setModMetadataWithHash,
} from './metadata';

let sandbox: string;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const normalRow = { modName: 'Normal skin', gameBananaId: 111, sha256: hash('normal skin') };
const devRow = { modName: 'Sandbox mod', gameBananaId: 222, sha256: hash('sandbox skin') };
const mode = (devMode: boolean) => writeFileSync(join(harness.userData, 'settings.json'), JSON.stringify({ devMode }));
const put = (filePath: string, bytes: string) => {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, bytes);
};

beforeEach(() => {
    harness.userData = mkdtempSync(join(tmpdir(), 'metadata-dev-'));
    sandbox = join(harness.userData, 'dev-deadlock');
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(harness.userData, { recursive: true, force: true });
});

describe('separate developer metadata', () => {
    it('keeps writes, deletes and pruning separate for identical filenames', () => {
        saveMetadata({ 'pak01_dir.vpk': normalRow });
        const normalBytes = readFileSync(getMetadataPath(), 'utf8');
        mode(true);
        expect(loadMetadata()).toEqual({});
        setModMetadata('pak01_dir.vpk', devRow);
        setModMetadata('deleted_dir.vpk', { modName: 'Deleted sandbox file' });
        pruneOrphanMetadata(new Set(['pak01_dir.vpk']), sandbox);
        expect(loadMetadata()).toEqual({ 'pak01_dir.vpk': devRow });
        expect(readFileSync(getMetadataPath(), 'utf8')).toBe(normalBytes);

        mode(false);
        expect(getModMetadata('pak01_dir.vpk')).toEqual(normalRow);
        removeModMetadata('pak01_dir.vpk');
        mode(true);
        expect(getModMetadata('pak01_dir.vpk')).toEqual(devRow);
        mode(false);
        expect(loadMetadata()).toEqual({});
    });

    it('keys its cache by sidecar path even when timestamps and sizes match', () => {
        put(getMetadataPath(false), JSON.stringify({ 'pak01_dir.vpk': { modName: 'AAAA' } }));
        put(getMetadataPath(true), JSON.stringify({ 'pak01_dir.vpk': { modName: 'BBBB' } }));
        const stamp = new Date('2026-10-17T10:00:00Z');
        utimesSync(getMetadataPath(false), stamp, stamp);
        utimesSync(getMetadataPath(true), stamp, stamp);
        expect(statSync(getMetadataPath(false)).size).toBe(statSync(getMetadataPath(true)).size);
        expect(getModMetadata('pak01_dir.vpk')?.modName).toBe('AAAA');
        mode(true);
        expect(getModMetadata('pak01_dir.vpk')?.modName).toBe('BBBB');
        mode(false);
        expect(getModMetadata('pak01_dir.vpk')?.modName).toBe('AAAA');
    });

    it.each([false, true])('discards hashes when the mode changes before the locked write (starts in dev: %s)', async (startsInDev) => {
        const normal = { 'pak01_dir.vpk': { modName: 'Normal skin', gameBananaId: 111 } };
        const developer = { 'pak01_dir.vpk': { modName: 'Sandbox skin', gameBananaId: 222 } };
        const normalBytes = JSON.stringify(normal);
        const devBytes = JSON.stringify(developer);
        put(getMetadataPath(false), normalBytes);
        put(getMetadataPath(true), devBytes);
        const normalRoot = join(harness.userData, 'real-game');
        put(join(normalRoot, 'game/citadel/addons/pak01_dir.vpk'), 'normal skin');
        put(join(sandbox, 'game/citadel/addons/pak01_dir.vpk'), 'sandbox skin');
        mode(startsInDev);

        const updated = await backfillMissingMetadataHashes(startsInDev ? sandbox : normalRoot, async (apply) => {
            mode(!startsInDev);
            return apply();
        });

        expect(updated).toBe(0);
        expect(readFileSync(getMetadataPath(false), 'utf8')).toBe(normalBytes);
        expect(readFileSync(getMetadataPath(true), 'utf8')).toBe(devBytes);
    });

    it.each([false, true])('refuses a metadata write if its mode changes while hashing (starts in dev: %s)', async (startsInDev) => {
        const normalBytes = JSON.stringify({ 'pak01_dir.vpk': normalRow });
        const devBytes = JSON.stringify({ 'pak01_dir.vpk': devRow });
        put(getMetadataPath(false), normalBytes);
        put(getMetadataPath(true), devBytes);
        mode(startsInDev);
        let finishHash!: (identity: Awaited<ReturnType<typeof vpkIdentity.resolveVpkIdentity>>) => void;
        vi.spyOn(vpkIdentity, 'resolveVpkIdentity').mockImplementationOnce(() => new Promise((resolve) => {
            finishHash = resolve;
        }));

        const write = setModMetadataWithHash('pak01_dir.vpk', { modName: 'Changed identity' }, join(sandbox, 'pak01_dir.vpk'));
        mode(!startsInDev);
        finishHash({ sha256: hash('changed skin'), source: 'live' });

        await expect(write).rejects.toThrow('metadata mode changed');
        expect(readFileSync(getMetadataPath(false), 'utf8')).toBe(normalBytes);
        expect(readFileSync(getMetadataPath(true), 'utf8')).toBe(devBytes);
    });

    it('keeps sidecar backup creation and identity recovery within the active mode', () => {
        saveMetadata({ 'pak01_dir.vpk': normalRow });
        expect(backupMetadataSidecar('pre-prune')).toContain('mod-metadata.backups');
        mode(true);
        saveMetadata({ 'pak01_dir.vpk': devRow });
        expect(backupMetadataSidecar('pre-prune')).toContain('mod-metadata.dev.backups');
        saveMetadata({ 'pak01_dir.vpk': { sha256: devRow.sha256 }, 'pak02_dir.vpk': { sha256: normalRow.sha256 } });
        expect(recoverPrunedIdentities()).toBe(1);
        expect(getModMetadata('pak01_dir.vpk')?.modName).toBe(devRow.modName);
        expect(getModMetadata('pak02_dir.vpk')?.modName).toBeUndefined();
        mode(false);
        expect(loadMetadata()).toEqual({ 'pak01_dir.vpk': normalRow });
    });
});
