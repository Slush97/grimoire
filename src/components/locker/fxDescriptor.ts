/** Read-only subset of Source 2 particle descriptors for the hero preview.
 * Authored sprite emitters, attributes and simple lifetime curves are supported.
 * Single-frame sheet sequences are supported; animated sheets, ropes, models,
 * lights and arbitrary operators remain outside this bounded preview. */
import type { ModelAttachment } from '../../types/modelAttachment';

export function fxTexturePngName(vtexPath: string): string {
  return vtexPath.replace(/[^a-zA-Z0-9]/g, '_') + '.png';
}

export type FxParam = number | {
  pf?: string; literal?: number; min?: number; max?: number;
  in0?: number; in1?: number; out0?: number; out1?: number; cp?: number; field?: number; map?: string; mult?: number; curve?: unknown; bias?: number; biasType?: string;
};
export interface FxNode { class: string; params: Record<string, unknown> }
export interface FxRenderer extends FxNode { mode: string; blendMode: string | null; textures: string[] }
export interface FxControlPoint { cp: number | null; attachType: string | null; attachment: string | null; entity: string | null }
export interface FxSheet { sequences: Array<{ id: number; clamp: boolean; uv: [number, number, number, number] }> }
export interface FxDescriptor {
  snapshot?: { points: Array<{ position: [number, number, number]; joints: string[]; weights: number[] }> };
  scale?: number; sheets?: Record<string, FxSheet>; startDelay?: number; attachments?: ModelAttachment[];
  /** Preview-only scalar CP inputs; supplied runtime components remain authoritative. */
  previewControlPointComponents?: Record<number, number>; controlPointComponents?: Record<number, number>;
  name: string; class?: string; maxParticles?: number; constantRadius?: FxParam; constantLifespan?: FxParam;
  constantAlpha?: FxParam; constantColor?: number[] | FxParam; controlPoints: FxControlPoint[];
  preview?: { model: string | null; sequence: string | null };
  emitters: FxNode[]; initializers: FxNode[]; operators: FxNode[];
  preEmissionOperators?: FxNode[]; forces?: FxNode[]; constraints?: FxNode[];
  renderers: FxRenderer[]; children: FxDescriptor[];
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function paramRange(p: unknown, fallback: [number, number]): [number, number] {
  if (finite(p)) return [p, p];
  if (p && typeof p === 'object') {
    const w = p as Exclude<FxParam, number>;
    if (finite(w.literal)) return [w.literal, w.literal];
    if (w.pf && !['PF_TYPE_LITERAL', 'PF_TYPE_RANDOM_UNIFORM', 'PF_TYPE_RANDOM_BIASED'].includes(w.pf)) return fallback;
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
  ? v.slice(0, 3).map((n: number) => Math.max(-4096, Math.min(4096, n))) as Vec3 : fallback;
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
const fieldInit = (d: FxDescriptor, field: number) => {
  const node = d.initializers.filter((n) => n.class === 'C_INIT_InitFloat' && paramScalar(n.params.m_nOutputField, 3) === field).at(-1);
  return node ? node.params.m_InputValue ?? 0 : undefined;
};
export interface SpriteSimParams {
  snapshot?: { points: NonNullable<FxDescriptor['snapshot']>['points']; random: boolean };
  systemId?: string; parentSystemId?: string; publishesSpawnEvents?: boolean;
  parentSpawnEvents?: boolean; spawnAtParent?: boolean;
  parentSpawnWindow?: { start: number; duration: number; perFrame: number };
  ring: { radius: [number, number]; thickness: [number, number] } | null;
  normal: { axis: Vec3; angle: number; normalize: boolean } | null;
  normalRotation: { axisMin: Vec3; axisMax: Vec3; rate: [number, number] } | null;
  alignNormal: boolean; spinRate: number; alphaScale: number; alphaOnly: boolean; colorInitializers: FxNode[];
  scale: number; sheet: FxSheet | undefined; sequence: [number, number]; persistent: boolean; radiusInput: unknown; radiusScale: number;
  spawnBias: Vec3; offsets: Array<{ min: Vec3; max: Vec3; local: boolean; proportional: boolean }>;
  attachment: string | null; texture: string | null; additive: boolean; maxParticles: number;
  attachments?: ModelAttachment[]; spritecard?: FxRenderer;
  emitRate: number; emitFirst: boolean; lifetime: [number, number]; radius: [number, number];
  colorMin: Vec3; colorMax: Vec3; colorFade: Vec3 | null; colorFadeTime: [number, number]; colorEase: boolean;
  colorGradient: unknown;
  alpha: [number, number]; rotation: [number, number]; spin: [number, number];
  spawnRadius: number; spawnRadiusMin: number; spawnLocal: boolean; speed: [number, number];
  spawnBox: { min: Vec3; max: Vec3 } | null;
  localSpeedMin: Vec3; localSpeedMax: Vec3; offsetLocal: boolean; offsetProportional: boolean;
  offsetMin: Vec3; offsetMax: Vec3; gravity: Vec3; drag: number;
  follow: boolean; followRotation: boolean; movement: boolean; overbright: number; alphaCurve: unknown; radiusCurve: unknown;
  emissions: SpriteEmission[]; fade: SpriteFade | null;
  orbit: { axis: Vec3; rate: number; local: boolean } | null;
  oscillation: { rateMin: Vec3; rateMax: Vec3; frequencyMin: Vec3; frequencyMax: Vec3;
    start: [number, number]; end: [number, number]; multiplier: number; offset: number; scale: number; proportional: boolean } | null;
}
export interface SpriteEmission {
  kind: 'continuous' | 'burst'; start: number; duration: number; rate: number;
  count: [number, number]; perFrame: number; first: boolean;
}
export interface SpriteFade { fadeIn: [number, number]; fadeOut: [number, number]; startAlpha: number; endAlpha: number }

/** Source particle attributes: position=0, lifetime=1, radius=3, roll=4, roll speed=5, alpha=7.
 * Omitted output fields mean radius, rather than position or lifetime. */
export function spriteParamsFor(d: FxDescriptor, renderer = d.renderers.find((r) => r.mode === 'sprite')): SpriteSimParams | null {
  if (!renderer) return null;
  // Model hitbox spawning needs authored hitboxes and their animated transforms.
  // Falling back to the origin creates a large detached glow, not an ambient effect.
  if (findNode(d.initializers, 'C_INIT_CreateOnModel')) return null;
  // Spawn-event children need the parent's particle positions and event clock.
  // Treating them as independent continuous systems invents detached glows.
  const parentEmitters = d.emitters.filter((node) => node.params.m_bInitFromKilledParentParticles === true);
  // Support only authored spawn events. Death/collision events need additional
  // simulation data; they must never become independent continuous emission.
  if (parentEmitters.some((node) => node.class !== 'C_OP_ContinuousEmitter'
    || node.params.m_nEventType !== 'PARTICLE_EVENT_TYPE_MASK_SPAWNED')) return null;
  if (parentEmitters.length && (parentEmitters.length !== 1 || d.emitters.length !== 1)) return null;
  const snapshotInit = findNode(d.initializers, 'C_INIT_InitSkinnedPositionFromCPSnapshot');
  const skinSnapshot = !!snapshotInit && !!findNode(d.operators, 'C_OP_SnapshotRigidSkinToBones');
  if (skinSnapshot && !d.snapshot?.points.length) return null;
  const emitter = findNode(d.emitters, 'C_OP_ContinuousEmitter');
  const sphere = findNode(d.initializers, 'C_INIT_CreateWithinSphereTransform') ?? findNode(d.initializers, 'C_INIT_CreateWithinSphere');
  const box = findNode(d.initializers, 'C_INIT_CreateWithinBox');
  if (box && [box.params.m_vecMin, box.params.m_vecMax].some((v) =>
    v !== undefined && (!Array.isArray(v) || v.length < 3 || !v.slice(0, 3).every(finite)))) return null;
  const offset = findNode(d.initializers, 'C_INIT_PositionOffset');
  const movement = findNode(d.operators, 'C_OP_BasicMovement');
  const randomColor = findNode(d.initializers, 'C_INIT_RandomColor');
  const colorOp = findNode(d.operators, 'C_OP_ColorInterpolate');
  const fade = findNode(d.operators, 'C_OP_FadeAndKill');
  const orbit = findNode(d.operators, 'C_OP_MovementRotateParticleAroundAxis');
  const sequence = findNode(d.initializers, 'C_INIT_RandomSequence');
  const ring = findNode(d.initializers, 'C_INIT_RingWave');
  const normal = d.initializers.find((n) => n.class === 'C_INIT_RemapInitialDirectionToTransformToVector' && paramScalar(n.params.m_nFieldOutput, 0) === 21);
  const normalRotation = d.operators.find((n) => n.class === 'C_OP_RotateVector' && paramScalar(n.params.m_nField, 21) === 21);
  const oscillate = d.operators.find((n) => n.class === 'C_OP_OscillateVector'
    && paramScalar(n.params.m_nField, 0) === 0 && n.params.m_bOffset !== true
    && n.params.m_bProportional !== false && n.params.m_bProportionalOp !== false);
  const setColor = d.operators.find((n) => n.class === 'C_OP_SetVec' && paramScalar(n.params.m_nOutputField, 6) === 6
    && (!n.params.m_nSetMethod || n.params.m_nSetMethod === 'PARTICLE_SET_REPLACE_VALUE')
    && paramScalar(n.params.m_Lerp, 1) === 1 && n.params.m_bNormalizedOutput !== true);
  const texture = renderer.textures.find((t) => !/noise|voronoi|detail|mask/i.test(t)) ?? renderer.textures[0] ?? null;
  const scalar = (v: unknown, fallback: number, max = 30) => Math.max(0, Math.min(max, paramScalar(v, fallback)));
  const emissionRate = (v: unknown) => v === undefined ? 100 : scalar(v, 0, 256);
  const cp = box ? paramScalar(box.params.m_nControlPointNumber, 0)
    : (sphere?.params.m_TransformInput as { m_nControlPoint?: number } | undefined)?.m_nControlPoint;
  const curve = (field: number) => d.operators.find((n) => n.class === 'C_OP_SetFloat'
    && paramScalar(n.params.m_nOutputField, 3) === field
    && n.params.m_nSetMethod === 'PARTICLE_SET_SCALE_INITIAL_VALUE')?.params.m_InputValue;
  const radians = (p: unknown): [number, number] => boundedRange(p, [0, 0], -3600, 3600)
    .map((v) => v * Math.PI / 180) as [number, number];
  return {
    snapshot: skinSnapshot && d.snapshot ? { points: d.snapshot.points, random: snapshotInit?.params.m_bRandom === true } : undefined,
    parentSpawnEvents: parentEmitters.length > 0,
    parentSpawnWindow: parentEmitters.length ? {
      start: scalar(parentEmitters[0].params.m_flStartTime, 0),
      duration: scalar(parentEmitters[0].params.m_flEmissionDuration, 0),
      perFrame: paramScalar(parentEmitters[0].params.m_nMaxEmittedPerFrame, -1) < 0 ? 256
        : Math.floor(scalar(parentEmitters[0].params.m_nMaxEmittedPerFrame, 256, 256)),
    } : undefined,
    spawnAtParent: !sphere && !box,
    ring: ring ? { radius: boundedRange(ring.params.m_flInitialRadius, [0, 0], 0, 4096), thickness: boundedRange(ring.params.m_flThickness, [0, 0], 0, 4096) } : null,
    normal: normal ? { axis: vector(normal.params.m_vecOffsetAxis, [0, 0, 1]), angle: paramScalar(normal.params.m_flOffsetRot, 0)*Math.PI/180, normalize: normal.params.m_bNormalize === true } : null,
    normalRotation: normalRotation ? { axisMin: vector(normalRotation.params.m_vecRotAxisMin, [0, 0, 0]), axisMax: vector(normalRotation.params.m_vecRotAxisMax, [0, 0, 0]), rate: [paramScalar(normalRotation.params.m_flRotRateMin, 180), paramScalar(normalRotation.params.m_flRotRateMax, 180)].map((v) => Math.max(-3600, Math.min(3600, v))*Math.PI/180) as [number, number] } : null,
    alignNormal: renderer.params.m_nOrientationType === 'PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL',
    spinRate: paramScalar(findNode(d.operators, 'C_OP_Spin')?.params.m_nSpinRateDegrees, 0)*Math.PI/180,
    alphaScale: Math.max(0, Math.min(1, paramScalar(renderer.params.m_flAlphaScale, 1))),
    alphaOnly: Array.isArray(renderer.params.m_vecTexturesInput) && renderer.params.m_vecTexturesInput.some((row) => row?.m_hTexture === texture && row?.m_nTextureChannels === 'SPRITECARD_TEXTURE_CHANNEL_MIX_A'),
    colorInitializers: d.initializers.filter((n) => n.class === 'C_INIT_SetAttributeToScalarExpression' || n.class === 'C_INIT_InitVec').slice(0, 32),
    spritecard: renderer, scale: 1, sheet: texture ? d.sheets?.[texture] : undefined,
    spawnBias: vector(sphere?.params.m_vecDistanceBias, [1, 1, 1]),
    offsets: d.initializers.filter((n) => n.class === 'C_INIT_PositionOffset').slice(0, 16).map((n) => ({
      min: vector(n.params.m_OffsetMin, [0, 0, 0]), max: vector(n.params.m_OffsetMax, [0, 0, 0]),
      local: n.params.m_bLocalCoords === true, proportional: n.params.m_bProportional === true,
    })),
    sequence: [sequence?.params.m_nSequenceMin ?? 0, sequence?.params.m_nSequenceMax ?? 0]
      .map((v) => Math.floor(Math.max(0, Math.min(255, paramScalar(v, 0))))) as [number, number],
    persistent: d.operators.some((n) => n.class === 'C_OP_Decay' && n.params.m_nOpEndCapState === 'PARTICLE_ENDCAP_ENDCAP_ON')
      && !d.operators.some((n) => n.class === 'C_OP_Decay' && n.params.m_nOpEndCapState !== 'PARTICLE_ENDCAP_ENDCAP_ON'),
    radiusInput: fieldInit(d, 3), radiusScale: Math.max(0, Math.min(16, paramScalar(renderer.params.m_flRadiusScale, 1))),
    attachment: d.controlPoints.find((point) => point.cp === cp && point.attachment)?.attachment
      ?? d.controlPoints.find((point) => point.attachment)?.attachment ?? null,
    texture,
    additive: (renderer.blendMode ?? '').includes('ADD'),
    maxParticles: Math.floor(Math.max(1, Math.min(256, paramScalar(d.maxParticles, 64)))),
    emitRate: emitter ? emissionRate(emitter.params.m_flEmitRate) : 0,
    emitFirst: emitter?.params.m_bForceEmitOnFirstUpdate === true,
    lifetime: boundedRange(fieldInit(d, 1) ?? d.constantLifespan, [1, 1], 0.01, 30),
    radius: boundedRange(fieldInit(d, 3) ?? d.constantRadius, [5, 5], 0, 128),
    colorMin: color(randomColor?.params.m_ColorMin ?? d.constantColor, [255, 255, 255]),
    colorMax: color(randomColor?.params.m_ColorMax ?? d.constantColor, [255, 255, 255]),
    colorFade: colorOp ? color(colorOp.params.m_ColorFade, [255, 255, 255]) : null,
    colorFadeTime: [scalar(colorOp?.params.m_flFadeStartTime, 0), scalar(colorOp?.params.m_flFadeEndTime, 1)],
    colorEase: colorOp?.params.m_bEaseInOut !== false,
    colorGradient: setColor?.params.m_InputValue,
    alpha: boundedRange(fieldInit(d, 7), [1, 1], 0, 1),
    rotation: radians(fieldInit(d, 4)),
    spin: findNode(d.operators, 'C_OP_SpinUpdate') ? radians(fieldInit(d, 5)) : [0, 0],
    spawnRadius: Math.max(0, Math.min(128, paramScalar(sphere?.params.m_fRadiusMax, 0))),
    spawnRadiusMin: Math.max(0, Math.min(128, paramScalar(sphere?.params.m_fRadiusMin, 0))),
    spawnLocal: box ? box.params.m_bLocalSpace === true : sphere?.params.m_bLocalCoords === true,
    spawnBox: box ? { min: vector(box.params.m_vecMin, [0, 0, 0]), max: vector(box.params.m_vecMax, [0, 0, 0]) } : null,
    speed: [sphere?.params.m_fSpeedMin, sphere?.params.m_fSpeedMax].map((v) => Math.max(-1024, Math.min(1024, paramScalar(v, 0)))) as [number, number],
    localSpeedMin: vector(sphere?.params.m_LocalCoordinateSystemSpeedMin, [0, 0, 0]),
    localSpeedMax: vector(sphere?.params.m_LocalCoordinateSystemSpeedMax, [0, 0, 0]),
    offsetLocal: offset?.params.m_bLocalCoords === true,
    offsetProportional: offset?.params.m_bProportional === true,
    offsetMin: vector(offset?.params.m_OffsetMin, [0, 0, 0]),
    offsetMax: vector(offset?.params.m_OffsetMax, [0, 0, 0]),
    gravity: vector(movement?.params.m_Gravity, [0, 0, 0]),
    drag: Math.max(0, Math.min(0.9999999, paramScalar(movement?.params.m_fDrag, 0))),
    follow: !!findNode(d.operators, 'C_OP_PositionLock'),
    followRotation: findNode(d.operators, 'C_OP_PositionLock')?.params.m_bLockRot === true,
    movement: !!movement,
    overbright: Math.max(0, Math.min(10, paramScalar(renderer.params.m_flOverbrightFactor, 1))),
    alphaCurve: curve(7), radiusCurve: curve(3),
    emissions: d.emitters.slice(0, 16).filter((n) => ['C_OP_ContinuousEmitter', 'C_OP_InstantaneousEmitter'].includes(n.class)
      && n.params.m_bInitFromKilledParentParticles !== true).map((n) => ({
      kind: n.class === 'C_OP_ContinuousEmitter' ? 'continuous' : 'burst',
      start: scalar(n.params.m_flStartTime, 0), duration: scalar(n.params.m_flEmissionDuration, 0),
      rate: emissionRate(n.params.m_flEmitRate), count: boundedRange(n.params.m_nParticlesToEmit, [100, 100], 0, 256),
      perFrame: paramScalar(n.params.m_nMaxEmittedPerFrame, -1) < 0 ? 256 : Math.floor(scalar(n.params.m_nMaxEmittedPerFrame, 256, 256)),
      first: n.params.m_bForceEmitOnFirstUpdate === true,
    })),
    fade: fade ? {
      fadeIn: [scalar(fade.params.m_flStartFadeInTime, 0), scalar(fade.params.m_flEndFadeInTime, 0.5)],
      fadeOut: [scalar(fade.params.m_flStartFadeOutTime, 0.5), scalar(fade.params.m_flEndFadeOutTime, 1)],
      startAlpha: scalar(fade.params.m_flStartAlpha, 1, 1), endAlpha: scalar(fade.params.m_flEndAlpha, 0, 1),
    } : null,
    orbit: orbit ? {
      axis: vector(orbit.params.m_vecRotAxis, [0, 0, 1]),
      rate: Math.max(-3600, Math.min(3600, paramScalar(orbit.params.m_flRotRate, 180)))*Math.PI/180,
      local: orbit.params.m_bLocalSpace === true,
    } : null,
    oscillation: oscillate ? {
      rateMin: vector(oscillate.params.m_RateMin, [0, 0, 0]), rateMax: vector(oscillate.params.m_RateMax, [0, 0, 0]),
      frequencyMin: vector(oscillate.params.m_FrequencyMin, [1, 1, 1]), frequencyMax: vector(oscillate.params.m_FrequencyMax, [1, 1, 1]),
      start: [paramScalar(oscillate.params.m_flStartTime_min, 0), paramScalar(oscillate.params.m_flStartTime_max, 0)],
      end: [paramScalar(oscillate.params.m_flEndTime_min, 1), paramScalar(oscillate.params.m_flEndTime_max, 1)],
      multiplier: paramScalar(oscillate.params.m_flOscMult, 2), offset: paramScalar(oscillate.params.m_flOscAdd, 0.5),
      scale: paramScalar(oscillate.params.m_flRateScale, 1), proportional: oscillate.params.m_bProportional !== false,
    } : null,
  };
}

/** Emitter state and births are globally bounded by the layer's pool. Full pools
 * discard continuous emission debt instead of causing a burst when a slot frees. */
export interface SpriteEmissionState { charge: number; started: boolean; remaining: number }
export function advanceSpriteEmission(emissions: SpriteEmission[], states: SpriteEmissionState[], from: number, to: number, capacity: number, random = Math.random): number[] {
  const ages: number[] = [];
  for (let i = 0; i < emissions.length; i++) {
    const e = emissions[i];
    const state = states[i] ??= { charge: 0, started: false, remaining: 0 };
    if (to < e.start) continue;
    if (e.kind === 'burst') {
      if (!state.started) {
        state.remaining = Math.floor(e.count[0] + (e.count[1] - e.count[0])*random());
        state.started = true;
      }
      const count = Math.min(state.remaining, e.perFrame);
      state.remaining -= count;
      for (let n = 0; n < count && ages.length < capacity; n++) ages.push(Math.max(0, to - e.start));
      continue;
    }
    const end = e.duration > 0 ? e.start + e.duration : Infinity;
    const start = Math.max(from, e.start), stop = Math.min(to, end);
    const dt = Math.max(0, stop - start);
    if (!state.started) { state.charge = e.first ? 1 : 0; state.started = true; }
    const previousCharge = state.charge;
    state.charge += dt * e.rate;
    const count = Math.floor(state.charge + 1e-8);
    state.charge -= count;
    for (let n = 0; n < count && ages.length < capacity; n++) {
      const born = e.rate > 0 ? Math.max(start, start + (n + 1 - previousCharge)/e.rate) : start;
      ages.push(Math.max(0, to - born));
    }
  }
  return ages;
}

export function normalizedWindow(age: number, range: [number, number], ease = false): number {
  const t = range[1] <= range[0] ? Number(age >= range[1]) : Math.max(0, Math.min(1, (age-range[0])/(range[1]-range[0])));
  return ease ? t*t*(3-2*t) : t;
}
export function spriteFadeValue(fade: SpriteFade | null, age: number): number {
  if (!fade) return 1;
  return (fade.startAlpha + (1-fade.startAlpha)*normalizedWindow(age, fade.fadeIn, true))
    * (1 + (fade.endAlpha-1)*normalizedWindow(age, fade.fadeOut, true));
}

/** Authored color-gradient stops are linear color bytes, unlike texture pixels.
 * This subset evaluates only normalized particle age and literal gradients. */
export function spriteGradientColor(input: unknown, age: number, scalarField?: number): Vec3 | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  if (r.m_nType !== 'PVEC_TYPE_FLOAT_INTERP_GRADIENT'
    || !((r.m_FloatInterp as { pf?: string } | undefined)?.pf === 'PF_TYPE_PARTICLE_AGE_NORMALIZED'
      || (scalarField !== undefined && (r.m_FloatInterp as { pf?: string } | undefined)?.pf === 'PF_TYPE_PARTICLE_FLOAT'))) return null;
  const raw = (r.m_Gradient as { m_Stops?: unknown[] } | undefined)?.m_Stops;
  if (!Array.isArray(raw) || !raw.length || raw.length > 32) return null;
  const stops = raw.map((v) => v as { m_flPosition?: number; m_Color?: number[] });
  if (stops.some((s) => !finite(s?.m_flPosition) || !Array.isArray(s.m_Color) || s.m_Color.length < 3 || !s.m_Color.slice(0, 3).every(finite))) return null;
  const sorted = [...stops].sort((a, b) => a.m_flPosition! - b.m_flPosition!);
  const t = normalizedWindow(scalarField ?? age, [paramScalar(r.m_flInterpInput0, 0), paramScalar(r.m_flInterpInput1, 1)]);
  const next = sorted.findIndex((s) => s.m_flPosition! >= t);
  const b = sorted[next < 0 ? sorted.length - 1 : next];
  const a = sorted[Math.max(0, next < 0 ? sorted.length - 1 : next - 1)];
  const mix = normalizedWindow(t, [a.m_flPosition!, b.m_flPosition!]);
  return [0, 1, 2].map((i) => Math.max(0, Math.min(255, a.m_Color![i] + (b.m_Color![i] - a.m_Color![i]) * mix)) / 255) as Vec3;
}

/** Ordered scalar scratch values and replacement colors. Later replacement
 * writes supersede earlier unsupported color expressions, never vice versa. */
export function spriteInitialColor(nodes: FxNode[], particleNumber: number): Vec3 | null {
  const fields = new Map<number, number>();
  let result: Vec3 | null = null;
  for (const node of nodes) {
    const p = node.params;
    if (node.class === 'C_INIT_SetAttributeToScalarExpression') {
      const input = p.m_flInput1 as { pf?: string } | undefined;
      const divisor = paramScalar(p.m_flInput2, 0);
      if (p.m_nExpression === 'SCALAR_EXPRESSION_MOD' && input?.pf === 'PF_TYPE_PARTICLE_NUMBER' && divisor > 0) {
        fields.set(paramScalar(p.m_nOutputField, 0), particleNumber % divisor);
      }
    }
    if (node.class !== 'C_INIT_InitVec' || paramScalar(p.m_nOutputField, 6) !== 6
      || (p.m_nSetMethod && p.m_nSetMethod !== 'PARTICLE_SET_REPLACE_VALUE')) continue;
    const input = p.m_InputValue as Record<string, unknown> | undefined;
    const interp = input?.m_FloatInterp as { field?: number } | undefined;
    const gradient = spriteGradientColor(input, 0, fields.get(interp?.field ?? -1));
    result = input?.m_nType === 'PVEC_TYPE_LITERAL_COLOR'
      ? vector(input.m_LiteralColor, [0, 0, 0]).map((v) => Math.max(0, Math.min(255, v))/255) as Vec3
      : gradient;
  }
  return result;
}

/** Source builds this matrix without normalizing its axis. */
export function remapSpriteNormal(delta: Vec3, axis: Vec3, angle: number, normalize: boolean): Vec3 {
  const [x, y, z] = axis, [a, b, d] = delta, c = Math.cos(angle), s = Math.sin(angle), r = 1-c;
  const result: Vec3 = [
    ((1-x*x)*c+x*x)*a + (x*y*r-z*s)*b + (x*z*r+y*s)*d,
    (y*x*r+z*s)*a + ((1-y*y)*c+y*y)*b + (y*z*r-x*s)*d,
    (x*z*r-y*s)*a + (y*z*r+x*s)*b + ((1-z*z)*c+z*z)*d,
  ];
  if (normalize) {
    result[2] += 1.1920929e-7;
    const length = Math.hypot(...result);
    if (length > 0) return result.map((v) => v/length) as Vec3;
  }
  return result;
}

export interface FxPreviewIssue { system: string; class: string; reason: string }
/** Diagnostic data stays separate from copy. Callers can show a concise partial
 * support notice without claiming unimplemented operators are game-equivalent. */
export function fxPreviewIssues(root: FxDescriptor): FxPreviewIssue[] {
  const supported = new Set([
    'C_OP_ContinuousEmitter', 'C_OP_InstantaneousEmitter', 'C_INIT_InitFloat', 'C_INIT_RandomSequence',
    'C_INIT_CreateWithinSphere', 'C_INIT_CreateWithinSphereTransform', 'C_INIT_CreateWithinBox', 'C_INIT_PositionOffset',
    'C_INIT_RandomColor', 'C_OP_BasicMovement', 'C_OP_PositionLock', 'C_OP_SpinUpdate',
    'C_OP_ColorInterpolate', 'C_OP_SetFloat', 'C_OP_SetVec', 'C_OP_OscillateVector', 'C_OP_Decay', 'C_OP_FadeAndKill', 'C_OP_RenderSprites', 'C_OP_MovementRotateParticleAroundAxis',
  ]);
  const issues: FxPreviewIssue[] = [];
  let visited = 0;
  const visit = (d: FxDescriptor, depth: number) => {
    if (++visited > 32 || depth > 4) {
      if (issues.length < 128) issues.push({ system: d.name, class: '', reason: 'graph-budget' });
      return;
    }
    const report = (cls: string, reason: string) => {
      if (issues.length < 128 && !issues.some((i) => i.system === d.name && i.class === cls && i.reason === reason)) {
        issues.push({ system: d.name, class: cls, reason });
      }
    };
    for (const cp of d.controlPoints.slice(0, 128)) {
      if (cp.entity && cp.entity !== 'self') report('control-point', 'unsupported-control-point-entity');
    }
    for (const n of [...d.emitters, ...d.initializers, ...d.operators, ...d.renderers]) {
      if (!supported.has(n.class)) { report(n.class, 'unsupported-class'); continue; }
      if (n.class === 'C_OP_SetFloat' && (n.params.m_nSetMethod !== 'PARTICLE_SET_SCALE_INITIAL_VALUE'
        || ![3, 7].includes(paramScalar(n.params.m_nOutputField, 3)))) report(n.class, 'unsupported-field-or-method');
      if (n.class === 'C_OP_SetVec' && (paramScalar(n.params.m_nOutputField, 6) !== 6
        || (n.params.m_nSetMethod && n.params.m_nSetMethod !== 'PARTICLE_SET_REPLACE_VALUE')
        || paramScalar(n.params.m_Lerp, 1) !== 1 || n.params.m_bNormalizedOutput === true
        || !spriteGradientColor(n.params.m_InputValue, 0))) report(n.class, 'unsupported-field-or-method');
      if (n.class === 'C_OP_OscillateVector' && (paramScalar(n.params.m_nField, 0) !== 0
        || n.params.m_bOffset === true || n.params.m_bProportional === false || n.params.m_bProportionalOp === false)) report(n.class, 'unsupported-field-or-method');
      if (n.class === 'C_INIT_InitFloat' && ![3, 1, 4, 5, 7].includes(paramScalar(n.params.m_nOutputField, 3))) report(n.class, 'unsupported-field');
      if (n.class === 'C_INIT_InitFloat' && ((n.params.m_nSetMethod && n.params.m_nSetMethod !== 'PARTICLE_SET_REPLACE_VALUE')
        || paramScalar(n.params.m_InputStrength, 1) !== 1)) report(n.class, 'unsupported-field-or-method');
      if (n.class === 'C_OP_PositionLock' && (['m_flStartTime_min', 'm_flStartTime_max', 'm_flEndTime_min', 'm_flEndTime_max']
        .some((key) => paramScalar(n.params[key], 1) !== 1) || paramScalar(n.params.m_flRange, 0) !== 0
        || vector(n.params.m_vecScale, [1, 1, 1]).some((v) => v !== 1))) report(n.class, 'unsupported-lock-fade-or-scale');
      if (n.class.includes('CreateWithinSphere') && (vector(n.params.m_vecDistanceBiasAbs, [0, 0, 0]).some((v) => v !== 0)
        || paramScalar(n.params.m_fSpeedRandExp, 1) !== 1 || paramScalar(n.params.m_nScaleCP, -1) >= 0)) report(n.class, 'unsupported-sphere-bias');
      if (n.class === 'C_OP_ColorInterpolate' && paramScalar(n.params.m_nFieldOutput, 6) !== 6) report(n.class, 'unsupported-field');
      if (n.class === 'C_OP_RenderSprites' && (paramScalar(n.params.m_nOrientationType, 0) !== 0
        || (paramScalar(n.params.m_flAnimationRate, 0) !== 0 && !d.sheets?.[(n as FxRenderer).textures[0]]?.sequences.length))) report(n.class, 'unsupported-sprite-orientation-or-animation');
      if (n.class.includes('Emitter') && (n.params.m_bInitFromKilledParentParticles === true || paramScalar(n.params.m_nSnapshotControlPoint, -1) >= 0
        || paramScalar(n.params.m_flParentParticleScale, -1) !== -1
        || paramScalar(n.params.m_flInitFromKilledParentParticles, 0) !== 0)) report(n.class, 'unsupported-parent-or-snapshot-emission');
      const checkParam = (value: unknown, depth = 0) => {
        if (!value || typeof value !== 'object' || depth > 8) return;
        const r = value as Record<string, unknown>;
        if (typeof r.pf === 'string' && !['PF_TYPE_LITERAL', 'PF_TYPE_RANDOM_UNIFORM', 'PF_TYPE_RANDOM_BIASED', 'PF_TYPE_PARTICLE_AGE_NORMALIZED'].includes(r.pf)) report(n.class, 'unsupported-input');
        if (typeof r.m_nType === 'string' && r.m_nType.startsWith('PVEC_') && r.m_nType !== 'PVEC_TYPE_LITERAL'
          && !(n.class === 'C_OP_SetVec' && spriteGradientColor(r, 0))) report(n.class, 'unsupported-vector-input');
        for (const child of Object.values(r)) checkParam(child, depth + 1);
      };
      checkParam(n.params);
    }
    for (const n of [...(d.preEmissionOperators ?? []), ...(d.forces ?? []), ...(d.constraints ?? [])]) report(n.class, 'unsupported-class');
    for (const child of d.children.slice(0, 16)) visit(child, depth + 1);
  };
  visit(root, 0);
  return issues;
}

/** Cubic interpolation uses the slopes authored in Source's normalized-age curves. */
export function ageCurveValue(input: unknown, age: number, fallback = 1): number {
  if (!input || typeof input !== 'object') return fallback;
  const param = input as Exclude<FxParam, number>;
  if (param.pf !== 'PF_TYPE_PARTICLE_AGE_NORMALIZED') return fallback;
  const spline = (param.curve as { m_spline?: Array<{ x: number; y: number; m_flSlopeOutgoing?: number; m_flSlopeIncoming?: number }> } | undefined)?.m_spline;
  if (!Array.isArray(spline) || !spline.length || spline.length > 256) return fallback;
  const points = spline;
  if (!points.every((p) => p && finite(p.x) && finite(p.y))) return fallback;
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
    const value = (2*t*t*t - 3*t*t + 1)*a.y + (t*t*t - 2*t*t + t)*width*ma
      + (-2*t*t*t + 3*t*t)*b.y + (t*t*t - t*t)*width*mb;
    return finite(value) ? value : fallback;
  }
  return points[points.length - 1].y;
}

/** Total budgets apply across children, rather than multiplying per system. */
export function allSpriteLayers(d: FxDescriptor): SpriteSimParams[] {
  const layers: SpriteSimParams[] = [];
  let remaining = 512;
  let systems = 0;
  const visit = (system: FxDescriptor, depth: number, parentDelay: number, systemId: string, parentSystemId?: string) => {
    if (++systems > 32 || depth > 4 || layers.length >= 16 || remaining <= 0) return;
    const delay = parentDelay + Math.max(0, Math.min(30, paramScalar(system.startDelay, 0)));
    let publishesSpawnEvents = false;
    for (const renderer of system.renderers) {
      if (renderer.mode !== 'sprite' || layers.length >= 16 || remaining <= 0) continue;
      const layer = spriteParamsFor({ ...system, sheets: d.sheets }, renderer);
      if (!layer) continue;
      if (layer.parentSpawnEvents && !parentSystemId) continue;
      layer.systemId = systemId;
      layer.parentSystemId = parentSystemId;
      layer.publishesSpawnEvents = !publishesSpawnEvents;
      publishesSpawnEvents = true;
      layer.scale = Math.max(0.001, Math.min(16, paramScalar(d.scale, 1)));
      layer.attachments = d.attachments;
      layer.emissions = layer.emissions.map((emission) => ({ ...emission, start: emission.start + delay }));
      if (layer.parentSpawnWindow) layer.parentSpawnWindow.start += delay;
      layer.maxParticles = Math.min(remaining, layer.maxParticles);
      remaining -= layer.maxParticles;
      layers.push(layer);
    }
    system.children.slice(0, 16).forEach((child, i) => visit(child, depth + 1, delay,
      `${systemId}/${i}`, publishesSpawnEvents ? systemId : undefined));
  };
  visit(d, 0, 0, 'root');
  return layers;
}
