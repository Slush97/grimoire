import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    userData: '',
    paths: new Array<string>(),
    runVpkmerge: vi.fn<(args: string[]) => Promise<void>>(),
}));

vi.mock('electron', () => ({ app: { getPath: () => mocks.userData } }));
vi.mock('./deadlock', () => ({ metaKeyFor: () => 'icons/pak01_dir.vpk' }));
vi.mock('./modLibrary', () => ({
    listInstalledUserVpks: async () => [{ path: 'icons/pak01_dir.vpk' }],
}));
vi.mock('./vpk', () => ({ parseVpkDirectoryCached: () => mocks.paths }));
vi.mock('./metadata', () => ({ getModMetadata: () => undefined }));
vi.mock('./modMerger', () => ({
    vpkmergeBinaryPath: vi.fn(),
    runVpkmerge: mocks.runVpkmerge,
}));

import { codenameForHero, codenamesForHero, getHeroPortraits } from './heroPortraits';

describe('Vyper portrait paths', () => {
    beforeEach(async () => {
        mocks.userData = await fs.mkdtemp(join(tmpdir(), 'grimoire-portraits-'));
        mocks.paths = [];
        mocks.runVpkmerge.mockReset();
        mocks.runVpkmerge.mockImplementation(async (args) => {
            const out = args[args.indexOf('--out') + 1];
            const manifest = args[args.indexOf('--manifest') + 1];
            await fs.mkdir(out, { recursive: true });
            const png = join(out, 'card.png');
            await fs.writeFile(png, 'decoded card');
            await fs.writeFile(manifest, JSON.stringify({ portraits: [{
                variant: 'card', width: 280, height: 380,
                format_name: 'RGBA8888', output_path: png,
            }] }));
        });
    });

    afterEach(async () => {
        await fs.rm(mocks.userData, { recursive: true, force: true });
    });

    it('keeps the hero identity and includes the panorama name used by the game', () => {
        expect(codenameForHero('Vyper')).toBe('viper');
        expect(codenamesForHero('Vyper')).toEqual(['viper', 'kali']);
    });

    it.each(['kali', 'viper'])('finds mod cards authored under %s', async (codename) => {
        mocks.paths = [`panorama/images/heroes/${codename}_card_psd.vtex_c`];
        const portraits = await getHeroPortraits('Deadlock', 'Vyper');
        expect(portraits).toHaveLength(1);
        expect(portraits[0]).toMatchObject({ modFileName: 'icons/pak01_dir.vpk', variant: 'card' });
        expect(mocks.runVpkmerge.mock.calls[0][0]).toContain(codename);
    });

    it('does not decode another hero when no Vyper card is present', async () => {
        mocks.paths = ['panorama/images/heroes/bull_card_psd.vtex_c'];
        expect(await getHeroPortraits('Deadlock', 'Vyper')).toEqual([]);
        expect(mocks.runVpkmerge).not.toHaveBeenCalled();
    });
});
