import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';

const h = vi.hoisted(() => ({ userData: '', trace: false }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => false, readStash: async () => null }));
vi.mock('./settings', async (importOriginal) => ({
    ...await importOriginal<typeof import('./settings')>(),
    loadSettings: () => ({ verboseModTrace: h.trace }),
}));

import { scanMods, scanModsReadOnly } from './mods';

let root: string;
let addons: string;

beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'mods-scan-'));
    addons = join(root, 'game/citadel/addons');
    h.userData = join(root, 'userdata');
    h.trace = false;
    await fs.mkdir(addons, { recursive: true });
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
});

describe('mod inventory filesystem work', () => {
    it('stats only primary VPK candidates and still excludes directories with a mod filename', async () => {
        for (const name of ['skin_dir.vpk', 'skin_000.vpk', 'skin_001.vpk', 'notes.txt', 'UPPER_DIR.VPK']) {
            await fs.writeFile(join(addons, name), name);
        }
        await fs.mkdir(join(addons, 'folder_dir.vpk'));
        await fs.mkdir(join(addons, '.disabled'));
        const stat = vi.spyOn(fs, 'stat');

        const mods = await scanMods(root);

        expect(mods.map(mod => mod.fileName).sort()).toEqual(['UPPER_DIR.VPK', 'skin_dir.vpk']);
        expect(stat.mock.calls.map(([path]) => basename(String(path))).sort()).toEqual([
            'UPPER_DIR.VPK', 'folder_dir.vpk', 'skin_dir.vpk',
        ]);
        expect(mods.find(mod => mod.fileName === 'skin_dir.vpk')?.size).toBe('skin_dir.vpk'.length);
    });

    it('bounds concurrent stats while retaining directory order for equal-priority mods', async () => {
        for (let index = 0; index < 25; index++) {
            await fs.writeFile(join(addons, `skin${String(index).padStart(2, '0')}_dir.vpk`), 'vpk');
        }
        const entries = await fs.readdir(addons);
        const stats = await fs.stat(join(addons, entries[0]));
        const finished: string[] = [];
        const pending: Array<() => void> = [];
        let active = 0;
        let peak = 0;
        let scheduled = false;
        vi.spyOn(fs, 'stat').mockImplementation(path => new Promise(resolve => {
            active++;
            peak = Math.max(peak, active);
            pending.push(() => {
                active--;
                finished.push(basename(String(path)));
                resolve(stats);
            });
            if (!scheduled) {
                scheduled = true;
                setImmediate(() => {
                    scheduled = false;
                    for (const release of pending.splice(0).reverse()) release();
                });
            }
        }));

        const mods = await scanMods(root);

        expect(peak).toBeGreaterThan(1);
        expect(peak).toBeLessThanOrEqual(8);
        expect(active).toBe(0);
        expect(finished).not.toEqual(entries);
        expect(mods.map(mod => mod.fileName)).toEqual(entries);
    });

    it('skips inaccessible candidates normally and rejects them in diagnostic inventories', async () => {
        await fs.writeFile(join(addons, 'blocked_dir.vpk'), 'vpk');
        await fs.writeFile(join(addons, 'readable_dir.vpk'), 'readable');
        const realStat = fs.stat;
        const failure = Object.assign(new Error('File locked by antivirus'), { code: 'EACCES' });
        vi.spyOn(fs, 'stat').mockImplementation((...args) => {
            if (basename(String(args[0])) === 'blocked_dir.vpk') return Promise.reject(failure);
            return realStat(...args);
        });

        expect((await scanMods(root)).map(mod => mod.fileName)).toEqual(['readable_dir.vpk']);
        await expect(scanModsReadOnly(root)).rejects.toBe(failure);
    });

    it('retains diagnostic errors for inaccessible non-mod entries', async () => {
        await fs.writeFile(join(addons, 'skin_000.vpk'), 'chunk');
        const failure = new Error('Unreadable chunk');
        const stat = vi.spyOn(fs, 'stat').mockRejectedValue(failure);

        expect(await scanMods(root)).toEqual([]);
        expect(stat).not.toHaveBeenCalled();
        await expect(scanModsReadOnly(root)).rejects.toBe(failure);
    });

    it('retains verbose trace messages for skipped VPKs and stale merge artifacts', async () => {
        h.trace = true;
        await fs.writeFile(join(addons, 'skin_000.vpk'), 'chunk');
        await fs.writeFile(join(addons, '.merge-rebuild-stale.vpk'), 'stale');
        await fs.mkdir(join(addons, 'directory.vpk'));
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});

        expect(await scanMods(root)).toEqual([]);

        expect(log).toHaveBeenCalledWith(expect.stringContaining('SKIPPED "skin_000.vpk"'));
        expect(log).toHaveBeenCalledWith(expect.stringContaining('STALE merge-rebuild artifact ".merge-rebuild-stale.vpk"'));
        expect(log.mock.calls.flat().some(message => String(message).includes('directory.vpk'))).toBe(false);
    });
});
