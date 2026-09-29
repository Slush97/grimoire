import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ userData: '', assertVpkSafety: vi.fn() }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({
    isDeadlockRunning: async () => false,
    readStash: async () => null,
}));
vi.mock('./modSafety', () => ({ assertVpkSafety: h.assertVpkSafety, moveSafetySnapshot: vi.fn() }));

import { scanMods, setModsEnabledBatch } from './mods';
import { saveMetadata } from './metadata';

function writeVpk(path: string): void {
    const header = Buffer.alloc(64);
    header.writeUInt32LE(0x55aa1234, 0);
    header.writeUInt32LE(2, 4);
    writeFileSync(path, header);
}

/** One enabled skin and two disabled candidates, the second of them blocked. */
async function shuffleLibrary() {
    const root = mkdtempSync(join(tmpdir(), 'batch-safety-'));
    const addons = join(root, 'game', 'citadel', 'addons');
    mkdirSync(join(addons, '.disabled'), { recursive: true });
    mkdirSync(join(root, 'game', 'citadel', 'grimoire'), { recursive: true });
    const currentPath = join(addons, 'pak01_dir.vpk');
    const passingPath = join(addons, '.disabled', 'Passing_dir.vpk');
    const blockedPath = join(addons, '.disabled', 'Blocked_dir.vpk');
    for (const path of [currentPath, passingPath, blockedPath]) writeVpk(path);
    const mods = await scanMods(root);
    const byPath = (path: string) => mods.find((mod) => mod.path === path)!;
    return { root, addons, current: byPath(currentPath), passing: byPath(passingPath), blocked: byPath(blockedPath) };
}

describe('setModsEnabledBatch safety gate', () => {
    beforeEach(() => {
        h.userData = mkdtempSync(join(tmpdir(), 'batch-safety-userdata-'));
        saveMetadata({});
        h.assertVpkSafety.mockReset();
    });

    it('counts a refused mod as a failure and still applies the rest of the batch', async () => {
        const { root, current, passing, blocked } = await shuffleLibrary();
        h.assertVpkSafety.mockImplementation(async (path: string) => {
            if (path === blocked.path) throw new Error('MOD_SAFETY_BLOCKED: The archive could not be read or installed safely.');
        });

        const result = await setModsEnabledBatch(root, { enable: [passing.id, blocked.id], disable: [current.id] });

        expect(result.enabled).toBe(1);
        expect(result.disabled).toBe(1);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]).toContain(`enable ${blocked.id}`);
        expect(result.failures[0]).toContain('MOD_SAFETY_BLOCKED');
        const after = await scanMods(root);
        expect(after.filter((mod) => mod.enabled).map((mod) => mod.fileName)).toHaveLength(1);
        expect(existsSync(blocked.path)).toBe(true);
        expect(existsSync(passing.path)).toBe(false);
    });

    it('asks about a refused mod once, before any file moves', async () => {
        const { root, current, blocked } = await shuffleLibrary();
        h.assertVpkSafety.mockImplementation(async (path: string) => {
            expect(existsSync(current.path)).toBe(true);
            if (path === blocked.path) throw new Error('MOD_SAFETY_TRUST_REQUIRED: This version must be trusted before activation.');
        });

        const result = await setModsEnabledBatch(root, { enable: [blocked.id], disable: [current.id] });

        expect(h.assertVpkSafety.mock.calls.filter(([path]) => path === blocked.path)).toHaveLength(1);
        expect(result).toMatchObject({ enabled: 0, disabled: 1 });
    });
});
