import { describe, expect, it } from 'vitest';
import { discoverRiggedHeroClips } from './heroRiggedClips';
import { selectHeroAnimations } from '../../../src/lib/heroAnimationCatalog';

const modelEntry = 'models/heroes_wip/example/example.vmdl_c';
const folder = 'models/heroes_wip/example/clips/ui_shop.vnmclip_c';
const graphClip = 'models/shared/clips/ui_shop.vnmclip_c';
const raw = { m_nNumFrames: 61, m_flDuration: 2, m_bIsAdditive: false,
    m_rootMotion: { m_flAverageLinearVelocity: 0, m_flAverageAngularVelocityRadians: 0 } };
const embedded = { name: 'primary_stand_idle', frameCount: 61, fps: 30, durationSeconds: 2, looping: true, default: true };
const graph = (looping = true, overrides = {}) => ({ m_resources: [graphClip.slice(0, -2)], m_nRootNodeIdx: 2,
    m_nodePaths: ['Hero_UI/Hero_Shop', 'Hero_UI/Hero_Shop/clip'], m_nodes: [
        { _class: 'CNmStateNode::CDefinition', m_nNodeIdx: 0, m_nChildNodeIdx: 1, m_nLayerWeightNodeIdx: -1,
            m_nLayerRootMotionWeightNodeIdx: -1, m_nLayerBoneMaskNodeIdx: -1, m_bIsOffState: false, ...overrides },
        { _class: 'CNmClipNode::CDefinition', m_nNodeIdx: 1, m_nDataSlotIdx: 0, m_bAllowLooping: looping,
            m_nPlayInReverseValueNodeIdx: -1, m_nResetTimeValueNodeIdx: -1, m_flSpeedMultiplier: 1 },
        { _class: 'CNmStateMachineNode::CDefinition', m_nNodeIdx: 2, m_stateDefinitions: [{ m_nStateNodeIdx: 0 }] },
    ] });

async function discover(resources: Record<string, unknown>, paths = [folder], clips = [embedded]) {
    return discoverRiggedHeroClips({ modelEntry, heroName: 'Unknown', paths, embedded: clips, decode: async entry => resources[entry] ?? null });
}

describe('rigged clip discovery', () => {
    it.each([true, false])('uses the direct UI shop leaf and its loop flag %s ahead of legacy recipes', async looping => {
        const clips = await discover({
            [modelEntry]: { m_animGraph2Refs: [{ m_sIdentifier: 'ui', m_hGraph: 'ui.vnmgraph' }] },
            'ui.vnmgraph_c': graph(looping), [graphClip]: raw,
        }, [graphClip]);
        expect(selectHeroAnimations(clips, 'Billy')[0]).toMatchObject({ resource: graphClip,
            showcase: { state: 'shop', playback: looping ? 'loop' : 'hold' } });
    });
    it('uses graph state slots even when the game clip has an unfamiliar name', async () => {
        const path = 'models/shared/clips/new_relaxed_motion.vnmclip_c';
        const clips = await discover({
            [modelEntry]: { m_animGraph2Refs: [{ m_sIdentifier: 'ui', m_hGraph: 'ui.vnmgraph' }] },
            'ui.vnmgraph_c': { ...graph(), m_resources: [path.slice(0, -2)] }, [path]: raw,
        }, [path]);
        expect(selectHeroAnimations(clips, 'Billy')[0]?.name).toBe('new_relaxed_motion');
    });
    it('preserves a constant authored shop playback speed', async () => {
        const shop = graph();
        const clips = await discover({
            [modelEntry]: { m_animGraph2Refs: [{ m_sIdentifier: 'ui', m_hGraph: 'ui.vnmgraph' }] },
            'ui.vnmgraph_c': { ...shop, m_nodes: shop.m_nodes.map(node => node.m_nNodeIdx === 1 ? { ...node, m_flSpeedMultiplier: 0.69 } : node) },
            [graphClip]: raw,
        }, [graphClip]);
        expect(selectHeroAnimations(clips)[0]?.showcase).toMatchObject({ state: 'shop', playback: 'loop', speed: 0.69 });
    });
    it.each([{ m_nLayerBoneMaskNodeIdx: 2 }, { m_nLayerWeightNodeIdx: 3 }, { m_nChildNodeIdx: 9 }])('refuses masked or composed UI states %j', async overrides => {
        const clips = await discover({
            [modelEntry]: { m_animGraph2Refs: [{ m_sIdentifier: 'ui', m_hGraph: 'ui.vnmgraph' }] },
            'ui.vnmgraph_c': graph(true, overrides), [graphClip]: raw,
        }, [graphClip]);
        expect(clips.every(clip => !clip.showcase)).toBe(true);
        expect(selectHeroAnimations(clips)[0]?.name).toBe(embedded.name);
    });
    it('prefers a safe graph clip to its stale same-name embedded source', async () => {
        const clips = await discover({
            [modelEntry]: { m_animGraph2Refs: [{ m_sIdentifier: 'ui', m_hGraph: 'ui.vnmgraph' }] },
            'ui.vnmgraph_c': graph(), [graphClip]: raw,
        }, [graphClip], [{ ...embedded, name: 'ui_shop' }]);
        expect(selectHeroAnimations(clips)[0]?.showcase?.state).toBe('shop');
        expect(clips.filter(clip => clip.name === 'ui_shop')).toHaveLength(1);
    });
    it('rejects a graph variation inherited from an unrelated skeleton', async () => {
        const clips = await discover({
            [modelEntry]: { m_vecNmSkeletonRefs: ['this.vnmskel'], m_animGraph2Refs: [{ m_sIdentifier: 'ui', m_hGraph: 'ui.vnmgraph' }] },
            'ui.vnmgraph_c': graph(), [graphClip]: { ...raw, m_skeleton: 'other.vnmskel' },
        }, [graphClip]);
        expect(selectHeroAnimations(clips)[0]?.name).toBe(embedded.name);
    });
    it('does not promote a shop leaf beneath a composed graph root', async () => {
        const clips = await discover({
            [modelEntry]: { m_animGraph2Refs: [{ m_sIdentifier: 'ui', m_hGraph: 'ui.vnmgraph' }] },
            'ui.vnmgraph_c': { ...graph(), m_nRootNodeIdx: 99 }, [graphClip]: raw,
        }, [graphClip]);
        expect(clips.every(clip => !clip.showcase)).toBe(true);
    });
    it.each([{ m_bIsAdditive: true }, { m_rootMotion: { m_flAverageLinearVelocity: 3, m_flAverageAngularVelocityRadians: 0 } }])('falls back to the direct hero-select state when shop metadata is unsafe %j', async flags => {
        const select = 'models/shared/clips/ui_hero_select.vnmclip_c';
        const shopGraph = graph();
        const clips = await discover({
            [modelEntry]: { m_animGraph2Refs: [{ m_sIdentifier: 'ui', m_hGraph: 'ui.vnmgraph' }] },
            'ui.vnmgraph_c': { ...shopGraph, m_resources: [graphClip.slice(0, -2), select.slice(0, -2)],
                m_nodePaths: [...shopGraph.m_nodePaths, 'Hero_UI', 'Hero_UI/Hero_Select', 'Hero_UI/Hero_Select/clip'],
                m_nodes: [...shopGraph.m_nodes.slice(0, 2),
                    { _class: 'CNmStateMachineNode::CDefinition', m_nNodeIdx: 2, m_stateDefinitions: [{ m_nStateNodeIdx: 0 }, { m_nStateNodeIdx: 3 }] },
                    { ...shopGraph.m_nodes[0], m_nNodeIdx: 3, m_nChildNodeIdx: 4 },
                    { ...shopGraph.m_nodes[1], m_nNodeIdx: 4, m_nDataSlotIdx: 1, m_bAllowLooping: false }] },
            [graphClip]: { ...raw, ...flags }, [select]: raw,
        }, [graphClip, select]);
        expect(selectHeroAnimations(clips, 'Billy')[0]).toMatchObject({ resource: select, showcase: { state: 'heroSelect', playback: 'hold' } });
    });
    it('combines embedded clips with neighboring external whole actions', async () => {
        const clips = await discover({ [folder]: raw });
        expect(clips.map(clip => [clip.name, clip.resource])).toEqual([
            ['primary_stand_idle', 'legacy:primary_stand_idle'], ['ui_shop', folder],
        ]);
        expect(clips[1]).toMatchObject({ frameCount: 61, fps: 30, durationSeconds: 2 });
    });
    it('prefers the UI graph resource over other graphs and neighboring files', async () => {
        const clips = await discover({
            [modelEntry]: { m_animGraph2Refs: [{ m_sIdentifier: '', m_hGraph: 'main.vnmgraph' }, { m_sIdentifier: 'ui', m_hGraph: 'ui.vnmgraph' }] },
            'main.vnmgraph_c': { m_resources: [folder.slice(0, -2)] },
            'ui.vnmgraph_c': { m_resources: [graphClip.slice(0, -2)] }, [graphClip]: raw,
        }, [folder, graphClip]);
        expect(clips[1].resource).toBe(graphClip);
    });
    it('keeps the embedded source when both generations share a name', async () => {
        const clip = { ...embedded, name: 'ui_shop' };
        expect(await discover({ [folder]: raw }, [folder], [clip])).toEqual([{ ...clip, resource: 'legacy:ui_shop' }]);
    });
    it('uses the external source when the same-name embedded clip cannot play', async () => {
        const clips = await discover({ [folder]: raw }, [folder], [{ ...embedded, name: 'ui_shop', frameCount: 1, durationSeconds: 0 }]);
        expect(selectHeroAnimations(clips, 'Deadman Danny').map(clip => 'resource' in clip && clip.resource)).toEqual([folder]);
    });
    it.each([{ m_bIsAdditive: true }, { m_rootMotion: { m_flAverageLinearVelocity: 5, m_flAverageAngularVelocityRadians: 0 } }, { m_nNumFrames: 1, m_flDuration: 0 }, { m_nNumFrames: 1, m_flDuration: 0.0001 }])('rejects unsafe external animation metadata %j', async flags => {
        const clips = await discover({ [folder]: { ...raw, ...flags } }, [folder], []);
        expect(selectHeroAnimations(clips, 'Deadman Danny')).toEqual([]);
    });
    it('does not cache a failed external resource decode as an empty menu', async () => {
        await expect(discover({ [folder]: null })).rejects.toThrow('Invalid external hero clip metadata');
    });
});
