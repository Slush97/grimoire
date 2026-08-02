import { describe, it, expect } from 'vitest';
import { classifyHeroIconOnly, classifyGlobalModType } from './vpk';

/**
 * The path sets below are REAL, taken by parsing the published VPKs. They are
 * the ground truth this classifier exists to recognize, so keep them verbatim
 * rather than idealizing them (the stray README.txt and image_compiler sidecar
 * are exactly what made a naive "only hero art" check fail).
 */

// GameBanana 680646, "Ralsei Rem Toasted Compatibility Icons".
const RALSEI_REM_ADDON = [
    'README.txt',
    'panorama/image_compiler.vdata_c',
    'panorama/images/heroes/familiar_card_critical_psd.vtex_c',
    'panorama/images/heroes/familiar_card_gloat_psd.vtex_c',
    'panorama/images/heroes/familiar_card_psd.vtex_c',
    'panorama/images/heroes/familiar_mm_psd.vtex_c',
    'panorama/images/heroes/familiar_sm_psd.vtex_c',
    'panorama/images/heroes/familiar_vertical_psd.vtex_c',
];

// GameBanana 646257, "Lashlyn Toasted Icon Addon".
const LASHLYN_ADDON = [
    'README.txt',
    'panorama/images/heroes/lash_card_psd.vtex_c',
    'panorama/images/heroes/lash_mm_psd.vtex_c',
    'panorama/images/heroes/lash_sm_psd.vtex_c',
    'panorama/images/heroes/lash_vertical_psd.vtex_c',
];

// GameBanana 687688, "Wraith Full Auto and Telekinesis Icons Revamp": ABILITY
// icons, a different path family the card pipeline does not handle.
const WRAITH_ABILITY_ICONS = [
    'panorama/images/hud/abilities/wraith_aura_psd.vtex_c',
    'panorama/images/hud/abilities/wraith_lift_psd.vtex_c',
];

describe('classifyHeroIconOnly', () => {
    it('recognizes a real per-skin icon addon', () => {
        expect(classifyHeroIconOnly(RALSEI_REM_ADDON)).toBe('familiar');
        expect(classifyHeroIconOnly(LASHLYN_ADDON)).toBe('lash');
    });

    it('tolerates Grimoire imprint sidecars added to an addon', () => {
        expect(classifyHeroIconOnly([...LASHLYN_ADDON, 'addoninfo.txt', 'modinfo.json'])).toBe(
            'lash'
        );
    });

    it('accepts art nested under a subfolder (heroes/backgrounds/...)', () => {
        expect(
            classifyHeroIconOnly([
                'panorama/images/heroes/drifter_card_psd.vtex_c',
                'panorama/images/heroes/backgrounds/drifter_bg_psd.vtex_c',
            ])
        ).toBe('drifter');
    });

    it('rejects a multi-hero icon PACK (that is a global mod, not a companion)', () => {
        expect(
            classifyHeroIconOnly([
                'panorama/images/heroes/lash_card_psd.vtex_c',
                'panorama/images/heroes/familiar_card_psd.vtex_c',
            ])
        ).toBeNull();
        // ...and the existing global classifier still claims it.
        expect(
            classifyGlobalModType([
                'panorama/images/heroes/lash_card_psd.vtex_c',
                'panorama/images/heroes/familiar_card_psd.vtex_c',
            ])
        ).toBe('icons');
    });

    it('rejects a skin bundle that merely ships its hero card too', () => {
        expect(
            classifyHeroIconOnly([
                'models/heroes_staging/hornet_v3/hornet.vmdl_c',
                'materials/models/heroes/hornet/body.vmat_c',
                'panorama/images/heroes/hornet_card_psd.vtex_c',
            ])
        ).toBeNull();
    });

    it('rejects a HUD mod bundled with one hero card', () => {
        expect(
            classifyHeroIconOnly([
                'panorama/images/heroes/lash_card_psd.vtex_c',
                'panorama/layout/hud/hud_deathpanel.vxml_c',
            ])
        ).toBeNull();
    });

    it('rejects an ability-icon mod: different path family, not a hero card', () => {
        expect(classifyHeroIconOnly(WRAITH_ABILITY_ICONS)).toBeNull();
        // Documents the current filing: hero-specific ability icons land in the
        // global HUD bucket. Follow-up work, not something links can fix.
        expect(classifyGlobalModType(WRAITH_ABILITY_ICONS)).toBe('hud');
    });

    it('rejects an empty tree', () => {
        expect(classifyHeroIconOnly([])).toBeNull();
    });

    it('matches case-insensitively (VPK paths are lowercase only by convention)', () => {
        expect(classifyHeroIconOnly(['Panorama/Images/Heroes/Lash_Card_psd.vtex_c'])).toBe('lash');
    });
});
