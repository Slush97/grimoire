import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { listInstalledUserVpks } from './modLibrary';

describe('listInstalledUserVpks', () => {
    it('covers every user-mod root and excludes reserved Locker VPKs', async () => {
        const root = mkdtempSync(join(tmpdir(), 'mod-library-'));
        const citadel = join(root, 'game', 'citadel');
        const grimoire = join(citadel, 'grimoire');
        const addons = join(citadel, 'addons');
        const overflow = join(citadel, 'addons1');
        const disabled = join(addons, '.disabled');
        for (const dir of [grimoire, addons, overflow, disabled]) {
            mkdirSync(dir, { recursive: true });
        }

        writeFileSync(join(grimoire, 'pak01_dir.vpk'), 'managed');
        writeFileSync(join(grimoire, 'pak05_dir.vpk'), 'global');
        writeFileSync(join(addons, 'pak02_dir.vpk'), 'base');
        writeFileSync(join(overflow, 'pak03_dir.vpk'), 'overflow');
        writeFileSync(join(disabled, 'parked_dir.vpk'), 'disabled');
        writeFileSync(join(grimoire, 'notes.txt'), 'not a vpk');

        const vpks = await listInstalledUserVpks(root);
        expect(vpks.map(({ metaKey, enabled }) => ({ metaKey, enabled }))).toEqual([
            { metaKey: 'grimoire/pak05_dir.vpk', enabled: true },
            { metaKey: 'pak02_dir.vpk', enabled: true },
            { metaKey: 'addons1/pak03_dir.vpk', enabled: true },
            { metaKey: 'parked_dir.vpk', enabled: false },
        ]);
    });
});
