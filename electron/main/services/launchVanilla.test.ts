import { beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const harness = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({
    app: { getPath: () => harness.userData },
    shell: { openExternal: vi.fn() },
}));

import { restoreFromStash, stashEnabledMods } from './launch';

describe('Vanilla user-mod stash', () => {
    beforeEach(() => {
        harness.userData = mkdtempSync(join(tmpdir(), 'vanilla-userdata-'));
    });

    it('stashes and restores Global user VPKs while preserving reserved Locker artifacts', async () => {
        const root = mkdtempSync(join(tmpdir(), 'vanilla-game-'));
        const citadel = join(root, 'game', 'citadel');
        const grimoire = join(citadel, 'grimoire');
        const addons = join(citadel, 'addons');
        const disabled = join(addons, '.disabled');
        mkdirSync(grimoire, { recursive: true });
        mkdirSync(disabled, { recursive: true });

        const managedDir = join(grimoire, 'pak01_dir.vpk');
        const managedChunk = join(grimoire, 'pak01_000.vpk');
        const globalDir = join(grimoire, 'pak05_dir.vpk');
        const globalChunk = join(grimoire, 'pak05_000.vpk');
        const addonDir = join(addons, 'pak02_dir.vpk');
        for (const path of [managedDir, managedChunk, globalDir, globalChunk, addonDir]) {
            writeFileSync(path, path);
        }

        const stash = await stashEnabledMods(root);

        expect(stash.status).toBe('active');
        expect(stash.mods.map(({ fileName, folder }) => `${folder}/${fileName}`).sort()).toEqual([
            'addons/pak02_dir.vpk',
            'grimoire/pak05_000.vpk',
            'grimoire/pak05_dir.vpk',
        ]);
        expect(existsSync(managedDir)).toBe(true);
        expect(existsSync(managedChunk)).toBe(true);
        expect(existsSync(globalDir)).toBe(false);
        expect(existsSync(globalChunk)).toBe(false);
        expect(existsSync(addonDir)).toBe(false);
        expect(existsSync(join(disabled, 'grimoire', 'pak05_dir.vpk'))).toBe(true);
        expect(existsSync(join(disabled, 'grimoire', 'pak05_000.vpk'))).toBe(true);
        expect(existsSync(join(disabled, 'pak02_dir.vpk'))).toBe(true);

        const restored = await restoreFromStash(root, stash);

        expect(restored).toEqual({ restored: 3, skipped: 0, failed: [] });
        expect(existsSync(globalDir)).toBe(true);
        expect(existsSync(globalChunk)).toBe(true);
        expect(existsSync(addonDir)).toBe(true);
        expect(existsSync(join(harness.userData, 'vanilla-stash.json'))).toBe(false);
    });
});
