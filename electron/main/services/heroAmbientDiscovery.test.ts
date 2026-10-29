import { describe, expect, it } from 'vitest';
import type { KVObject } from '../../../src/lib/particles/kv';
import { discoverAmbientEffects } from './heroAmbientDiscovery';
import type { PackageStack } from './heroParticleSources';

function stack(entries: Record<string, KVObject>): PackageStack {
    return {
        decode: async (entry: string) => entries[entry] ?? null,
        read: () => null,
        decodeLoose: async () => ({}),
    } as unknown as PackageStack;
}

const keyValues = `<!-- kv3 encoding:text:version{e21c7f3c-8a33-41c5-9977-a76d3a32aa0d} format:vmdlkeys4:version{9f5c1002-f19f-470c-bd42-c3c26c063d33} -->
{
	CCitadelHeroModelGameData_t = { m_hAmbientParticle = resource_name:"" }
	particle_cfg_list = [ { name = resource:"particles/abilities/abrams/abrams_ambient_book.vpcf" config = "preview" } ]
	particles_list = [ { name = resource:"particles/x/glow.vpcf" attachment_type = "point_follow" attachment_point = "hand_R" attachment_offset = [ 1.0, 2.0, 3.0 ] } ]
}`;

describe('discoverAmbientEffects', () => {
    it('keeps actor gameplay ambients out of showcase while retaining model effects', async () => {
        const entries = {
            'scripts/heroes.vdata_c': { hero_inferno: { m_strModelName: 'models/inferno.vmdl', m_hAmbientParticle: 'particles/abilities/inferno/inferno_hand_ambient.vpcf' } },
            'models/inferno.vmdl_c': { m_modelInfo: { m_keyValueText: keyValues } },
        };
        const showcase = await discoverAmbientEffects(stack(entries), 'Infernus');
        expect(showcase.effects.map((effect) => effect.source)).toEqual(['model-particle-cfg', 'model-particles-list']);
        expect(showcase.notes.some((note) => note.includes('match ambient'))).toBe(true);
        const match = await discoverAmbientEffects(stack(entries), 'Infernus', { context: 'match' });
        expect(match.effects.find((effect) => effect.source === 'hero-ambient')?.system).toBe('particles/abilities/inferno/inferno_hand_ambient.vpcf');
    });
    it('reads model keyvalues, hero vdata, the passive weapon particle and clip events', async () => {
        const result = await discoverAmbientEffects(stack({
            'scripts/heroes.vdata_c': {
                hero_atlas: {
                    m_strModelName: 'models/heroes_wip/abrams/abrams.vmdl',
                    m_hAmbientParticle: 'particles/x/hero_ambient.vpcf',
                    m_mapBoundAbilities: { ESlot_Weapon_Primary: 'weapon_atlas' },
                },
            },
            'scripts/abilities.vdata_c': { weapon_atlas: { m_PassiveWeaponParticle: 'particles/x/weapon.vpcf', m_strPassiveWeaponAttachmentSource: 'attach_fx' } },
            'models/heroes_wip/abrams/abrams.vmdl_c': {
                m_modelInfo: { m_keyValueText: keyValues },
                m_animGraph2Refs: [{ m_sIdentifier: 'ui', m_hGraph: 'animgraphs/hero_ui.vnmgraph' }],
            },
            'animgraphs/hero_ui.vnmgraph_c': { m_resources: ['models/abrams/clips/ui_hero_select.vnmclip'] },
            'models/abrams/clips/ui_hero_select.vnmclip_c': {
                m_events: [
                    { m_animEventClassName: 'AE_CL_CREATE_PARTICLE_EFFECT', m_flStartTime: { m_flValue: 0.25 },
                        m_KV: { name: 'particles/x/event.vpcf', attachment_type: 'point_follow', attachment_point: 'head', stop_on_seq_change: true } },
                    { m_animEventClassName: 'AE_CL_STOP_PARTICLE_EFFECT', m_flStartTime: { m_flValue: 0.75 }, m_KV: { name: 'particles/x/event.vpcf', stop_instantly: true } },
                    { m_animEventClassName: 'AE_CL_PLAYSOUND', m_flStartTime: { m_flValue: 0.1 }, m_KV: { name: 'x' } },
                ],
            },
        }), 'Abrams', { context: 'match' });

        expect(result.heroKey).toBe('hero_atlas');
        expect(result.modelEntry).toBe('models/heroes_wip/abrams/abrams.vmdl_c');
        expect(result.effects.map((effect) => [effect.source, effect.system, effect.configuration])).toEqual([
            ['model-particle-cfg', 'particles/abilities/abrams/abrams_ambient_book.vpcf', 'preview'],
            ['model-particles-list', 'particles/x/glow.vpcf', null],
            ['hero-ambient', 'particles/x/hero_ambient.vpcf', null],
            ['weapon-passive', 'particles/x/weapon.vpcf', null],
            ['anim-event', 'particles/x/event.vpcf', null],
        ]);
        expect(result.effects[1].attachment).toEqual({ type: 'point_follow', point: 'hand_R', offset: [1, 2, 3] });
        expect(result.effects[4].clip).toEqual({ name: 'ui_hero_select', start: 0.25, stops: [{ time: 0.75, immediately: true, endCap: false }], stopOnClipChange: true });
        expect(result.effects[4].attachment).toEqual({ type: 'point_follow', point: 'head', offset: [0, 0, 0] });
    });

    it('shows a code-spawned weapon particle through the preview system that places it', async () => {
        const vdata = (field: string) => ({
            'scripts/heroes.vdata_c': {
                hero_unicorn: { m_strModelName: 'models/heroes_wip/unicorn/unicorn.vmdl', m_mapBoundAbilities: { ESlot_Weapon_Primary: 'citadel_weapon_unicorn_set' } },
            },
            'scripts/abilities.vdata_c': { citadel_weapon_unicorn_set: { [field]: 'particles/abilities/unicorn/unicorn_ambient_baton_fire.vpcf' } },
            'models/heroes_wip/unicorn/unicorn.vmdl_c': { m_modelInfo: { m_keyValueText: '' } },
        });
        const wrapper = (child: string) => ({
            'particles/abilities/unicorn/unicorn_ambient_weapon.vpcf_c': { m_Children: [{ m_ChildRef: child }, { m_ChildRef: child }] },
        });

        const found = await discoverAmbientEffects(stack({ ...vdata('m_BatonFlameParticle'), ...wrapper('particles/abilities/unicorn/unicorn_ambient_baton_fire.vpcf') }), 'Celeste', { skipAnimationEvents: true });
        expect(found.effects.map((effect) => [effect.source, effect.system, effect.configuration])).toEqual([
            ['weapon-code', 'particles/abilities/unicorn/unicorn_ambient_weapon.vpcf', 'preview'],
        ]);

        // A mod that points the field elsewhere is not shown through the stock preview system.
        const renamed = await discoverAmbientEffects(stack({ ...vdata('m_BatonFlameParticle'), ...wrapper('particles/mod/other_fire.vpcf') }), 'Celeste', { skipAnimationEvents: true });
        expect(renamed.effects).toEqual([]);
        expect(renamed.notes.some((note) => note.includes('m_BatonFlameParticle'))).toBe(true);
    });

    it('fails for a hero the vdata does not know', async () => {
        await expect(discoverAmbientEffects(stack({ 'scripts/heroes.vdata_c': {} }), 'Abrams')).rejects.toThrow(/heroes.vdata/);
    });
});
