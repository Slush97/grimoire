import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => false, readStash: async () => null }));
import { scanModsReadOnly } from './mods';

let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe('diagnostic inventory', () => {
    it('preserves collisions, staged files, reserved files and metadata byte for byte', async () => {
        root = await mkdtemp(join(tmpdir(), 'diagnostic-inventory-'));
        h.userData = join(root, 'userdata');
        const files = ['game/citadel/addons/pak01_dir.vpk', 'game/citadel/addons/.disabled/pak01_dir.vpk',
            'game/citadel/grimoire/pak01_dir.vpk', 'game/citadel/grimoire/pak05_dir.vpk',
            'game/citadel/addons1/pak01_dir.vpk',
            'game/citadel/addons/.merge-rebuild-0f8fad5b-d9cb-469f-a165-70867728950e.vpk',
            'userdata/mod-metadata.json'];
        for (const [index, file] of files.entries()) {
            await mkdir(dirname(join(root, file)), { recursive: true });
            await writeFile(join(root, file), file.endsWith('.json') ? '{}' : String(index));
        }
        const before = await Promise.all(files.map(file => readFile(join(root, file))));
        const inventory = await scanModsReadOnly(root);
        expect(inventory).toHaveLength(5);
        expect(inventory.filter(mod => mod.fileName === 'pak01_dir.vpk')).toHaveLength(4);
        expect(inventory.some(mod => !mod.enabled)).toBe(true);
        expect(await Promise.all(files.map(file => readFile(join(root, file))))).toEqual(before);
        expect((await readdir(join(root, 'game/citadel'))).sort()).toEqual(['addons', 'addons1', 'grimoire']);
    });

    it('does not create missing mod folders', async () => {
        root = await mkdtemp(join(tmpdir(), 'diagnostic-inventory-'));
        await mkdir(join(root, 'game/citadel'), { recursive: true });
        expect(await scanModsReadOnly(root)).toEqual([]);
        expect(await readdir(join(root, 'game/citadel'))).toEqual([]);
    });
});
