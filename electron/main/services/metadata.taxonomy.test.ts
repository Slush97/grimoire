import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => harness.userData } }));
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return { ...actual, copyFileSync: vi.fn(actual.copyFileSync), renameSync: vi.fn(actual.renameSync) };
});
vi.mock('./vpkIdentity', () => ({ resolveVpkIdentity: vi.fn() }));

import { copyFileSync, renameSync } from 'fs';
import { getMetadataPath } from '../utils/paths';
import {
    getModMetadata, hasModIdentity, loadMetadata, metadataBackupDirectory, sanitizeLinkedModMetadata,
    saveMetadata, setModMetadata, type ModMetadata, type ModMetadataMap,
} from './metadata';

const linked: ModMetadata = {
    modName: 'Downloaded HUD', gameBananaId: 123, categoryId: 10, categoryName: 'HUD',
    globalType: 'hud', globalTypeClassifierVersion: 5, sha256: 'a'.repeat(64),
};
const sound: ModMetadata = {
    ...linked, sourceSection: 'Sound', lockerHero: 'Vindicta', lockerHeroSource: 'download-title',
    lockerHeroVpkChecked: true, sourceFileName: 'lady_geist_sounds', fileDescription: 'Voice replacement',
};
const local: ModMetadata = {
    modName: 'Local HUD', globalType: 'hud', globalTypeClassifierVersion: 5,
    lockerHero: 'Baba', lockerHeroSource: 'title',
};
const mode = (devMode: boolean) => writeFileSync(join(harness.userData, 'settings.json'), JSON.stringify({ devMode }));
const put = (rows: ModMetadataMap, devMode = false) => {
    const bytes = JSON.stringify(rows);
    writeFileSync(getMetadataPath(devMode), bytes);
    return bytes;
};

beforeEach(() => {
    harness.userData = mkdtempSync(join(tmpdir(), 'metadata-taxonomy-'));
    vi.mocked(copyFileSync).mockClear();
    vi.mocked(renameSync).mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    rmSync(harness.userData, { recursive: true, force: true });
});

describe('category taxonomy metadata migration', () => {
    it('retains explicit General choices as user identity, including an unassigned choice', () => {
        expect(hasModIdentity({ globalType: 'hud', globalTypeSource: 'manual' })).toBe(true);
        expect(hasModIdentity({ globalType: null, globalTypeSource: 'manual' })).toBe(true);
        expect(hasModIdentity({ globalType: 'hud' })).toBe(false);
    });
    it('backs up original bytes and removes linked legacy classifications once while preserving provenance and local choices', () => {
        const rows: ModMetadataMap = {
            linked,
            sound,
            wip: { ...sound, sourceSection: 'Wip', lockerHeroSource: undefined },
            manualHero: { ...sound, lockerHero: 'Baba', lockerHeroSource: 'manual' },
            manualGeneral: { ...linked, globalType: 'effects', globalTypeSource: 'manual' },
            local,
        };
        const original = put(rows);
        const migrated = loadMetadata();
        expect(migrated.linked).toEqual({
            modName: linked.modName, gameBananaId: 123, categoryId: 10, categoryName: 'HUD', sha256: linked.sha256,
        });
        expect(migrated.sound).not.toHaveProperty('lockerHero');
        expect(migrated.sound).not.toHaveProperty('lockerHeroSource');
        expect(migrated.sound).not.toHaveProperty('lockerHeroVpkChecked');
        expect(migrated.sound.sourceFileName).toBe(sound.sourceFileName);
        expect(migrated.wip).not.toHaveProperty('lockerHero');
        expect(migrated.manualHero.lockerHero).toBe('Baba');
        expect(migrated.manualHero.lockerHeroSource).toBe('manual');
        expect(migrated.manualGeneral.globalType).toBe('effects');
        expect(migrated.manualGeneral.globalTypeSource).toBe('manual');
        expect(migrated.manualGeneral).not.toHaveProperty('globalTypeClassifierVersion');
        expect(migrated.local).toEqual(local);

        const backups = readdirSync(metadataBackupDirectory());
        expect(backups).toHaveLength(1);
        expect(backups[0]).toContain('pre-category-tags');
        expect(readFileSync(join(metadataBackupDirectory(), backups[0]), 'utf8')).toBe(original);
        expect(loadMetadata()).toBe(migrated);
        expect(readdirSync(metadataBackupDirectory())).toEqual(backups);
        expect(renameSync).toHaveBeenCalledTimes(1);
    });

    it('does not cache or change metadata when its required backup fails, and retries safely', () => {
        const original = put({ linked });
        vi.mocked(copyFileSync).mockImplementationOnce(() => { throw new Error('backup denied'); });
        expect(() => loadMetadata()).toThrow('without a metadata backup');
        expect(readFileSync(getMetadataPath(), 'utf8')).toBe(original);
        expect(renameSync).not.toHaveBeenCalled();
        expect(loadMetadata().linked).not.toHaveProperty('globalType');
        expect(readFileSync(getMetadataPath(), 'utf8')).not.toBe(original);
    });

    it('propagates atomic-write failures without returning an empty library or leaving a partially migrated cache', () => {
        const original = put({ linked, local });
        vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error('rename denied'); });
        expect(() => loadMetadata()).toThrow('rename denied');
        expect(readFileSync(getMetadataPath(), 'utf8')).toBe(original);
        expect(readdirSync(harness.userData)).not.toContain('mod-metadata.json.tmp');
        expect(readdirSync(metadataBackupDirectory())).toHaveLength(1);
        const retried = loadMetadata();
        expect(retried.linked).not.toHaveProperty('globalType');
        expect(retried.local).toEqual(local);
    });

    it('migrates and backs up normal and developer files independently', () => {
        const normalBytes = put({ normal: linked });
        const devBytes = put({ dev: sound }, true);
        expect(loadMetadata().normal).not.toHaveProperty('globalType');
        expect(readFileSync(getMetadataPath(true), 'utf8')).toBe(devBytes);
        const normalAfter = readFileSync(getMetadataPath(false), 'utf8');
        const normalBackup = readdirSync(metadataBackupDirectory(getMetadataPath(false)))[0];
        expect(readFileSync(join(metadataBackupDirectory(getMetadataPath(false)), normalBackup), 'utf8')).toBe(normalBytes);

        mode(true);
        expect(loadMetadata().dev).not.toHaveProperty('lockerHero');
        const devBackup = readdirSync(metadataBackupDirectory(getMetadataPath(true)))[0];
        expect(readFileSync(join(metadataBackupDirectory(getMetadataPath(true)), devBackup), 'utf8')).toBe(devBytes);
        expect(readFileSync(getMetadataPath(false), 'utf8')).toBe(normalAfter);
    });

    it('sanitizes restored or imported legacy metadata at every write without removing current detection or manual choices', () => {
        saveMetadata({});
        setModMetadata('restored', sound);
        expect(getModMetadata('restored')).not.toHaveProperty('globalType');
        expect(getModMetadata('restored')).not.toHaveProperty('lockerHero');
        const heroDetection = {
            version: 1, heroes: ['Lady Geist', 'Vindicta'], source: 'vpk' as const,
            size: 123, modifiedAt: '2026-10-26T00:00:00Z', inputs: 'file-labels',
        };
        setModMetadata('restored', { heroDetection });
        setModMetadata('manual', { ...sound, globalType: null, globalTypeSource: 'manual', lockerHeroSource: 'manual' });
        setModMetadata('local', local);
        expect(getModMetadata('restored')?.heroDetection).toEqual(heroDetection);
        expect(getModMetadata('manual')).toMatchObject({ globalType: null, globalTypeSource: 'manual', lockerHero: 'Vindicta' });
        expect(getModMetadata('local')).toEqual(local);
        expect(sanitizeLinkedModMetadata(local)).toBe(local);
        expect(sound.globalType).toBe('hud');
        expect(sound.lockerHero).toBe('Vindicta');
    });
});
