import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const harness = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => harness.userData } }));
vi.mock('./launch', () => ({
    isDeadlockRunning: async () => false,
    readStash: async () => null,
}));

import {
    PRIORITY_LIMIT_MESSAGE,
    scanMods,
    setModPriorityFolder,
} from './mods';
import { getModMetadata, saveMetadata } from './metadata';

function writeVpk(path: string): void {
    const header = Buffer.alloc(64);
    header.writeUInt32LE(0x55aa1234, 0);
    header.writeUInt32LE(2, 4);
    writeFileSync(path, header);
}

function createGame(): { root: string; addons: string; grimoire: string } {
    const root = mkdtempSync(join(tmpdir(), 'priority-failure-'));
    const addons = join(root, 'game', 'citadel', 'addons');
    const grimoire = join(root, 'game', 'citadel', 'grimoire');
    mkdirSync(join(addons, '.disabled'), { recursive: true });
    mkdirSync(grimoire, { recursive: true });
    return { root, addons, grimoire };
}

describe('setModPriorityFolder failure atomicity', () => {
    beforeEach(() => {
        harness.userData = mkdtempSync(join(tmpdir(), 'priority-failure-userdata-'));
        saveMetadata({});
        vi.restoreAllMocks();
    });

    it('does not set the flag when the Global root is full', async () => {
        const { root, addons, grimoire } = createGame();
        const source = join(addons, 'pak01_dir.vpk');
        writeVpk(source);
        for (let slot = 5; slot <= 99; slot++) {
            writeVpk(join(grimoire, `pak${String(slot).padStart(2, '0')}_dir.vpk`));
        }
        const target = (await scanMods(root)).find((mod) => mod.path === source)!;

        await expect(setModPriorityFolder(root, target.id, true)).rejects.toThrow(
            PRIORITY_LIMIT_MESSAGE
        );

        expect(existsSync(source)).toBe(true);
        expect(getModMetadata(target.metaKey)?.priorityMod).toBeUndefined();
    });

    it('leaves an addons mod unflagged when the move into Global fails', async () => {
        const { root, addons } = createGame();
        const source = join(addons, 'pak01_dir.vpk');
        writeVpk(source);
        const target = (await scanMods(root)).find((mod) => mod.path === source)!;
        vi.spyOn(fs, 'rename').mockRejectedValueOnce(
            Object.assign(new Error('rename failed'), { code: 'EIO' })
        );

        await expect(setModPriorityFolder(root, target.id, true)).rejects.toThrow('rename failed');

        expect(existsSync(source)).toBe(true);
        expect(getModMetadata(target.metaKey)?.priorityMod).toBeUndefined();
    });

    it('restores the flag when the move out of Global fails', async () => {
        const { root, grimoire } = createGame();
        const source = join(grimoire, 'pak05_dir.vpk');
        writeVpk(source);
        const target = (await scanMods(root)).find((mod) => mod.path === source)!;
        expect(getModMetadata(target.metaKey)?.priorityMod).toBe(true);
        vi.spyOn(fs, 'rename').mockRejectedValueOnce(
            Object.assign(new Error('rename failed'), { code: 'EIO' })
        );

        await expect(setModPriorityFolder(root, target.id, false)).rejects.toThrow('rename failed');

        expect(existsSync(source)).toBe(true);
        expect(getModMetadata(target.metaKey)?.priorityMod).toBe(true);
    });
});
