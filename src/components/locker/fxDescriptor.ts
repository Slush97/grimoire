/**
 * Types + interpretation for the FX descriptor emitted by
 * `vpkmerge particle <entry> --vpk <pak> --out descriptor.json --textures-dir tex/`
 * (vpkmerge-core `export_fx_descriptor`). See
 * `../../../vpkmerge/vpkmerge-core/src/particle.rs` and
 * `../../docs/3d-preview-effects-feasibility.md`.
 *
 * The descriptor lists emitters/initializers/operators/renderers as
 * `{class, params}` with Source's `PF_TYPE_*` numeric wrappers already collapsed
 * (a literal -> a number; a driven value -> `{pf, literal, min, max, ...}`). This
 * module is the renderer's read side: it pulls the handful of fields a CPU sprite
 * sim needs out of those nodes, with sane fallbacks, rather than modelling all
 * ~92 operator classes. It is deliberately a *first-slice* interpretation (sprite
 * emitters only) -- enough to render the curated ambient auras (Wraith, Familiar).
 */

/** Resolve a descriptor texture handle to its bundled PNG filename, using the
 *  same flatten rule as vpkmerge `fx_texture_png_name` (non-alnum -> `_`, +
 *  `.png`), so the renderer needs no manifest. */
export function fxTexturePngName(vtexPath: string): string {
  return vtexPath.replace(/[^a-zA-Z0-9]/g, '_') + '.png';
}

/** A collapsed parameter: a bare number (literal) or a driven wrapper. */
export type FxParam =
  | number
  | {
      pf?: string;
      literal?: number;
      min?: number;
      max?: number;
      in0?: number;
      in1?: number;
      out0?: number;
      out1?: number;
      cp?: number;
      named?: string;
      curve?: unknown;
    };

export interface FxNode {
  class: string;
  params: Record<string, FxParam | unknown>;
}

export interface FxRenderer extends FxNode {
  mode: string;
  blendMode: string | null;
  textures: string[];
}

export interface FxControlPoint {
  cp: number | null;
  attachType: string | null;
  attachment: string | null;
  entity: string | null;
}

export interface FxDescriptor {
  name: string;
  class?: string;
  maxParticles?: number;
  constantRadius?: FxParam;
  constantColor?: number[] | FxParam;
  controlPoints: FxControlPoint[];
  preview?: { model: string | null; sequence: string | null };
  emitters: FxNode[];
  initializers: FxNode[];
  operators: FxNode[];
  renderers: FxRenderer[];
  children: FxDescriptor[];
}

/** Effective scalar of a collapsed param: the number itself, or the wrapper's
 *  literal/mid-of-range, or a fallback. */
export function paramScalar(p: FxParam | unknown, fallback: number): number {
  if (typeof p === 'number') return p;
  if (p && typeof p === 'object') {
    const w = p as Exclude<FxParam, number>;
    if (typeof w.literal === 'number') return w.literal;
    if (typeof w.min === 'number' && typeof w.max === 'number') return (w.min + w.max) / 2;
  }
  return fallback;
}

/** [min, max] of a collapsed param, collapsing a literal to [v, v]. */
export function paramRange(p: FxParam | unknown, fallback: [number, number]): [number, number] {
  if (typeof p === 'number') return [p, p];
  if (p && typeof p === 'object') {
    const w = p as Exclude<FxParam, number>;
    if (typeof w.min === 'number' && typeof w.max === 'number') return [w.min, w.max];
    if (typeof w.literal === 'number') return [w.literal, w.literal];
  }
  return fallback;
}

function findNode(nodes: FxNode[], cls: string): FxNode | undefined {
  return nodes.find((n) => n.class === cls);
}

/** The flattened, renderer-ready parameters of one drawable sprite layer: the
 *  knobs a CPU billboard sim consumes, derived from the descriptor's nodes with
 *  Source-sane fallbacks. One per sprite renderer (a system can have several). */
export interface SpriteSimParams {
  texture: string | null;
  additive: boolean;
  maxParticles: number;
  /** Particles spawned per second (ContinuousEmitter rate). */
  emitRate: number;
  /** Particle lifetime range in seconds. */
  lifetime: [number, number];
  /** Base world radius of a particle billboard. */
  radius: number;
  /** Base color, linear 0..1 RGB. */
  color: [number, number, number];
  /** Per-particle drift velocity magnitude (BasicMovement), world units/sec. */
  drift: number;
  /** Spin rate range, rad/sec (SpinUpdate). */
  spin: [number, number];
  /** Spawn jitter radius (CreateWithinSphere / PositionOffset), world units. */
  spawnRadius: number;
}

/** Builds the sprite-sim params for the system's first sprite renderer, or null
 *  when the system has no sprite renderer (a rope/model/child-only parent -- the
 *  caller should recurse into `children`). */
export function spriteParamsFor(d: FxDescriptor): SpriteSimParams | null {
  const renderer = d.renderers.find((r) => r.mode === 'sprite');
  if (!renderer) return null;

  // Prefer the "shape" texture (ring/flare/glow) over a noise/voronoi detail
  // mask: a sprite renderer often binds a noise lookup as textures[0] and the
  // actual visible shape second, so picking [0] renders cellular blobs.
  const texture =
    renderer.textures.find((t) => !/noise|voronoi|detail|mask/i.test(t)) ??
    renderer.textures[0] ??
    null;

  const max = typeof d.maxParticles === 'number' ? d.maxParticles : 64;
  const emitter = findNode(d.emitters, 'C_OP_ContinuousEmitter') ?? d.emitters[0];
  const emitRate = emitter ? paramScalar(emitter.params.m_flEmitRate, 20) : 20;

  // Lifetime: a Decay operator means "die at end of life"; the life length itself
  // is an InitFloat onto the lifetime field, else a believable default.
  const lifeInit = d.initializers.find(
    (n) => n.class === 'C_INIT_InitFloat' && paramScalar(n.params.m_nOutputField, -1) === 0
  );
  const lifetime: [number, number] = lifeInit
    ? paramRange(lifeInit.params.m_InputValue, [1, 1.5])
    : [1, 1.5];

  const radius = paramScalar(d.constantRadius, 15);

  const colorArr = Array.isArray(d.constantColor) ? d.constantColor : [255, 255, 255, 255];
  const color: [number, number, number] = [
    (colorArr[0] ?? 255) / 255,
    (colorArr[1] ?? 255) / 255,
    (colorArr[2] ?? 255) / 255,
  ];

  const movement = findNode(d.operators, 'C_OP_BasicMovement');
  const drift = movement ? Math.abs(paramScalar(movement.params.m_flSpeedMin, 4)) : 4;

  const spinOp = findNode(d.operators, 'C_OP_SpinUpdate');
  const spin: [number, number] = spinOp ? [-2, 2] : [0, 0];

  const sphere = findNode(d.initializers, 'C_INIT_CreateWithinSphereTransform');
  const spawnRadius = sphere ? paramScalar(sphere.params.m_fRadiusMax, radius) : radius;

  return {
    texture,
    additive: (renderer.blendMode ?? '').includes('ADD'),
    maxParticles: max,
    emitRate,
    lifetime,
    radius,
    color,
    drift,
    spin,
    spawnRadius,
  };
}

/** Every sprite layer reachable from a descriptor, walking children. The first
 *  visible slice renders these as additive billboard clusters. */
export function allSpriteLayers(d: FxDescriptor): SpriteSimParams[] {
  const layers: SpriteSimParams[] = [];
  const self = spriteParamsFor(d);
  if (self) layers.push(self);
  for (const child of d.children) layers.push(...allSpriteLayers(child));
  return layers;
}
