import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeroInfo, TextureEntry } from '../../../src/types/foundry';

const mocks = vi.hoisted(() => ({ run: vi.fn<(args: string[]) => Promise<string>>() }));
vi.mock('electron', () => ({ app: {}, protocol: {}, net: {} }));
vi.mock('./deadlock', () => ({ getCitadelPath: (path: string) => path }));
vi.mock('./modMerger', () => ({
    runVpkmerge: vi.fn(), runVpkmergeStdout: mocks.run, verifyVpkOutput: vi.fn(),
}));

import { getTextures } from './foundryCatalog';

const roster: HeroInfo[] = [
    { codename: 'atlas', name: 'Abrams', selectable: true, inDevelopment: false, disabled: false },
];
const textures: TextureEntry[] = [
    { path: 'panorama/images/heroes/kali_card_psd.vtex_c', category: 'hero-image', hero: 'kali', label: 'card' },
    { path: 'panorama/images/heroes/backgrounds/abrams_bg_psd.vtex_c', category: 'hero-image', hero: 'abrams', label: 'bg' },
    { path: 'panorama/images/heroes/bull_card_psd.vtex_c', category: 'hero-image', hero: 'bull', label: 'card' },
];

beforeEach(() => {
    mocks.run.mockReset();
    mocks.run.mockImplementation(async (args) => {
        if (args[1] === 'heroes') return JSON.stringify(roster);
        let rows = textures;
        const heroAt = args.indexOf('--hero');
        if (heroAt >= 0) rows = rows.filter((row) => row.hero === args[heroAt + 1]);
        const limitAt = args.indexOf('--limit');
        if (limitAt >= 0) rows = rows.slice(0, Number(args[limitAt + 1]));
        return JSON.stringify(rows);
    });
});

describe('Foundry catalog texture filters', () => {
    it('returns both Abrams filename families for the roster hero', async () => {
        const rows = await getTextures('game', { category: 'hero-image', hero: 'atlas' });
        expect(rows.map((row) => row.path)).toEqual([textures[1].path, textures[2].path]);
        expect(rows.every((row) => row.hero === 'atlas')).toBe(true);
    });

    it('applies the limit after finding the hero and passes category/search to the CLI', async () => {
        const rows = await getTextures('game', { category: 'hero-image', hero: 'atlas', search: 'card', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0].hero).toBe('atlas');
        expect(mocks.run.mock.calls.find(([args]) => args[1] === 'texture')?.[0]).toEqual([
            'catalog', 'texture', '--vpk', expect.any(String), '--category', 'hero-image', '--search', 'card', '--json',
        ]);
    });

    it('keeps the raw catalog available if the roster fails', async () => {
        mocks.run.mockImplementation(async (args) => {
            if (args[1] === 'heroes') throw new Error('roster unavailable');
            return JSON.stringify(textures);
        });
        expect(await getTextures('game')).toEqual(textures);
    });
});
