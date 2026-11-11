import { describe, expect, it } from 'vitest';
import { nodeClip, resolveGraphMovementClips, rootStates } from './movementGraphClips';
import { selectMovementClips } from './movementMotion';

const state = (index: number, child: number) => ({ _class: 'CNmStateNode::CDefinition', m_nNodeIdx: index, m_nChildNodeIdx: child });
const machine = (index: number, states: number[], fallback = 0) => ({ _class: 'CNmStateMachineNode::CDefinition', m_nNodeIdx: index,
  m_nDefaultStateIndex: fallback, m_stateDefinitions: states.map((m_nStateNodeIdx) => ({ m_nStateNodeIdx })) });
const clip = (index: number, slot: number) => ({ _class: 'CNmClipNode::CDefinition', m_nNodeIdx: index, m_nDataSlotIdx: slot });

/** Mina's parry graph, cut down: each top state holds a state machine whose default (ground) state plays a clip. */
const parryGraph = {
  m_resources: ['models/heroes_wip/vampirebat/clips/vampirebat_parry_to_idle.vnmclip', 'models/heroes_wip/vampirebat/clips/vampirebat_parry_to_success.vnmclip'],
  m_nRootNodeIdx: 0,
  m_nodePaths: ['HERO_Parry', 'HERO_Parry/Off', 'HERO_Parry/Parry', 'HERO_Parry/Parry/SM', 'HERO_Parry/Parry/SM/Parry', 'HERO_Parry/Parry/SM/Parry/Parry',
    'HERO_Parry/Parry/SM/Parry InAir', 'HERO_Parry/Parry/SM/Parry InAir/Parry InAir', 'HERO_Parry/Parry_Success', 'HERO_Parry/Parry_Success/Blend',
    'HERO_Parry/Parry_Success/Blend/Clip'],
  m_nodes: [machine(0, [1, 2, 8]), { _class: 'CNmStateNode::CDefinition', m_nNodeIdx: 1, m_nChildNodeIdx: -1, m_bIsOffState: true }, state(2, 3),
    machine(3, [4, 6]), state(4, 5), clip(5, 0), state(6, 7), clip(7, 1),
    // A node the descent does not know: the first clip under it
    state(8, 9), { _class: 'CNmBlend1DNode::CDefinition', m_nNodeIdx: 9 }, clip(10, 1)],
};

describe('movement graph clips', () => {
  it('reads what a state plays through its default states, and the first clip under any other node', () => {
    const states = rootStates(parryGraph);
    expect([...states.keys()]).toEqual(['off', 'parry', 'parry_success']);
    expect(nodeClip(parryGraph, states.get('parry')!)).toBe('models/heroes_wip/vampirebat/clips/vampirebat_parry_to_idle.vnmclip_c');
    expect(nodeClip(parryGraph, states.get('parry_success')!)).toBe('models/heroes_wip/vampirebat/clips/vampirebat_parry_to_success.vnmclip_c');
    expect(nodeClip(parryGraph, states.get('off')!)).toBeNull();
  });

  it('finds the parry graph from the model through the graphs it references, and skips clips of another skeleton', async () => {
    const files: Record<string, unknown> = {
      'models/heroes_wip/vampirebat/vampirebat.vmdl_c': { m_vecNmSkeletonRefs: ['models/heroes_wip/vampirebat/vampirebat.vnmskel'], m_animGraph2Refs: [
        { m_sIdentifier: '', m_hGraph: 'animgraphs/hero.vnmgraph+vampirebat.vnmgraph' }, { m_sIdentifier: 'UI', m_hGraph: 'animgraphs/hero_ui.vnmgraph' }] },
      'animgraphs/hero.vnmgraph+vampirebat.vnmgraph_c': { m_resources: ['animgraphs/hero_playercontrol.vnmgraph+vampirebat.vnmgraph'], m_nodes: [] },
      'animgraphs/hero_playercontrol.vnmgraph+vampirebat.vnmgraph_c': { m_resources: ['animgraphs/hero_parry.vnmgraph+vampirebat.vnmgraph'], m_nodes: [] },
      'animgraphs/hero_parry.vnmgraph+vampirebat.vnmgraph_c': parryGraph,
      'models/heroes_wip/vampirebat/clips/vampirebat_parry_to_idle.vnmclip_c': { m_skeleton: 'models/heroes_wip/vampirebat/vampirebat.vnmskel' },
      'models/heroes_wip/vampirebat/clips/vampirebat_parry_to_success.vnmclip_c': { m_skeleton: 'models/heroes_staging/other/other.vnmskel' },
    };
    const read: string[] = [];
    const found = await resolveGraphMovementClips('models/heroes_wip/vampirebat/vampirebat.vmdl_c', async (entry) => {
      read.push(entry);
      if (!(entry in files)) throw new Error(`no ${entry}`);
      return files[entry];
    });
    expect(found.parry).toEqual({ clip: 'models/heroes_wip/vampirebat/clips/vampirebat_parry_to_idle.vnmclip_c',
      graph: 'animgraphs/hero_parry.vnmgraph+vampirebat.vnmgraph_c', state: 'HERO_Parry/Parry' });
    expect(found.parrySuccess).toBeUndefined();
    expect(read).not.toContain('animgraphs/hero_ui.vnmgraph_c');
  });

  it('prefers the graph clip over names, which stay the fallback', () => {
    const paths = ['models/heroes_wip/vampirebat/clips/vampirebat_stand_idle.vnmclip_c', 'models/heroes_wip/vampirebat/clips/vampirebat_parry_to_idle.vnmclip_c',
      'models/heroes_wip/vampirebat/clips/vampirebat_parry_success.vnmclip_c'];
    const model = 'models/heroes_wip/vampirebat/vampirebat.vmdl_c';
    const byName = new Map(selectMovementClips(paths, model));
    expect(byName.get('parry')).toBeUndefined();
    const withGraph = new Map(selectMovementClips(paths, model, [], [], { parry: paths[1], parrySuccess: 'models/missing.vnmclip_c' }));
    expect(withGraph.get('parry')).toBe(paths[1]);
    // A graph clip the packages do not have falls back to the name
    expect(withGraph.get('parrySuccess')).toBe(paths[2]);
  });
});
