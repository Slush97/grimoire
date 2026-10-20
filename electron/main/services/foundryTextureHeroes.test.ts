import { describe, expect, it } from 'vitest';
import type { HeroInfo, TextureEntry } from '../../../src/types/foundry';
import { normalizeTextureHeroes } from './foundryTextureHeroes';

const heroes: HeroInfo[] = [
    { codename: 'atlas', name: 'Abrams', selectable: true, inDevelopment: false, disabled: false },
    { codename: 'viper', name: 'Vyper', selectable: true, inDevelopment: false, disabled: false },
    { codename: 'forge', name: 'McGinnis', selectable: true, inDevelopment: false, disabled: false },
    { codename: 'nano', name: 'Calico', selectable: true, inDevelopment: false, disabled: false },
];

const entries: TextureEntry[] = [
    { path: 'panorama/images/heroes/kali_card_psd.vtex_c', category: 'hero-image', hero: 'kali', label: 'card' },
    { path: 'panorama/images/heroes/backgrounds/abrams_bg_psd.vtex_c', category: 'hero-image', hero: 'abrams', label: 'bg' },
    { path: 'panorama/images/heroes/bull_card_psd.vtex_c', category: 'hero-image', hero: 'bull', label: 'card' },
    { path: 'models/heroes_staging/atlas_detective_v2/coat.vtex_c', category: 'hero-model', hero: 'atlas_detective_v2', label: 'coat' },
    { path: 'panorama/images/heroes/engineer_card_psd.vtex_c', category: 'hero-image', hero: 'engineer', label: 'card' },
    { path: 'panorama/images/heroes/calico_card_psd.vtex_c', category: 'hero-image', hero: 'calico', label: 'card' },
    { path: 'panorama/images/items/mods_test.vtex_c', category: 'item-icon', hero: null, label: 'test' },
    { path: 'panorama/images/heroes/unknown_card_psd.vtex_c', category: 'hero-image', hero: 'unknown', label: 'card' },
];

describe('Foundry texture hero grouping', () => {
    it('joins backgrounds, portraits, model variants and legacy hero names', () => {
        const rows = normalizeTextureHeroes(entries, heroes);
        expect(rows.map((entry) => entry.hero)).toEqual([
            'viper', 'atlas', 'atlas', 'atlas', 'forge', 'nano', null, 'unknown',
        ]);
        expect(rows.map((entry) => entry.path)).toEqual(entries.map((entry) => entry.path));
        expect(entries[2].hero).toBe('bull');
    });

    it.each(['atlas', 'abrams', 'bull'])('filters Abrams through %s before limiting', (hero) => {
        const rows = normalizeTextureHeroes(entries, heroes, { hero, limit: 2 });
        expect(rows.map((entry) => entry.path)).toEqual([entries[1].path, entries[2].path]);
    });

    it('keeps unknown assets browseable when the roster cannot be read', () => {
        expect(normalizeTextureHeroes(entries, [])).toEqual(entries);
        expect(normalizeTextureHeroes(entries, [], { hero: 'bull' })).toEqual([entries[2]]);
    });

    it('keeps zero as an uncapped limit, matching the catalog CLI', () => {
        expect(normalizeTextureHeroes(entries, heroes, { limit: 0 })).toHaveLength(entries.length);
    });

    it('assigns flat ability icons while keeping shared icons unassigned', () => {
        const icons: TextureEntry[] = ['bull_charge', 'inferno_dash', 'weapon_damage'].map((name) => ({
            path: `panorama/images/hud/abilities/${name}_psd.vtex_c`,
            category: 'ability-icon', hero: null, label: name,
        }));
        expect(normalizeTextureHeroes(icons, heroes).map((entry) => entry.hero)).toEqual(['atlas', null, null]);
        expect(normalizeTextureHeroes(icons, heroes, { hero: 'atlas' })).toHaveLength(1);
    });

    it('assigns old-name assets to the active hero when a disabled roster entry uses that name', () => {
        const kali = { ...heroes[1], codename: 'kali', name: 'Kali', selectable: false, disabled: true };
        expect(normalizeTextureHeroes([entries[0]], [...heroes, kali])[0].hero).toBe('viper');
    });

    it('keeps Kali ability icons and model textures off Vyper', () => {
        const kali = { ...heroes[1], codename: 'kali', name: 'Kali', selectable: false, disabled: true };
        const rows: TextureEntry[] = [
            entries[0],
            { path: 'panorama/images/hud/abilities/kali/kali_speed_burst_psd.vtex_c', category: 'ability-icon', hero: 'kali', label: 'speed burst' },
            { path: 'models/heroes_staging/kali/materials/kali_weapon_color_psd_5e679833.vtex_c', category: 'hero-model', hero: 'kali', label: 'weapon color' },
        ];
        expect(normalizeTextureHeroes(rows, [...heroes, kali]).map((entry) => entry.hero)).toEqual(['viper', 'kali', 'kali']);
        expect(normalizeTextureHeroes(rows, heroes).map((entry) => entry.hero)).toEqual(['viper', 'kali', 'kali']);
        expect(normalizeTextureHeroes(rows, heroes, { hero: 'viper' }).map((entry) => entry.path)).toEqual([entries[0].path]);
    });

    it('does not match a hero name that is only a substring', () => {
        const row = { ...entries[2], hero: 'bullfrog' };
        expect(normalizeTextureHeroes([row], heroes)[0].hero).toBe('bullfrog');
    });

    it('matches the longest roster name before stripping model suffixes', () => {
        const other = { ...heroes[0], codename: 'atlas_detective', name: 'Unknown hero' };
        const rows = normalizeTextureHeroes([entries[3]], [...heroes, other]);
        expect(rows[0].hero).toBe('atlas_detective');
    });
});
