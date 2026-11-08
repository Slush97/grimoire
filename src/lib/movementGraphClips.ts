// The clips a hero's movement actions play, read the way the game picks them: from the hero's own
// animation graph (the model's gameplay graph and the graphs it references, e.g.
// hero.vnmgraph+<hero> -> hero_playercontrol.vnmgraph+<hero> -> hero_parry.vnmgraph+<hero>), not from
// clip names. A state's clip is what it plays on the ground: through its state machines' default
// states down to the clip node, whose data slot names the resource. Pure; decoding is injected.

/** A graph state's clip, and where it was read. */
export interface GraphClip {
  /** The compiled clip, `...vnmclip_c`. */
  clip: string;
  /** The compiled graph the state is in. */
  graph: string;
  /** The state's node path in that graph. */
  state: string;
}

/** The movement actions read from a graph, by the states that play them (matched without case). */
export const GRAPH_MOVEMENT_STATES = {
  parry: 'Parry',
  parrySuccess: 'Parry_Success',
} as const;
export type GraphMovementAction = keyof typeof GRAPH_MOVEMENT_STATES;

interface GraphNode { _class?: string; [key: string]: unknown }
interface Graph { m_resources?: unknown; m_nodePaths?: unknown; m_nodes?: unknown; m_nRootNodeIdx?: unknown }

const compiled = (path: string) => (path.endsWith('_c') ? path : `${path}_c`).replace(/\\/g, '/');
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asNode = (value: unknown): GraphNode => (value !== null && typeof value === 'object' ? value as GraphNode : {});

/** The clip a node plays: a clip node's resource, through a state's child and a state machine's default state. */
export function nodeClip(graph: Graph, nodeIndex: number, depth = 0): string | null {
  const nodes = asArray(graph.m_nodes), paths = asArray(graph.m_nodePaths), resources = asArray(graph.m_resources);
  const node = asNode(nodes[nodeIndex]);
  if (depth > 32 || nodeIndex < 0 || nodeIndex >= nodes.length) return null;
  const kind = String(node._class ?? '').replace(/::CDefinition$/, '');
  if (kind === 'CNmClipNode') {
    const resource = resources[Number(node.m_nDataSlotIdx)];
    return typeof resource === 'string' && /\.vnmclip(_c)?$/.test(resource) ? compiled(resource) : null;
  }
  if (kind === 'CNmStateNode') return nodeClip(graph, Number(node.m_nChildNodeIdx), depth + 1);
  if (kind === 'CNmStateMachineNode') {
    const states = asArray(node.m_stateDefinitions).map((entry) => Number(asNode(entry).m_nStateNodeIdx));
    const index = Number(node.m_nDefaultStateIndex ?? 0);
    return nodeClip(graph, states[index] ?? states[0] ?? -1, depth + 1);
  }
  // Anything else (a blend, a selector): the first clip under it
  const prefix = `${String(paths[nodeIndex] ?? '')}/`;
  for (let i = 0; i < nodes.length; i++) {
    if (String(paths[i] ?? '').startsWith(prefix) && String(asNode(nodes[i])._class ?? '').startsWith('CNmClipNode')) return nodeClip(graph, i, depth + 1);
  }
  return null;
}

/** The states of a graph's root state machine, by name. */
export function rootStates(graph: Graph): Map<string, number> {
  const nodes = asArray(graph.m_nodes), paths = asArray(graph.m_nodePaths);
  const root = asNode(nodes[Number(graph.m_nRootNodeIdx)]);
  const states = new Map<string, number>();
  if (!String(root._class ?? '').startsWith('CNmStateMachineNode')) return states;
  for (const entry of asArray(root.m_stateDefinitions)) {
    const index = Number(asNode(entry).m_nStateNodeIdx);
    const name = String(paths[index] ?? '').split('/').at(-1);
    if (name) states.set(name.toLowerCase(), index);
  }
  return states;
}

/**
 * The movement clips the hero's gameplay graph plays: the first graph, breadth first from the model's
 * graph (its unnamed reference, not the UI one), whose root state machine has the actions' states.
 * Graphs named for an action are read first, then everything else, at most `limit` graphs. A clip
 * made for another skeleton than the model's is left out (an inherited graph can name one).
 */
export async function resolveGraphMovementClips(modelEntry: string, decode: (entry: string) => Promise<unknown>, limit = 48):
  Promise<Partial<Record<GraphMovementAction, GraphClip>>> {
  const model = asNode(await decode(modelEntry).catch(() => null));
  const refs = asArray(model.m_animGraph2Refs).map(asNode).filter((ref) => String(ref.m_sIdentifier ?? '').toLowerCase() !== 'ui');
  const queue = refs.map((ref) => String(ref.m_hGraph ?? '')).filter(Boolean).map(compiled);
  const seen = new Set<string>(queue);
  const skeletons = asArray(model.m_vecNmSkeletonRefs).filter((value): value is string => typeof value === 'string');
  const fitsModel = async (clip: string) => {
    if (skeletons.length === 0) return true;
    const skeleton = asNode(await decode(clip).catch(() => null)).m_skeleton;
    return typeof skeleton === 'string' && skeletons.includes(skeleton);
  };
  const found: Partial<Record<GraphMovementAction, GraphClip>> = {};
  const priority = (path: string) => (/parry/i.test(path) ? 0 : /playercontrol/i.test(path) ? 1 : 2);
  for (let read = 0; queue.length > 0 && read < limit; read++) {
    queue.sort((a, b) => priority(a) - priority(b));
    const path = queue.shift()!;
    const graph = asNode(await decode(path).catch(() => null)) as Graph;
    const states = rootStates(graph);
    for (const [action, state] of Object.entries(GRAPH_MOVEMENT_STATES) as [GraphMovementAction, string][]) {
      const index = states.get(state.toLowerCase());
      if (found[action] || index === undefined) continue;
      const clip = nodeClip(graph, index);
      if (clip && await fitsModel(clip)) found[action] = { clip, graph: path, state: String(asArray(graph.m_nodePaths)[index]) };
    }
    if (Object.keys(GRAPH_MOVEMENT_STATES).every((action) => found[action as GraphMovementAction])) break;
    for (const resource of asArray(graph.m_resources)) {
      if (typeof resource !== 'string' || !/\.vnmgraph(_c)?$/.test(resource)) continue;
      const child = compiled(resource);
      if (!seen.has(child)) { seen.add(child); queue.push(child); }
    }
  }
  return found;
}
