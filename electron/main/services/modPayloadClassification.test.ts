import { describe, expect, it } from 'vitest';
import { classifyModPayload } from './modPayloadClassification';

describe('conservative payload classification', () => {
    it.each([
        'models/hideout/materials/display_color.vtex_c',
        'materials/models/hideout/display.vmat_c',
        'materials/hideout/display.vmat_c',
        'MODELS\\HIDEOUT\\display.vmdl_c',
    ])('recognizes Hideout art without requiring a model: %s', path => {
        expect(classifyModPayload([path, 'addoninfo.txt', 'modinfo.json']))
            .toEqual({ kind: 'general', globalType: 'hideout' });
    });

    it('recognizes the Mina and Vindicta skin payloads despite broad category metadata', () => {
        expect(classifyModPayload(['models/heroes_wip/vampirebat/vampirebat.vmdl_c']))
            .toEqual({ kind: 'hero', hero: 'Mina' });
        expect(classifyModPayload([
            'models/heroes_staging/hornet_v3/hornet.vmdl_c',
            'particles/abilities/hornet/tracer.vpcf_c',
            'particles/weapon_fx/hornet/impact.vpcf_c',
        ])).toEqual({ kind: 'hero', hero: 'Vindicta' });
    });

    it('keeps a skin with incidental multi-hero portraits on its own hero', () => {
        expect(classifyModPayload([
            'models/heroes_staging/yamato/body.vmdl_c',
            'panorama/images/heroes/haze_card_psd.vtex_c',
            'panorama/images/heroes/wraith_card_psd.vtex_c',
        ])).toEqual({ kind: 'hero', hero: 'Yamato' });
    });

    it('routes a multi-hero portrait pack to Icons & Portraits', () => {
        expect(classifyModPayload([
            'panorama/images/heroes/bull_card_psd.vtex_c',
            'panorama/images/heroes/backgrounds/ghost_bg_psd.vtex_c',
        ])).toEqual({ kind: 'general', globalType: 'icons' });
    });

    it('counts canonical hero identities rather than portrait filenames', () => {
        expect(classifyModPayload([
            'panorama/images/heroes/hornet_card_psd.vtex_c',
            'panorama/images/heroes/backgrounds/vindicta_bg_psd.vtex_c',
            'panorama/images/heroes/hero_names/vindicta.vsvg_c',
        ])).toEqual({ kind: 'hero', hero: 'Vindicta' });
    });

    it.each(['layout/custom.vxml_c', 'styles/custom.vcss_c', 'images/hud/health.vtex_c', 'images/items/mods/item.vtex_c'])(
        'routes functional HUD and item art to HUD: %s', path => {
            expect(classifyModPayload([`panorama/${path}`]))
                .toEqual({ kind: 'general', globalType: 'hud' });
        },
    );

    it('keeps a functional HUD with bundled portraits on HUD', () => {
        expect(classifyModPayload([
            'panorama/layout/custom.vxml_c',
            'panorama/images/heroes/haze_card_psd.vtex_c',
            'panorama/images/heroes/wraith_card_psd.vtex_c',
        ])).toEqual({ kind: 'general', globalType: 'hud' });
    });

    it.each([
        ['models/heroes_wip/haze/body.vmdl_c', 'models/heroes_wip/wraith/body.vmdl_c'],
        ['models/hideout/display.vmdl_c', 'models/heroes_wip/haze/body.vmdl_c'],
        ['models/hideout/display.vmdl_c', 'panorama/images/heroes/haze_card_psd.vtex_c'],
        ['models/hideout/display.vmdl_c', 'panorama/layout/custom.vxml_c'],
        ['models/heroes_wip/haze/body.vmdl_c', 'panorama/layout/custom.vxml_c'],
        ['models/heroes_wip/unsupported/body.vmdl_c', 'panorama/images/heroes/haze_card_psd.vtex_c'],
        ['panorama/images/heroes/shopkeeper_card_psd.vtex_c'],
    ])('leaves conflicting or unsupported payloads unassigned: %j', (...paths) => {
        expect(classifyModPayload(paths)).toEqual({ kind: 'ambiguous' });
    });

    it('does not treat names containing hideout or heroes as dedicated asset paths', () => {
        expect(classifyModPayload(['models/props/hideout_poster.vmdl_c', 'panorama/images/heroes_extra/haze.vtex_c']))
            .toEqual({ kind: 'unknown' });
    });
});
