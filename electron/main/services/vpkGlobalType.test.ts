import { describe, expect, it } from 'vitest';
import { classifyGlobalModType, inferHeroFromVpkPaths } from './vpk';

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

describe('global sounds', () => {
    it.each([
        ['Spirit Urn lines', 'sounds/vo/spirit_jar/spirit_jar_idol_delivered_01.vsnd_c'],
        ['Patron VO', 'sounds/vo/announcer/female_patron/female_patron_match_start_01.vsnd_c'],
        ['newscaster VO', 'sounds/vo/newscaster/newscaster_headline_01.vsnd_c'],
        ['vaults', 'sounds/npc/neutrals/vaults/vault_open_01.vsnd_c'],
        ['shared parry', 'sounds/player/melee/shared/melee_parry_success_01.vsnd_c'],
        ['hit feedback', 'sounds/hit_indicators/damage_send_crit_01.vsnd_c'],
        ['UI', 'sounds/ui/ui_shop_purchase_item_01.vsnd_c'],
    ])('files %s under Announcer / SFX', (_label, path) => {
        expect(classifyGlobalModType([path, 'soundevents/vo/generated_vo_misc.vsndevts_c'])).toBe('announcer');
    });

    it('keeps one hero\'s pack with its hero when it also ships shared sounds', () => {
        expect(classifyGlobalModType([
            'sounds/abilities/viper/a3_slide/viper_slide_01.vsnd_c',
            'sounds/gameplay/slide/slide_start_01.vsnd_c',
            'sounds/ui/ui_menu_click_01.vsnd_c',
        ])).toBeNull();
    });

    it('files a pack revoicing three heroes as global, but not two', () => {
        const emote = (codename: string) => `sounds/vo/${codename}/emote/${codename}_death_01.vsnd_c`;
        expect(classifyGlobalModType([emote('astro'), emote('bebop'), emote('chrono')])).toBe('announcer');
        expect(classifyGlobalModType([emote('astro'), emote('bebop')])).toBeNull();
    });

    it('leaves music to the category-derived Killstreak Music type', () => {
        expect(classifyGlobalModType(['sounds/music/music_stinger_ks_01.vsnd_c'])).toBeNull();
    });
});

describe('inferHeroFromVpkPaths', () => {
    it('reads the hero from voice lines and footsteps', () => {
        expect(inferHeroFromVpkPaths(['sounds/vo/drifter/drifter_desperation_power1_01.vsnd_c'])).toBe('Drifter');
        expect(inferHeroFromVpkPaths(['sounds/player/footsteps/bebop/bebop_footstep_01.vsnd_c'])).toBe('Bebop');
    });

    it('does not take a non-hero speaker for a hero', () => {
        expect(inferHeroFromVpkPaths(['sounds/vo/announcer/male_patron/male_patron_01.vsnd_c'])).toBeNull();
        expect(inferHeroFromVpkPaths(['sounds/vo/spirit_jar/spirit_jar_idol_delivered_01.vsnd_c'])).toBeNull();
    });
});
