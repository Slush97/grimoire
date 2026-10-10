import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({
    app: {
        getPath: () => state.userData,
        getAppPath: () => process.cwd(),
        getVersion: () => 'test',
        isPackaged: false,
    },
    BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => false, readStash: async () => null }));
// Synthetic VPKs exercise the filesystem ordering, not the safety scanner.
vi.mock('./modSafety', async (importOriginal) => ({
    ...await importOriginal(),
    assertVpkSafety: async () => {},
}));

import { getModMetadata, setModMetadata } from './metadata';
import { reorderMods, scanMods } from './mods';
import { applyProfile, createProfile, createProfileFromGameBananaIds, updateProfile } from './profiles';
import { buildPortableProfileFromInstalled } from './portableProfile';

let root: string;
let deadlockPath: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'grimoire-profile-order-'));
    state.userData = join(root, 'userdata');
    mkdirSync(state.userData);
    deadlockPath = join(root, 'deadlock');
    mkdirSync(join(deadlockPath, 'game', 'citadel'), { recursive: true });
    writeFileSync(join(deadlockPath, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo { FileSystem { SearchPaths { Game citadel } } }');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function installMods(count: number) {
    for (let index = 1; index <= count; index++) {
        const folderIndex = Math.floor((index - 1) / 99);
        const folder = folderIndex ? `addons${folderIndex}` : 'addons';
        const slot = (index - 1) % 99 + 1;
        const fileName = `pak${String(slot).padStart(2, '0')}_mod${index}_dir.vpk`;
        const path = join(deadlockPath, 'game', 'citadel', folder);
        mkdirSync(path, { recursive: true });
        const bytes = Buffer.alloc(4096);
        bytes.writeUInt32LE(0x55aa1234, 0);
        bytes.writeUInt32LE(2, 4);
        bytes.writeUInt32LE(index, 32);
        writeFileSync(join(path, fileName), bytes);
        setModMetadata(folderIndex ? `${folder}/${fileName}` : fileName, {
            modName: `Mod ${index}`,
            gameBananaId: index,
            gameBananaFileId: 1000 + index,
            vpkIndex: 0,
        });
    }
}

async function installedOrder() {
    return (await scanMods(deadlockPath))
        .filter((mod) => mod.enabled)
        .map((mod) => getModMetadata(mod.metaKey)?.gameBananaId);
}

async function reverseOrder() {
    const mods = await scanMods(deadlockPath);
    await reorderMods(deadlockPath, mods.filter((mod) => mod.enabled).map((mod) => mod.id).reverse());
}

describe('saved profile load order across addon folders', () => {
    it.each([4, 100, 199])('restores %i mods after their slots change', async (count) => {
        installMods(count);
        const before = await installedOrder();
        const profile = await createProfile(deadlockPath, 'Saved order');
        await reverseOrder();
        const result = await applyProfile(deadlockPath, profile.id);
        expect(result.failures).toEqual([]);
        expect(await installedOrder()).toEqual(before);
    }, 30_000);

    it('captures the new order when an overflow profile is updated', async () => {
        installMods(100);
        const profile = await createProfile(deadlockPath, 'Updated order');
        await reverseOrder();
        const before = await installedOrder();
        await updateProfile(deadlockPath, profile.id);
        await reverseOrder();
        expect((await applyProfile(deadlockPath, profile.id)).failures).toEqual([]);
        expect(await installedOrder()).toEqual(before);
    });

    it('keeps a collection subset ordered across addon folders', async () => {
        installMods(101);
        const profile = await createProfileFromGameBananaIds(deadlockPath, 'Collection', [2, 98, 100, 101]);
        expect((await applyProfile(deadlockPath, profile.id)).failures).toEqual([]);
        expect(await installedOrder()).toEqual([2, 98, 100, 101]);
    });

    it('exports an installed snapshot with priorities in complete load order', async () => {
        installMods(100);
        const before = await installedOrder();
        const { profile: portable } = await buildPortableProfileFromInstalled(deadlockPath, 'Snapshot');
        expect([...portable.mods].sort((a, b) => a.priority - b.priority)
            .map((mod) => mod.ref.submissionId)).toEqual(before);
    });
});
