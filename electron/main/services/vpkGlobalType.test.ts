import { describe, expect, it } from 'vitest';
import { classifyGlobalModType } from './vpk';

describe('shared movement effects', () => {
    it('files Rainbow Trails and dash/jump/slide particles under General Effects', () => {
        expect(classifyGlobalModType([
            'materials/particle/rainbow2.vtex_c',
            'particles/generic/air_dash.vpcf_c',
            'particles/generic/air_jump_ring.vpcf_c',
            'particles/generic/slide_trail.vpcf_c',
        ])).toBe('effects');
    });

    it('keeps hero effects with their hero when shared particles are included', () => {
        expect(classifyGlobalModType([
            'particles/abilities/inferno/inferno_ground_fire.vpcf_c',
            'particles/generic/air_dash.vpcf_c',
        ])).toBeNull();
    });

    it('does not classify particle textures or misplaced particle files alone', () => {
        expect(classifyGlobalModType(['materials/particle/rainbow2.vtex_c'])).toBeNull();
        expect(classifyGlobalModType(['generic/air_dash.vpcf_c'])).toBeNull();
    });
});

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
