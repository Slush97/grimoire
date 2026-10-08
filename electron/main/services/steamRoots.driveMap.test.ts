import { beforeEach, describe, expect, it, vi } from 'vitest';
import { basename, join, resolve } from 'path';
import { tmpdir } from 'os';
import { readBottleDriveMap } from './steamRoots';

const fsMocks = vi.hoisted(() => ({
    readdirSync: vi.fn<() => string[]>(),
    readlinkSync: vi.fn<(path: string) => string>(),
    existsSync: vi.fn<(path: string) => boolean>(),
}));

// Wine's c: filenames cannot be created on Windows. Mock those filesystem
// entries only; bottle discovery is tested against real folders in steamRoots.test.
vi.mock('fs', async (importOriginal) => ({
    ...await importOriginal<typeof import('fs')>(),
    ...fsMocks,
}));

const bottle = join(tmpdir(), 'grimoire-drive-map', 'Deadlock');
const hostLibrary = join(tmpdir(), 'grimoire-drive-map', 'HostGames');

beforeEach(() => {
    fsMocks.readdirSync.mockReturnValue(['c:', 'D:', 'z:', 'c::', 'com1']);
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.readlinkSync.mockImplementation((path) => {
        switch (basename(path)) {
            case 'c:': return '../drive_c';
            case 'D:': return hostLibrary;
            case 'z:': return resolve(tmpdir(), '..');
            default: throw new Error(`Unexpected drive link: ${path}`);
        }
    });
    vi.clearAllMocks();
});

describe('readBottleDriveMap', () => {
    it('resolves relative drive links against dosdevices', () => {
        expect(readBottleDriveMap(bottle)['c:']).toBe(join(bottle, 'drive_c'));
        expect(fsMocks.readlinkSync).toHaveBeenCalledWith(join(bottle, 'dosdevices', 'c:'));
    });

    it('keeps absolute targets, normalizes drive letters and ignores port/device links', () => {
        expect(readBottleDriveMap(bottle)).toEqual({
            'c:': join(bottle, 'drive_c'), 'd:': hostLibrary, 'z:': resolve(tmpdir(), '..'),
        });
        expect(fsMocks.readlinkSync).toHaveBeenCalledTimes(3);
    });

    it('returns an empty map when dosdevices is missing', () => {
        fsMocks.readdirSync.mockImplementationOnce(() => { throw new Error('Missing directory'); });
        expect(readBottleDriveMap(bottle)).toEqual({});
        expect(fsMocks.readlinkSync).not.toHaveBeenCalled();
    });

    it('uses an existing directory when a drive entry is not a symlink', () => {
        fsMocks.readdirSync.mockReturnValue(['c:']);
        fsMocks.readlinkSync.mockImplementation(() => { throw new Error('Not a symlink'); });
        fsMocks.existsSync.mockReturnValue(true);
        expect(readBottleDriveMap(bottle)).toEqual({ 'c:': join(bottle, 'dosdevices', 'c:') });
    });

    it('omits a drive entry whose link and directory cannot be read', () => {
        fsMocks.readdirSync.mockReturnValue(['c:']);
        fsMocks.readlinkSync.mockImplementation(() => { throw new Error('Unreadable link'); });
        expect(readBottleDriveMap(bottle)).toEqual({});
    });
});
