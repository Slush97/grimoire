import { describe, expect, it } from 'vitest';
import { advanceSpriteEmission, ageCurveValue, allSpriteLayers, fxPreviewIssues, normalizedWindow, paramRange, spriteFadeValue, spriteGradientColor,
  spriteParamsFor, type FxDescriptor, type SpriteEmissionState } from './fxDescriptor';
const descriptor = (): FxDescriptor => ({
  name: 'sprite', maxParticles: 64, constantRadius: 15, constantColor: [255, 0, 0],
  controlPoints: [{ cp: 2, attachment: 'ability_cast', attachType: 'PATTACH_POINT_FOLLOW', entity: 'self' }],
  emitters: [{ class: 'C_OP_ContinuousEmitter', params: { m_flEmitRate: 2, m_bForceEmitOnFirstUpdate: true } }],
  initializers: [
    { class: 'C_INIT_InitFloat', params: { m_nOutputField: 1, m_InputValue: { pf: 'PF_TYPE_RANDOM_UNIFORM', min: 2, max: 3 } } },
    { class: 'C_INIT_InitFloat', params: { m_InputValue: { min: 4, max: 6 } } },
    { class: 'C_INIT_InitFloat', params: { m_nOutputField: 5, m_InputValue: { min: 20, max: 40 } } },
    { class: 'C_INIT_CreateWithinSphereTransform', params: { m_TransformInput: { m_nControlPoint: 2 } } },
    { class: 'C_INIT_RandomColor', params: { m_ColorMin: [219, 131, 223], m_ColorMax: [193, 75, 207] } },
  ],
  operators: [{ class: 'C_OP_SpinUpdate', params: {} }, { class: 'C_OP_PositionLock', params: {} }],
  renderers: [{ class: 'C_OP_RenderSprites', params: {}, mode: 'sprite', blendMode: 'PARTICLE_OUTPUT_BLEND_MODE_ADD',
    textures: ['materials/particle/noise.vtex', 'materials/particle/ring.vtex'] }], children: [],
});
describe('authored sprite attributes', () => {
  it('requires a simulated parent for spawn events and rejects other event types', () => {
    const d = descriptor();
    d.emitters = [{ class: 'C_OP_ContinuousEmitter', params: {
      m_bInitFromKilledParentParticles: true, m_nEventType: 'PARTICLE_EVENT_TYPE_MASK_SPAWNED',
    } }];
    expect(allSpriteLayers(d)).toEqual([]);
    const parent = descriptor(); parent.children = [d];
    expect(allSpriteLayers(parent).map((layer) => [layer.systemId, layer.parentSystemId, layer.parentSpawnEvents]))
      .toEqual([['root', undefined, false], ['root/0', 'root', true]]);
    d.emitters[0].params.m_nEventType = 'PARTICLE_EVENT_TYPE_MASK_KILLED';
    expect(spriteParamsFor(d)).toBeNull();
  });
  it('interpolates authored normalized-age green gradients without inventing a texture transfer', () => {
    const input = { m_nType: 'PVEC_TYPE_FLOAT_INTERP_GRADIENT', m_FloatInterp: { pf: 'PF_TYPE_PARTICLE_AGE_NORMALIZED' },
      m_Gradient: { m_Stops: [{ m_flPosition: 0.3, m_Color: [157, 211, 125] }, { m_flPosition: 1, m_Color: [93, 147, 115] }] } };
    expect(spriteGradientColor(input, 0)).toEqual([157/255, 211/255, 125/255]);
    expect(spriteGradientColor(input, 0.65)).toEqual([125/255, 179/255, 120/255]);
    expect(spriteGradientColor(input, 2)).toEqual([93/255, 147/255, 115/255]);
    expect(spriteGradientColor({ ...input, m_FloatInterp: { pf: 'PF_TYPE_CONTROL_POINT_COMPONENT' } }, 0.5)).toBeNull();
  });
  it('omits parent-event children rather than making their omitted rate an always-on glow', () => {
    const d = descriptor(); d.emitters[0].params.m_bInitFromKilledParentParticles = true;
    expect(spriteParamsFor(d)).toBeNull();
    expect(allSpriteLayers(d)).toEqual([]);
  });
  it('adds nested instance delays without collapsing repeated sprites or delaying lifetime after birth', () => {
    const spark = descriptor(); spark.startDelay = 0.15;
    spark.emitters = [{ class: 'C_OP_InstantaneousEmitter', params: { m_nParticlesToEmit: 1 } }];
    const parent = descriptor(); parent.renderers = []; parent.startDelay = 0.11; parent.children = [spark, { ...spark, startDelay: 0 }];
    const layers = allSpriteLayers(parent);
    expect(layers.map((layer) => layer.emissions[0].start)).toEqual([0.26, 0.11]);
    expect(advanceSpriteEmission(layers[0].emissions, [], 0, 0.25, 10)).toEqual([]);
    expect(advanceSpriteEmission(layers[0].emissions, [], 0.25, 0.3, 10)).toEqual([expect.closeTo(0.04)]);
    expect(layers[0].lifetime).toEqual([2, 3]);
  });
  it('preserves planar box bounds, local basis and exact control point', () => {
    const d = descriptor();
    d.controlPoints.unshift({ cp: 1, attachment: 'book_fx', attachType: 'PATTACH_POINT_FOLLOW', entity: 'self' });
    d.initializers = [{ class: 'C_INIT_CreateWithinBox', params: {
      m_vecMin: [0, -8, -16], m_vecMax: [0, 5, 15], m_nControlPointNumber: 1, m_bLocalSpace: true,
    } }];
    const p = spriteParamsFor(d)!;
    expect(p.spawnBox).toEqual({ min: [0, -8, -16], max: [0, 5, 15] });
    expect(p.spawnLocal).toBe(true); expect(p.attachment).toBe('book_fx');
    expect(fxPreviewIssues(d).some((issue) => issue.class === 'C_INIT_CreateWithinBox')).toBe(false);
    d.initializers[0].params.m_vecMin = { m_nType: 'PVEC_TYPE_CP_VALUE' };
    expect(spriteParamsFor(d)).toBeNull();
  });
  it('omits model-hitbox spawning until authored placement is supported, while preserving supported children', () => {
    const root = descriptor();
    root.initializers.push({ class: 'C_INIT_CreateOnModel', params: { m_vecHitBoxScale: [0.1, 0.1, 0.1] } });
    root.children.push(descriptor());
    expect(spriteParamsFor(root)).toBeNull();
    expect(allSpriteLayers(root)).toHaveLength(1);
    expect(fxPreviewIssues(root)).toContainEqual(expect.objectContaining({ class: 'C_INIT_CreateOnModel' }));
  });
  it('uses lifetime field 1, default radius field 3, and authored rate rather than filling the budget', () => {
    const p = spriteParamsFor(descriptor())!;
    expect(p.lifetime).toEqual([2, 3]); expect(p.radius).toEqual([4, 6]); expect(p.emitRate).toBe(2);
    expect(p.emitFirst).toBe(true); expect(p.spawnRadius).toBe(0); expect(p.attachment).toBe('ability_cast');
    expect(p.texture).toBe('materials/particle/ring.vtex'); expect(p.follow).toBe(true);
    expect(p.spin[0]).toBeCloseTo(Math.PI/9); expect(p.spin[1]).toBeCloseTo(2*Math.PI/9);
    expect(p.colorMin[0]).toBeGreaterThan(p.colorMax[0]); expect(p.colorMin[2]).toBeGreaterThan(p.colorMin[1]);
  });
  it('does not invent emission or outward drift for missing operators', () => {
    const d = descriptor(); d.emitters = []; d.operators = []; d.initializers = [];
    const p = spriteParamsFor(d)!;
    expect(p.emitRate).toBe(0); expect(p.gravity).toEqual([0, 0, 0]); expect(p.radius).toEqual([15, 15]);
  });
  it('interpolates normalized-age curves and holds their endpoint rather than forcing a sine fade', () => {
    const curve = { pf: 'PF_TYPE_PARTICLE_AGE_NORMALIZED', curve: { m_spline: [
      { x: 0, y: 0.8, m_flSlopeOutgoing: 0 }, { x: 0.5, y: 1.2, m_flSlopeIncoming: 0 },
    ] } };
    expect(ageCurveValue(curve, 0.25)).toBeCloseTo(1);
    expect(ageCurveValue(curve, 0.9)).toBe(1.2);
    expect(ageCurveValue({ pf: 'PF_TYPE_RANDOM_UNIFORM' }, 0.5)).toBe(1);
  });
  it('bounds graphs globally and rejects non-finite parameters', () => {
    const d = descriptor(); d.maxParticles = 256; d.children = Array.from({ length: 16 }, () => ({ ...descriptor(), maxParticles: 256 }));
    expect(allSpriteLayers(d).reduce((sum, layer) => sum + layer.maxParticles, 0)).toBe(512);
    expect(paramRange(NaN, [1, 2])).toEqual([1, 2]); expect(paramRange({ min: 3, max: 2 }, [0, 0])).toEqual([2, 3]);
  });
  it('uses authored constants, local velocity and timed fade windows', () => {
    const d = descriptor(); d.initializers = [{ class: 'C_INIT_CreateWithinSphereTransform', params: {
      m_fRadiusMin: 2, m_fRadiusMax: 4, m_fSpeedMin: 10, m_fSpeedMax: 20, m_bLocalCoords: true,
      m_LocalCoordinateSystemSpeedMin: [0, 5, 0], m_LocalCoordinateSystemSpeedMax: [0, 8, 0],
    } }];
    d.constantLifespan = 4;
    d.operators = [{ class: 'C_OP_ColorInterpolate', params: { m_flFadeStartTime: 0.2, m_flFadeEndTime: 0.8 } },
      { class: 'C_OP_FadeAndKill', params: { m_flStartAlpha: 0, m_flEndFadeInTime: 0.2, m_flStartFadeOutTime: 0.8 } }];
    const p = spriteParamsFor(d)!;
    expect(p.lifetime).toEqual([4, 4]); expect(p.speed).toEqual([10, 20]); expect(p.spawnLocal).toBe(true);
    expect(p.spawnRadiusMin).toBe(2); expect(p.localSpeedMax).toEqual([0, 8, 0]);
    expect(p.colorFadeTime).toEqual([0.2, 0.8]);
    expect(spriteFadeValue(p.fade, 0)).toBe(0);
    expect(spriteFadeValue(p.fade, 0.1)).toBeCloseTo(0.5);
    expect(spriteFadeValue(p.fade, 0.5)).toBe(1);
    expect(spriteFadeValue(p.fade, 0.9)).toBeCloseTo(0.5);
    expect(spriteFadeValue(p.fade, 1)).toBe(0);
    expect(normalizedWindow(0.2, [0.2, 0.8])).toBe(0);
    expect(normalizedWindow(0.8, [0.2, 0.8])).toBe(1);
  });
  it('respects start/duration boundaries, delayed bursts and frame caps', () => {
    const d = descriptor(); d.emitters = [
      { class: 'C_OP_ContinuousEmitter', params: { m_flEmitRate: 20, m_flStartTime: 0.1, m_flEmissionDuration: 0.1 } },
      { class: 'C_OP_InstantaneousEmitter', params: { m_nParticlesToEmit: 3, m_flStartTime: 0.2, m_nMaxEmittedPerFrame: 2 } },
    ];
    const emissions = spriteParamsFor(d)!.emissions, state: SpriteEmissionState[] = [];
    expect(advanceSpriteEmission(emissions, state, 0, 0.05, 64)).toEqual([]);
    expect(advanceSpriteEmission(emissions, state, 0.05, 0.15, 64)).toHaveLength(1);
    const boundary = advanceSpriteEmission(emissions, state, 0.15, 0.25, 64);
    expect(boundary).toHaveLength(3);
    for (const age of boundary) expect(age).toBeCloseTo(0.05);
    expect(advanceSpriteEmission(emissions, state, 0.25, 0.3, 64)).toEqual([0.3 - 0.2]);
    expect(advanceSpriteEmission(emissions, state, 0.3, 1, 64)).toEqual([]);
  });
  it('drops continuous emission debt when the particle budget is full', () => {
    const d = descriptor(); d.emitters[0].params = { m_flEmitRate: 100 };
    const emissions = spriteParamsFor(d)!.emissions, state: SpriteEmissionState[] = [];
    expect(advanceSpriteEmission(emissions, state, 0, 0.1, 0)).toEqual([]);
    expect(advanceSpriteEmission(emissions, state, 0.1, 0.11, 64)).toHaveLength(1);
    expect(paramRange({ pf: 'PF_TYPE_CONTROL_POINT_COMPONENT', min: 5, max: 10 }, [0, 0])).toEqual([0, 0]);
  });
  it('omits skinned snapshot sprites when the authored snapshot is unavailable', () => {
    const d = descriptor();
    d.initializers.push({ class: 'C_INIT_InitSkinnedPositionFromCPSnapshot', params: { m_bRandom: true } });
    d.operators.push({ class: 'C_OP_SnapshotRigidSkinToBones', params: {} });
    expect(spriteParamsFor(d)).toBeNull();
    d.snapshot = { points: [0, 1].map(x => ({ position: [x, 0, 0], joints: ['hand', '', '', ''], weights: [1, 0, 0, 0] })) };
    expect(spriteParamsFor(d)?.snapshot).toEqual({ points: d.snapshot.points, random: true });
  });
  it('reports unsupported operators, renderers and providers in bounded diagnostics', () => {
    const d = descriptor();
    d.operators.push({ class: 'C_OP_AttractToControlPoint', params: {} });
    d.emitters[0].params.m_flEmitRate = { pf: 'PF_TYPE_CONTROL_POINT_COMPONENT', cp: 2 };
    expect(spriteParamsFor(d)!.emitRate).toBe(0);
    d.renderers.push({ class: 'C_OP_RenderRopes', params: {}, mode: 'unsupported', blendMode: null, textures: [] });
    d.forces = [{ class: 'C_OP_TurbulenceForce', params: {} }];
    expect(fxPreviewIssues(d)).toEqual(expect.arrayContaining([
      { system: 'sprite', class: 'C_OP_AttractToControlPoint', reason: 'unsupported-class' },
      { system: 'sprite', class: 'C_OP_RenderRopes', reason: 'unsupported-class' },
      { system: 'sprite', class: 'C_OP_ContinuousEmitter', reason: 'unsupported-input' },
      { system: 'sprite', class: 'C_OP_TurbulenceForce', reason: 'unsupported-class' },
    ]));
    d.children = [d];
    expect(fxPreviewIssues(d).length).toBeLessThan(128);
    expect(ageCurveValue({ pf: 'PF_TYPE_PARTICLE_AGE_NORMALIZED', curve: { m_spline: {} } }, 0.5)).toBe(1);
  });
});
