/** Read-only subset of Source 2 particle descriptors for the hero preview.
 * Authored sprite emitters, attributes and simple lifetime curves are supported.
 * Ropes, models, lights, sprite-sheet sequences and arbitrary operators are skipped. */
export function fxTexturePngName(vtexPath: string): string {
  return vtexPath.replace(/[^a-zA-Z0-9]/g, '_') + '.png';
}

export type FxParam = number | {
  pf?: string; literal?: number; min?: number; max?: number;
  in0?: number; in1?: number; out0?: number; out1?: number; cp?: number; curve?: unknown;
};
export interface FxNode { class: string; params: Record<string, unknown> }
export interface FxRenderer extends FxNode { mode: string; blendMode: string | null; textures: string[] }
export interface FxControlPoint { cp: number | null; attachType: string | null; attachment: string | null; entity: string | null }
export interface FxDescriptor {
  name: string; class?: string; maxParticles?: number; constantRadius?: FxParam;
  constantColor?: number[] | FxParam; controlPoints: FxControlPoint[];
  preview?: { model: string | null; sequence: string | null };
  emitters: FxNode[]; initializers: FxNode[]; operators: FxNode[];
  renderers: FxRenderer[]; children: FxDescriptor[];
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function paramRange(p: unknown, fallback: [number, number]): [number, number] {
  if (finite(p)) return [p, p];
  if (p && typeof p === 'object') {
    const w = p as Exclude<FxParam, number>;
    if (finite(w.literal)) return [w.literal, w.literal];
    if (finite(w.min) && finite(w.max)) return [Math.min(w.min, w.max), Math.max(w.min, w.max)];
  }
  return fallback;
}
export function paramScalar(p: unknown, fallback: number): number {
  const [lo, hi] = paramRange(p, [fallback, fallback]);
  return (lo + hi) / 2;
}
type Vec3 = [number, number, number];
const vector = (v: unknown, fallback: Vec3): Vec3 => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(finite)
  ? [v[0], v[1], v[2]] : fallback;
const boundedRange = (p: unknown, fallback: [number, number], lo: number, hi: number): [number, number] =>
  paramRange(p, fallback).map((v) => Math.max(lo, Math.min(hi, v))) as [number, number];
const color = (v: unknown, fallback: Vec3): Vec3 => {
  const c = vector(v, fallback);
  return c.map((x) => {
    const s = Math.min(255, Math.max(0, x)) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }) as Vec3;
};
const findNode = (nodes: FxNode[], cls: string) => nodes.find((n) => n.class === cls);
const fieldInit = (d: FxDescriptor, field: number) => d.initializers.find(
  (n) => n.class === 'C_INIT_InitFloat' && paramScalar(n.params.m_nOutputField, 0) === field
)?.params.m_InputValue;
export interface SpriteSimParams {
  attachment: string | null; texture: string | null; additive: boolean; maxParticles: number;
  emitRate: number; emitFirst: boolean; lifetime: [number, number]; radius: [number, number];
  colorMin: Vec3; colorMax: Vec3; colorFade: Vec3 | null;
  alpha: [number, number]; rotation: [number, number]; spin: [number, number];
  spawnRadius: number; offsetMin: Vec3; offsetMax: Vec3; gravity: Vec3; drag: number;
  follow: boolean; overbright: number; alphaCurve: unknown; radiusCurve: unknown;
}

/** Source particle attributes: radius=0, lifetime=1, roll=4, roll speed=5, alpha=7.
 * Omitted output fields mean radius, rather than position or lifetime. */
export function spriteParamsFor(d: FxDescriptor, renderer = d.renderers.find((r) => r.mode === 'sprite')): SpriteSimParams | null {
  if (!renderer) return null;
  const emitter = findNode(d.emitters, 'C_OP_ContinuousEmitter');
  const sphere = findNode(d.initializers, 'C_INIT_CreateWithinSphereTransform');
  const offset = findNode(d.initializers, 'C_INIT_PositionOffset');
  const movement = findNode(d.operators, 'C_OP_BasicMovement');
  const randomColor = findNode(d.initializers, 'C_INIT_RandomColor');
  const cp = (sphere?.params.m_TransformInput as { m_nControlPoint?: number } | undefined)?.m_nControlPoint;
  const curve = (field: number) => d.operators.find((n) => n.class === 'C_OP_SetFloat'
    && paramScalar(n.params.m_nOutputField, 0) === field
    && n.params.m_nSetMethod === 'PARTICLE_SET_SCALE_INITIAL_VALUE')?.params.m_InputValue;
  const radians = (p: unknown): [number, number] => boundedRange(p, [0, 0], -3600, 3600)
    .map((v) => v * Math.PI / 180) as [number, number];
  return {
    attachment: d.controlPoints.find((point) => point.cp === cp && point.attachment)?.attachment
      ?? d.controlPoints.find((point) => point.attachment)?.attachment ?? null,
    texture: renderer.textures.find((t) => !/noise|voronoi|detail|mask/i.test(t)) ?? renderer.textures[0] ?? null,
    additive: (renderer.blendMode ?? '').includes('ADD'),
    maxParticles: Math.floor(Math.max(1, Math.min(256, paramScalar(d.maxParticles, 64)))),
    emitRate: emitter ? Math.max(0, Math.min(256, paramScalar(emitter.params.m_flEmitRate, 0))) : 0,
    emitFirst: emitter?.params.m_bForceEmitOnFirstUpdate === true,
    lifetime: boundedRange(fieldInit(d, 1), [1, 1], 0.01, 30),
    radius: boundedRange(fieldInit(d, 0) ?? d.constantRadius, [1, 1], 0, 128),
    colorMin: color(randomColor?.params.m_ColorMin ?? d.constantColor, [255, 255, 255]),
    colorMax: color(randomColor?.params.m_ColorMax ?? d.constantColor, [255, 255, 255]),
    colorFade: findNode(d.operators, 'C_OP_ColorInterpolate')
      ? color(findNode(d.operators, 'C_OP_ColorInterpolate')!.params.m_ColorFade, [255, 255, 255]) : null,
    alpha: boundedRange(fieldInit(d, 7), [1, 1], 0, 1),
    rotation: radians(fieldInit(d, 4)),
    spin: findNode(d.operators, 'C_OP_SpinUpdate') ? radians(fieldInit(d, 5)) : [0, 0],
    spawnRadius: Math.max(0, Math.min(128, paramScalar(sphere?.params.m_fRadiusMax, 0))),
    offsetMin: vector(offset?.params.m_OffsetMin, [0, 0, 0]),
    offsetMax: vector(offset?.params.m_OffsetMax, [0, 0, 0]),
    gravity: vector(movement?.params.m_Gravity, [0, 0, 0]),
    drag: Math.max(0, Math.min(10, paramScalar(movement?.params.m_fDrag, 0))),
    follow: !!findNode(d.operators, 'C_OP_PositionLock'),
    overbright: Math.max(0, Math.min(10, paramScalar(renderer.params.m_flOverbrightFactor, 1))),
    alphaCurve: curve(7), radiusCurve: curve(0),
  };
}

/** Cubic interpolation uses the slopes authored in Source's normalized-age curves. */
export function ageCurveValue(input: unknown, age: number, fallback = 1): number {
  if (!input || typeof input !== 'object') return fallback;
  const param = input as Exclude<FxParam, number>;
  if (param.pf !== 'PF_TYPE_PARTICLE_AGE_NORMALIZED') return fallback;
  const points = (param.curve as { m_spline?: Array<{ x: number; y: number; m_flSlopeOutgoing?: number; m_flSlopeIncoming?: number }> } | undefined)?.m_spline;
  if (!points?.length || !points.every((p) => finite(p.x) && finite(p.y))) return fallback;
  if (age <= points[0].x) return points[0].y;
  for (let i = 1; i < points.length; i++) {
    const b = points[i], a = points[i - 1];
    if (age > b.x) continue;
    const width = b.x - a.x;
    if (width <= 0) return b.y;
    const t = (age - a.x) / width;
    const slope = (b.y - a.y) / width;
    const ma = finite(a.m_flSlopeOutgoing) ? a.m_flSlopeOutgoing : slope;
    const mb = finite(b.m_flSlopeIncoming) ? b.m_flSlopeIncoming : slope;
    return (2*t*t*t - 3*t*t + 1)*a.y + (t*t*t - 2*t*t + t)*width*ma
      + (-2*t*t*t + 3*t*t)*b.y + (t*t*t - t*t)*width*mb;
  }
  return points[points.length - 1].y;
}

/** Total budgets apply across children, rather than multiplying per system. */
export function allSpriteLayers(d: FxDescriptor): SpriteSimParams[] {
  const layers: SpriteSimParams[] = [];
  let remaining = 512;
  const visit = (system: FxDescriptor, depth: number) => {
    if (depth > 4 || layers.length >= 16 || remaining <= 0) return;
    for (const renderer of system.renderers) {
      if (renderer.mode !== 'sprite' || layers.length >= 16 || remaining <= 0) continue;
      const layer = spriteParamsFor(system, renderer)!;
      layer.maxParticles = Math.min(remaining, layer.maxParticles);
      remaining -= layer.maxParticles;
      layers.push(layer);
    }
    for (const child of system.children) visit(child, depth + 1);
  };
  visit(d, 0);
  return layers;
}
