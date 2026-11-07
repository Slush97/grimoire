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
    it('persists repaired leaf categories for old entries and variants without rewriting unchanged data', () => {
        const flag = { gameBananaId: 723508, categoryId: 49629, categoryName: 'RatKing', sha256: 'b'.repeat(64) };
        const original = put({ first: flag, second: { ...flag, variantLabel: 'Ivy' } });
        expect(loadMetadata().first).toEqual(flag);
        const resolveCategory = vi.fn(() => ({ id: 49852, name: 'RatKing Flag' }));
        const repaired = loadMetadata(resolveCategory);
        expect(repaired.first).toEqual({ ...flag, categoryId: 49852, categoryName: 'Rat King Flag' });
        expect(repaired.second).toEqual({ ...repaired.first, variantLabel: 'Ivy' });
        expect(JSON.parse(readFileSync(getMetadataPath(), 'utf8'))).toEqual(repaired);
        const backup = readdirSync(metadataBackupDirectory())[0];
        expect(readFileSync(join(metadataBackupDirectory(), backup), 'utf8')).toBe(original);
        resolveCategory.mockClear();
        expect(loadMetadata(resolveCategory)).toBe(repaired);
        expect(resolveCategory).toHaveBeenCalledTimes(2);
        expect(renameSync).toHaveBeenCalledTimes(1);
        expect(copyFileSync).toHaveBeenCalledTimes(1);
        resolveCategory.mockReturnValue({ id: 99, name: 'Later category' });
        expect(loadMetadata(resolveCategory).first).toMatchObject({ categoryId: 99, categoryName: 'Later category' });
        expect(renameSync).toHaveBeenCalledTimes(2);
    });

    it('leaves unavailable categories pending and retries cached metadata when data becomes available', () => {
        const original = put({ linked: { gameBananaId: 123, categoryId: 10, categoryName: 'Old category' }, local });
        const unavailable = vi.fn(() => undefined);
        const pending = loadMetadata(unavailable);
        expect(pending.linked).toEqual({ gameBananaId: 123, categoryId: 10, categoryName: 'Old category' });
        expect(unavailable).toHaveBeenCalledTimes(1);
        expect(readFileSync(getMetadataPath(), 'utf8')).toBe(original);
        expect(copyFileSync).not.toHaveBeenCalled();
        const repaired = loadMetadata(() => ({ id: 20, name: 'New category' }));
        expect(repaired.linked).toMatchObject({ categoryId: 20, categoryName: 'New category' });
        expect(repaired.local).toEqual(local);
    });

    it('repairs categories while preserving manual choices and unrelated per-file metadata', () => {
        put({
            manual: { ...sound, lockerHeroSource: 'manual', globalTypeSource: 'manual', globalType: null },
            automatic: sound,
            local,
        });
        const repaired = loadMetadata(() => ({ id: 20, name: 'VOs' }));
        expect(repaired.manual).toMatchObject({
            categoryId: 20, categoryName: 'VOs',
            lockerHero: 'Vindicta', lockerHeroSource: 'manual', globalType: null, globalTypeSource: 'manual',
            sourceFileName: sound.sourceFileName, fileDescription: sound.fileDescription, sha256: sound.sha256,
        });
        expect(repaired.automatic).not.toHaveProperty('lockerHero');
        expect(repaired.automatic).not.toHaveProperty('globalType');
        expect(repaired.local).toEqual(local);
        expect(renameSync).toHaveBeenCalledTimes(1);
    });

    it.each(['backup', 'write'])('does not persist repaired categories after a failed %s', failure => {
        const original = put({ linked: { gameBananaId: 123, categoryId: 10, categoryName: 'Old category' } });
        if (failure === 'backup') vi.mocked(copyFileSync).mockImplementationOnce(() => { throw new Error('backup denied'); });
        else vi.mocked(renameSync).mockImplementationOnce(() => { throw new Error('rename denied'); });
        const resolveCategory = () => ({ id: 20, name: 'New category' });
        expect(() => loadMetadata(resolveCategory)).toThrow();
        expect(readFileSync(getMetadataPath(), 'utf8')).toBe(original);
        expect(loadMetadata().linked.categoryId).toBe(10);
        expect(loadMetadata(resolveCategory).linked.categoryId).toBe(20);
    });

    it('repairs normal and developer metadata independently while leaving correct categories unchanged', () => {
        put({ old: { gameBananaId: 123 }, fresh: { gameBananaId: 456, categoryId: 30, categoryName: 'Fresh' } });
        const devBytes = put({ old: { gameBananaId: 123 } }, true);
        const resolveCategory = vi.fn((row: ModMetadata) => row.gameBananaId === 456
            ? { id: 30, name: 'Fresh' } : { id: 20, name: 'New category' });
        expect(loadMetadata(resolveCategory).fresh.categoryId).toBe(30);
        expect(resolveCategory).toHaveBeenCalledTimes(2);
        expect(readFileSync(getMetadataPath(true), 'utf8')).toBe(devBytes);
        mode(true);
        expect(loadMetadata(resolveCategory).old.categoryId).toBe(20);
        expect(resolveCategory).toHaveBeenCalledTimes(3);
        expect(readdirSync(metadataBackupDirectory(getMetadataPath(false)))).toHaveLength(1);
        expect(readdirSync(metadataBackupDirectory(getMetadataPath(true)))).toHaveLength(1);
    });

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
