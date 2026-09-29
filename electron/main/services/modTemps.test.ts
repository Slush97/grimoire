import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const h = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => h.userData } }));
vi.mock('./launch', () => ({ isDeadlockRunning: async () => false, readStash: async () => null }));

import { scanMods } from './mods';
import { modTempPath } from './modTemps';

const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('stale staging temp sweep', () => {
    it('removes temps an earlier run left in any mod folder, however recent, and nothing else', async () => {
        const root = mkdtempSync(join(tmpdir(), 'mod-temps-'));
        h.userData = join(root, 'userdata');
        const addons = join(root, 'game', 'citadel', 'addons');
        const disabled = join(addons, '.disabled');
        for (const dir of [disabled, join(root, 'game', 'citadel', 'grimoire'), h.userData]) {
            mkdirSync(dir, { recursive: true });
        }
        const stale = [
            join(addons, `.safety-merge-deadbeef-${uuid}.tmp`),
            join(addons, `.merge-rebuild-0badc0de-${uuid}.tmp`),
            join(disabled, `.imprint-embed-0badc0de-${uuid}.tmp`),
            join(disabled, `.import-copy-12345678-${uuid}.tmp`),
            join(addons, `.merge-rebuild-${uuid}.vpk`),
            join(disabled, `.imprint-embed-${uuid}.vpk`),
        ];
        const kept = [
            modTempPath(addons, 'merge-rebuild'),
            modTempPath(disabled, 'import-copy'),
            join(addons, 'pak01_dir.vpk'),
            join(addons, 'pak01_000.vpk'),
            join(disabled, 'HUD Mod_dir.vpk'),
            join(disabled, `local_${uuid}_dir.vpk`),
        ];
        for (const path of [...stale, ...kept]) writeFileSync(path, 'x');

        await scanMods(root);

        expect(stale.filter((path) => existsSync(path))).toEqual([]);
        expect(kept.filter((path) => existsSync(path))).toEqual(kept);
    });
});
