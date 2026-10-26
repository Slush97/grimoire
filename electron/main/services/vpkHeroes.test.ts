import { describe, expect, it } from 'vitest';
import { inferHeroesFromVpkPaths } from './vpk';
import { canonicalSupportedHeroName, supportedHeroNames } from './heroCodenames';

describe('plural installed VPK hero matching', () => {
    it('collects multiple supported heroes from voice and ability folders', () => {
        expect(inferHeroesFromVpkPaths([
            'sounds/vo/atlas/a.vsnd_c',
            'sounds/vo/chessmaster/b.vsnd_c',
            'sounds/abilities/mokrill/a1/d.vsnd_c',
            'sounds/abilities/abrams/a2/c.vsnd_c',
        ])).toEqual(['Abrams', 'Mo & Krill', 'Solomon']);
    });

    it.each([
        'models/heroes_wip/artist/body.vmdl_c',
        'models/heroes_staging/artist/body.vmdl_c',
        'models/heroes/hero_artist.vdata_c',
        'materials/models/heroes_wip/artist/body.vmat_c',
        'materials/heroes_wip/artist/body.vmat_c',
        'particles/heroes_wip/artist/effect.vpcf_c',
        'particles/abilities/artist/effect.vpcf_c',
        'particles/weapon_fx/artist/shot.vpcf_c',
        'scripts/heroes/hero_artist.vdata_c',
        'sounds/heroes_wip/artist/line.vsnd_c',
        'soundevents/citadel/hero_artist.vsndevts_c',
        'soundevents/hero/artist.vsndevts_c',
        'panorama/images/heroes/artist_card_psd.vtex_c',
    ])('recognizes a supported hero in %s', (path) => {
        expect(inferHeroesFromVpkPaths([path])).toEqual(['Violet']);
    });

    it('normalizes path casing, separators, and legacy namespaces', () => {
        expect(inferHeroesFromVpkPaths([
            'SOUNDS\\ABILITIES\\GEIST\\A4\\ULT.VSND_C',
            'sounds/abilities/archer/a1/sound.vsnd_c',
            'sounds/abilities/pocket/a1/sound.vsnd_c',
            'models/heroes_wip/bull/body.vmdl_c',
            'panorama/images/heroes/backgrounds/vindicta_bg_psd.vtex_c',
            'panorama/images/heroes/hero_names/grey_talon.vsvg_c',
        ])).toEqual(['Abrams', 'Grey Talon', 'Lady Geist', 'Pocket', 'Vindicta']);
    });

    it('ignores NPCs, unreleased heroes, incidental names, and partial codenames', () => {
        expect(inferHeroesFromVpkPaths([
            'sounds/vo/shopkeeper/haze.vsnd_c',
            'sounds/vo/newscaster/line.vsnd_c',
            'sounds/vo/neutral_gremlin/line.vsnd_c',
            'sounds/vo/spirit_jar/line.vsnd_c',
            'sounds/vo/seasonal/line.vsnd_c',
            'sounds/vo/trapper/line.vsnd_c',
            'sounds/vo/kali/line.vsnd_c',
            'sounds/abilities/fathom/a1/sound.vsnd_c',
            'models/heroes_wip/wrecker/body.vmdl_c',
            'materials/custom/haze/body.vmat_c',
            'sounds/vo/hazelnut/line.vsnd_c',
        ])).toEqual([]);
    });

    it('limits the reused Kali alias to Vyper portrait art', () => {
        expect(inferHeroesFromVpkPaths([
            'models/heroes_wip/kali/body.vmdl_c',
            'materials/models/heroes_wip/kali/body.vmat_c',
            'particles/abilities/kali/effect.vpcf_c',
            'scripts/heroes/hero_kali.vdata_c',
        ])).toEqual([]);
        expect(inferHeroesFromVpkPaths(['panorama/images/heroes/kali_card_psd.vtex_c'])).toEqual(['Vyper']);
        expect(inferHeroesFromVpkPaths(['models/heroes_wip/viper/body.vmdl_c'])).toEqual(['Vyper']);
    });

    it('uses the supported roster while keeping explicit display-name aliases', () => {
        expect(supportedHeroNames).toHaveLength(44);
        expect(canonicalSupportedHeroName('The Doorman')).toBe('Doorman');
        expect(canonicalSupportedHeroName('Mo and Krill')).toBe('Mo & Krill');
        expect(canonicalSupportedHeroName('shopkeeper')).toBeUndefined();
    });
});
