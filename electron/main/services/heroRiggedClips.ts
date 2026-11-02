import { posix } from 'node:path';
import { z } from 'zod';
import { heroAnimationRecipe, isStandaloneHeroAnimation, type HeroAnimationInfo, type HeroShowcaseAnimation } from '../../../src/lib/heroAnimationCatalog';

export interface RiggedHeroClip extends HeroAnimationInfo {
    resource: string;
}

const modelSchema = z.object({
    m_animGraph2Refs: z.array(z.object({ m_sIdentifier: z.string(), m_hGraph: z.string() })).default([]),
    m_vecNmSkeletonRefs: z.array(z.string()).default([]),
});
const graphSchema = z.object({
    m_resources: z.array(z.string()).default([]), m_nodePaths: z.array(z.string()).default([]),
    m_nodes: z.array(z.unknown()).default([]), m_nRootNodeIdx: z.number().int().optional(),
});
const stateMachineSchema = z.object({
    _class: z.literal('CNmStateMachineNode::CDefinition'), m_nNodeIdx: z.number().int(),
    m_stateDefinitions: z.array(z.object({ m_nStateNodeIdx: z.number().int() })),
});
const stateSchema = z.object({
    _class: z.literal('CNmStateNode::CDefinition'), m_nNodeIdx: z.number().int().nonnegative(), m_nChildNodeIdx: z.number().int(),
    m_nLayerWeightNodeIdx: z.literal(-1), m_nLayerRootMotionWeightNodeIdx: z.literal(-1), m_nLayerBoneMaskNodeIdx: z.literal(-1),
    m_bIsOffState: z.literal(false),
});
const clipNodeSchema = z.object({
    _class: z.literal('CNmClipNode::CDefinition'), m_nNodeIdx: z.number().int(), m_nDataSlotIdx: z.number().int().nonnegative(),
    m_bAllowLooping: z.boolean(), m_nPlayInReverseValueNodeIdx: z.literal(-1), m_nResetTimeValueNodeIdx: z.literal(-1),
    m_flSpeedMultiplier: z.number().finite().positive(),
});
const clipSchema = z.object({
    m_skeleton: z.string().optional(),
    m_nNumFrames: z.number().int().nonnegative(), m_flDuration: z.number().finite().nonnegative(), m_bIsAdditive: z.boolean(),
    m_rootMotion: z.object({ m_flAverageLinearVelocity: z.number().finite(), m_flAverageAngularVelocityRadians: z.number().finite() }),
});

/** Keep the resolved resource beside its metadata so export cannot rediscover a different clip. */
export async function discoverRiggedHeroClips(options: {
    embedded: readonly HeroAnimationInfo[];
    modelEntry: string;
    heroName: string;
    paths: readonly string[];
    decode: (entry: string) => Promise<unknown>;
}): Promise<RiggedHeroClip[]> {
    const { embedded, modelEntry, heroName, paths, decode } = options;
    const resources = new Map<string, string>();
    const showcases = new Map<string, HeroShowcaseAnimation>();
    const available = new Set(paths);
    const add = (path: string) => {
        const compiled = path.endsWith('_c') ? path : `${path}_c`;
        if (!compiled.endsWith('.vnmclip_c') || !available.has(compiled)) return;
        const name = posix.basename(compiled, '.vnmclip_c');
        if (!resources.has(name)) resources.set(name, compiled);
    };
    const model = modelSchema.safeParse(await decode(modelEntry));
    for (const ref of (model.success ? model.data.m_animGraph2Refs : []).sort((a, b) => Number(b.m_sIdentifier === 'ui') - Number(a.m_sIdentifier === 'ui'))) {
        const graphPath = ref.m_hGraph.endsWith('_c') ? ref.m_hGraph : `${ref.m_hGraph}_c`;
        const graph = graphSchema.safeParse(await decode(graphPath));
        if (!graph.success) continue;
        graph.data.m_resources.forEach(add);
        if (ref.m_sIdentifier.toLowerCase() !== 'ui') continue;
        // Accept only an unmasked state that directly plays one clip. A graph
        // resource list alone cannot prove a leaf is a complete body action.
        const leaves = graph.data.m_nodes.map(node => clipNodeSchema.safeParse(node)).flatMap(node => node.success ? [node.data] : []);
        const root = graph.data.m_nodes.map(node => stateMachineSchema.safeParse(node))
            .find(node => node.success && node.data.m_nNodeIdx === graph.data.m_nRootNodeIdx);
        if (!root?.success) continue;
        for (const node of graph.data.m_nodes) {
            const state = stateSchema.safeParse(node);
            if (!state.success || !root.data.m_stateDefinitions.some(entry => entry.m_nStateNodeIdx === state.data.m_nNodeIdx)) continue;
            const path = graph.data.m_nodePaths[state.data.m_nNodeIdx] ?? '';
            const role = /\/(?:hero_)?shop$/i.test(path) ? 'shop' : /\/(?:hero_)?select$/i.test(path) ? 'heroSelect' : null;
            if (!role) continue;
            const leaf = leaves.find(clip => clip.m_nNodeIdx === state.data.m_nChildNodeIdx);
            const resource = leaf ? graph.data.m_resources[leaf.m_nDataSlotIdx] : undefined;
            if (!leaf || !resource) continue;
            const compiled = resource.endsWith('_c') ? resource : `${resource}_c`;
            if (!available.has(compiled) || !compiled.endsWith('.vnmclip_c')) continue;
            const previous = showcases.get(compiled);
            if (!previous || role === 'shop') showcases.set(compiled, { graph: graphPath, state: role, playback: leaf.m_bAllowLooping ? 'loop' : 'hold',
                ...(leaf.m_flSpeedMultiplier !== 1 ? { speed: leaf.m_flSpeedMultiplier } : {}) });
        }
    }
    const directory = `${posix.dirname(modelEntry)}/clips/`;
    paths.filter(path => path.startsWith(directory)).sort().forEach(add);
    const clips: RiggedHeroClip[] = embedded.map(clip => ({ ...clip, resource: `legacy:${clip.name}` }));
    const embeddedNames = new Set(embedded.filter(isStandaloneHeroAnimation).map(clip => clip.name));
    for (const [name, resource] of resources) {
        // Decode complete UI state leaves and reviewed secondary actions only.
        // Unrelated gameplay layers can number in the hundreds.
        const showcase = showcases.get(resource);
        if ((!showcase && embeddedNames.has(name)) || (!showcase && !heroAnimationRecipe(name, heroName))) continue;
        const parsed = clipSchema.safeParse(await decode(resource));
        if (!parsed.success) throw new Error(`Invalid external hero clip metadata: ${resource}`);
        const raw = parsed.data;
        // Inherited graph variations can point at another hero's skeleton.
        // Never pose this model with that unrelated full-body clip.
        if (showcase && model.success && model.data.m_vecNmSkeletonRefs.length
            && (!raw.m_skeleton || !model.data.m_vecNmSkeletonRefs.includes(raw.m_skeleton))) continue;
        const clip: RiggedHeroClip = {
            name, resource, frameCount: raw.m_nNumFrames, durationSeconds: raw.m_flDuration,
            fps: raw.m_flDuration > 0 ? (raw.m_nNumFrames - 1) / raw.m_flDuration : 0,
            looping: showcase ? showcase.playback === 'loop' : true, default: false, ...(showcase ? { showcase } : {}),
            additive: raw.m_bIsAdditive,
            rootMotion: Math.abs(raw.m_rootMotion.m_flAverageLinearVelocity) > 0.01
                || Math.abs(raw.m_rootMotion.m_flAverageAngularVelocityRadians) > 0.001,
        };
        if (showcase && !isStandaloneHeroAnimation(clip)) continue;
        if (showcase) {
            const previous = clips.findIndex(old => old.name === name);
            if (previous >= 0) clips.splice(previous, 1);
        }
        clips.push(clip);
    }
    return clips;
}
