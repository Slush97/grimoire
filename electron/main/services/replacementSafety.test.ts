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

import { assertReplacementSafety, scanMods } from './mods';
import { saveMetadata, setModMetadata } from './metadata';

function writeVpk(path: string): void {
    const header = Buffer.alloc(64);
    header.writeUInt32LE(0x55aa1234, 0);
    header.writeUInt32LE(2, 4);
    writeFileSync(path, header);
}

/** V1 enabled, plus a V2 candidate left disabled by a rejected update. */
async function rejectedUpdate() {
    const root = mkdtempSync(join(tmpdir(), 'replacement-safety-'));
    const addons = join(root, 'game', 'citadel', 'addons');
    mkdirSync(join(addons, '.disabled'), { recursive: true });
    mkdirSync(join(root, 'game', 'citadel', 'grimoire'), { recursive: true });
    const oldPath = join(addons, 'pak01_dir.vpk');
    const candidatePath = join(addons, '.disabled', 'HUD Mod_dir.vpk');
    writeVpk(oldPath);
    writeVpk(candidatePath);
    const mods = await scanMods(root);
    const candidate = mods.find((mod) => mod.path === candidatePath)!;
    setModMetadata(candidate.metaKey, { modName: 'HUD Mod', gameBananaId: 7, gameBananaFileId: 2 });
    return { root, oldPath, candidatePath, candidate };
}

describe('assertReplacementSafety', () => {
    beforeEach(() => {
        h.userData = mkdtempSync(join(tmpdir(), 'replacement-safety-userdata-'));
        saveMetadata({});
        h.assertVpkSafety.mockReset();
        h.assertVpkSafety.mockResolvedValue(undefined);
    });

    it('reviews an already-installed candidate as an installation before the update may delete V1', async () => {
        const { root, candidatePath, candidate } = await rejectedUpdate();

        await assertReplacementSafety(root, [candidate.id]);

        expect(h.assertVpkSafety).toHaveBeenCalledExactlyOnceWith(candidatePath, {
            context: 'installation',
            name: 'HUD Mod',
        });
    });

    it('fails when the user keeps the candidate disabled again, leaving both versions on disk', async () => {
        const { root, oldPath, candidatePath, candidate } = await rejectedUpdate();
        h.assertVpkSafety.mockRejectedValueOnce(new Error('MOD_SAFETY_TRUST_REQUIRED'));

        await expect(assertReplacementSafety(root, [candidate.id])).rejects.toThrow('MOD_SAFETY_TRUST_REQUIRED');

        expect(existsSync(oldPath)).toBe(true);
        expect(existsSync(candidatePath)).toBe(true);
    });

    it('refuses a stale replacement id instead of skipping its review', async () => {
        const { root, candidate } = await rejectedUpdate();

        await expect(assertReplacementSafety(root, [candidate.id, 'gone'])).rejects.toThrow('Mod not found: gone');

        expect(h.assertVpkSafety).not.toHaveBeenCalled();
    });
});
