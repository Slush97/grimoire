import { describe, expect, it } from 'vitest';
import { classifyGlobalModType } from './vpk';

describe('classifyGlobalModType hero images', () => {
    it('keeps a single-hero card pack on the hero axis despite mixed codename and display-name files', () => {
        const paths = [
            'panorama/images/heroes/hornet_card_psd.vtex_c',
            'panorama/images/heroes/hornet_sm_psd.vtex_c',
            'panorama/images/heroes/backgrounds/vindicta_bg_psd.vtex_c',
            'panorama/images/heroes/hero_names/vindicta.vsvg_c',
        ];
        expect(classifyGlobalModType(paths)).toBeNull();
    });

    it('still files a multi-hero pack as icons', () => {
        const paths = [
            'panorama/images/heroes/hornet_card_psd.vtex_c',
            'panorama/images/heroes/drifter_card_psd.vtex_c',
            'panorama/images/heroes/backgrounds/vindicta_bg_psd.vtex_c',
        ];
        expect(classifyGlobalModType(paths)).toBe('icons');
    });
});
