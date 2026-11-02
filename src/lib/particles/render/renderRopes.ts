// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/RenderRopes.cs and the spline
// helpers of Renderer/Utils/CableMeshBuilder.cs.
//
// Renders the particles of a system as a ribbon threaded through them, textured along its own arc
// length in world units. The chain is a Catmull-Rom spline whose control points are consecutive
// particles, subdivided per segment by a screen size driven tesselation level. The ribbon breaks
// wherever the m_nSplitField value changes between neighbours, and each piece splines only through
// its own particles. With m_bSortBySegmentID the particles are first grouped by that value, in the
// order each value first appears.

import * as THREE from 'three';
import type { ParticleCollection } from '../collection';
import { ParticleEventType, ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { Vector3, distance, lerpV, singleToInt32Bits } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { FLOAT_EPSILON, MINIMUM_LENGTH_SQUARED } from '../utils/particleMath';
import { applyColorBlend, type Rgba } from './colorBlend';
import type { ParticleRendererContext } from './context';
import { ParticleOrientation } from './enums';
import { ParticleSpritecardRenderer } from './spritecardRenderer';
import { StripBuffer, type StripCorner } from './spritecardVertex';
import type { RenderView } from './view';

const DEFAULT_TEXTURE_NAME = 'materials/particle/base_trail.vtex';

/** The shared quad index buffer covers 65532 indices, six per quad. */
const MAX_QUADS = Math.floor(65532 / 6);
const MAX_SUBDIVISIONS = 128;

/**
 * How many segments are written in one batch. The V offset carried over when the first particle
 * dies grows by the length of the last segment of the first batch.
 */
const SEGMENT_BATCH_SIZE = 527;

interface RopeNode {
  particleIndex: number;
  /** The bits of the split field, which segments are told apart by. */
  segmentBits: number;
  position: Vector3;
  radius: number;
  color: [number, number, number];
  alpha: number;
  orientation: Vector3;
  scalarCoordinate: number;
  extraData1: number;
  extraData2: number;
  /** Roll, yaw and pitch, without the roll scale. */
  rotation: [number, number, number];
}

interface RibbonSample {
  position: Vector3;
  widthAxis: Vector3;
  /** The axis whose alignment with the view fades the ribbon out by view angle. */
  facingAxis: Vector3;
  /** The radius before the size clamp. */
  radius: number;
  /** The colour, its alpha before any fade. */
  color: [number, number, number, number];
}

export function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function catmullRomV(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): Vector3 {
  return new Vector3(catmullRom(p0.x, p1.x, p2.x, p3.x, t), catmullRom(p0.y, p1.y, p2.y, p3.y, t), catmullRom(p0.z, p1.z, p2.z, p3.z, t));
}

/** The derivative of catmullRom with respect to t. */
export function catmullRomTangent(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): Vector3 {
  const t2 = t * t;
  const axis = (a: number, b: number, c: number, d: number) => 0.5 * (-a + c + (4 * a - 10 * b + 8 * c - 2 * d) * t + (-3 * a + 9 * b - 9 * c + 3 * d) * t2);
  return new Vector3(axis(p0.x, p1.x, p2.x, p3.x), axis(p0.y, p1.y, p2.y, p3.y), axis(p0.z, p1.z, p2.z, p3.z));
}

/** MathUtils.SafeNormalize with a fallback: unit length, or `fallback` when the squared length does not exceed the minimum. */
export function safeNormalizeOr(value: Vector3, fallback: Vector3, minimumLengthSquared = 0): Vector3 {
  const lengthSquared = value.lengthSquared();
  return lengthSquared > minimumLengthSquared ? value.scale(1 / Math.sqrt(lengthSquared)) : fallback;
}

export class RenderRopes extends ParticleSpritecardRenderer {
  private readonly orientationType: number;
  private readonly orientationField: number;
  private readonly minTessellation: number;
  private readonly maxTessellation: number;
  private readonly tessScale: number;
  private readonly textureVWorldSize: NumberProvider;
  private readonly textureVScrollRate: NumberProvider;
  private readonly textureVOffset: NumberProvider;
  private readonly textureVParamsControlPoint: number;
  private readonly clampV: boolean;
  private readonly scaleControlPoint1: number;
  private readonly scaleControlPoint2: number;
  private readonly scaleVSizeByControlPointDistance: number;
  private readonly scaleVScrollByControlPointDistance: number;
  private readonly scaleVOffsetByControlPointDistance: number;
  private readonly useScalarForTextureCoordinate: boolean;
  private readonly scalarFieldForTextureCoordinate: number;
  private readonly scalarAttributeTextureCoordScale: number;
  private readonly reverseOrder: boolean;
  private readonly closedLoop: boolean;
  private readonly splitField: number;
  private readonly sortBySegmentId: boolean;
  private readonly drawAsOpaque: boolean;
  private readonly enableFadingAndClamping: boolean;
  private readonly minSize: number;
  private readonly maxSize: number;
  private readonly startFadeSize: NumberProvider;
  private readonly endFadeSize: NumberProvider;
  /** Whether the visibility inputs scale the rope, which they do from behavior version 11. */
  private readonly appliesVisibility: boolean;

  private readonly segmentRepeats = new Map<number, number>();
  private readonly segmentStarts = new Map<number, number>();
  private segmentDataDirty = false;

  /** The particle indices grouped by segment, as updateSegmentData last built them. */
  private segmentOrder: number[] = [];
  private segmentOrderCount = 0;

  /** The V offset and one over the texture's world size, from the last updateVertices. */
  private readonly vMapping = new THREE.Vector2(0, 1);
  private vOffsetAccumulator = 0;
  private firstSegmentLength = 0;
  private firstParticleId = -1;
  private strip: StripBuffer | null = null;

  constructor(parse: ParticleDefinitionParser, context: ParticleRendererContext) {
    super(parse, context, DEFAULT_TEXTURE_NAME, 0);

    let orientationType = parse.enum('m_nOrientationType', ParticleOrientation, ParticleOrientation.PARTICLE_ORIENTATION_SCREEN_ALIGNED);
    this.orientationField = parse.particleField('m_nVectorFieldForOrientation', ParticleField.Normal);
    this.minTessellation = parse.int32('m_nMinTesselation', 1);
    this.maxTessellation = parse.int32('m_nMaxTesselation', 128);
    this.tessScale = parse.float('m_flTessScale', 1);
    this.textureVWorldSize = parse.numberProvider('m_flTextureVWorldSize', new LiteralNumberProvider(10));
    this.textureVScrollRate = parse.numberProvider('m_flTextureVScrollRate', new LiteralNumberProvider(0));
    this.textureVOffset = parse.numberProvider('m_flTextureVOffset', new LiteralNumberProvider(0));
    this.textureVParamsControlPoint = parse.int32('m_nTextureVParamsCP', -1);
    this.clampV = parse.boolean('m_bClampV', false);
    this.scaleControlPoint1 = parse.int32('m_nScaleCP1', -1);
    this.scaleControlPoint2 = parse.int32('m_nScaleCP2', -1);
    this.scaleVSizeByControlPointDistance = parse.float('m_flScaleVSizeByControlPointDistance', 0);
    this.scaleVScrollByControlPointDistance = parse.float('m_flScaleVScrollByControlPointDistance', 0);
    this.scaleVOffsetByControlPointDistance = parse.float('m_flScaleVOffsetByControlPointDistance', 0);
    this.useScalarForTextureCoordinate = parse.boolean('m_bUseScalarForTextureCoordinate', false);
    this.scalarFieldForTextureCoordinate = parse.particleField('m_nScalarFieldForTextureCoordinate', ParticleField.CreationTime);
    this.scalarAttributeTextureCoordScale = parse.float('m_flScalarAttributeTextureCoordScale', 1);
    this.reverseOrder = parse.boolean('m_bReverseOrder', false);
    this.closedLoop = parse.boolean('m_bClosedLoop', false);
    this.splitField = parse.particleField('m_nSplitField', ParticleField.RopeSegmentId);
    this.sortBySegmentId = parse.boolean('m_bSortBySegmentID', false);
    this.drawAsOpaque = parse.boolean('m_bDrawAsOpaque', false);
    this.enableFadingAndClamping = parse.boolean('m_bEnableFadingAndClamping', false);
    this.minSize = parse.float('m_flMinSize', 0);
    this.maxSize = parse.float('m_flMaxSize', 2000);
    this.startFadeSize = parse.numberProvider('m_flStartFadeSize', new LiteralNumberProvider(1000));
    this.endFadeSize = parse.numberProvider('m_flEndFadeSize', new LiteralNumberProvider(2000));
    this.appliesVisibility = parse.behaviorVersion >= 11;

    orientationType = Math.min(
      Math.max(orientationType, ParticleOrientation.PARTICLE_ORIENTATION_SCREEN_ALIGNED),
      ParticleOrientation.PARTICLE_ORIENTATION_FULL_3AXIS_ROTATION,
    );
    this.orientationType = orientationType;

    this.pass = this.drawAsOpaque ? 'opaque' : 'translucent';
    this.applyRenderState(this.material);
  }

  protected override createGeometry(): THREE.BufferGeometry {
    return new THREE.BufferGeometry();
  }

  private get splits(): boolean {
    return this.splitField >= 0 && this.splitField !== ParticleField.NoneDisabled;
  }

  override get storedFields(): bigint {
    return this.splits ? fieldMask(ParticleField.RopeSegmentData) : 0n;
  }

  override get observedEvents(): number {
    return this.splits
      ? ParticleEventType.PARTICLE_EVENT_TYPE_MASK_SPAWNED | ParticleEventType.PARTICLE_EVENT_TYPE_MASK_KILLED
      : ParticleEventType.PARTICLE_EVENT_TYPE_MASK_NONE;
  }

  override onParticleEvent(): void {
    this.segmentDataDirty = true;
  }

  override simulate(particles: ParticleCollection, state: ParticleSystemState): void {
    if (!this.segmentDataDirty || this.getOperatorRunStrength(state) <= 0) {
      return;
    }

    this.segmentDataDirty = false;

    if (this.sortBySegmentId) {
      this.updateSegmentData(particles.currentSpan);
    }
  }

  /**
   * Writes each particle's place in its rope segment to RopeSegmentData: how many particles of the
   * segment come before it in x, that as a fraction of the segment's last place in y, and the last
   * place in z. Also groups the particles by segment into segmentOrder, keeping the walk order within
   * each segment and ordering the segments by where each first appears in the walk.
   */
  private updateSegmentData(particles: ParticleSpan): void {
    this.segmentRepeats.clear();
    this.segmentStarts.clear();

    const count = particles.length;
    const segments = particles.readFloats(this.splitField);
    const segmentData = particles.vectors(ParticleField.RopeSegmentData);

    for (let i = 0; i < count; i++) {
      const bits = singleToInt32Bits(segments[i]);
      const repeats = this.segmentRepeats.get(bits);
      const place = repeats !== undefined ? repeats + 1 : 0;
      this.segmentRepeats.set(bits, place);
      segmentData[i * 3] = place;
      segmentData[i * 3 + 1] = 0;
      segmentData[i * 3 + 2] = 0;
    }

    let nextStart = 0;

    for (let n = 0; n < count; n++) {
      const bits = singleToInt32Bits(segments[this.walkIndex(n, count)]);

      if (!this.segmentStarts.has(bits)) {
        this.segmentStarts.set(bits, nextStart);
        nextStart += this.segmentRepeats.get(bits)! + 1;
      }
    }

    if (this.segmentOrder.length < count) {
      this.segmentOrder = new Array<number>(count).fill(0);
    }

    for (let i = 0; i < count; i++) {
      const bits = singleToInt32Bits(segments[i]);
      const last = this.segmentRepeats.get(bits)!;
      const place = Math.trunc(segmentData[i * 3]);
      const rank = this.reverseOrder ? last - place : place;

      this.segmentOrder[this.segmentStarts.get(bits)! + rank] = i;
      segmentData[i * 3] = place;
      segmentData[i * 3 + 1] = last > 0 ? Math.fround(place / last) : 0;
      segmentData[i * 3 + 2] = last;
    }

    this.segmentOrderCount = count;
  }

  /** The particle the rope visits n-th, from the last one when reversed. */
  private walkIndex(n: number, count: number): number {
    return this.reverseOrder ? count - 1 - n : n;
  }

  /**
   * Resolves a spline control point index against the chain. A closed loop wraps so the seam stays
   * smooth; an open rope clamps so a segment's tangents never reach past either end.
   */
  private resolveIndex(index: number, count: number): number {
    if (this.closedLoop) {
      if (index < 0) {
        return count - 1;
      }

      return index >= count ? index - count : index;
    }

    return Math.min(Math.max(index, 0), count - 1);
  }

  /**
   * Picks one subdivision level for the whole collection from its projected size: the level of the
   * smallest power of two at least the subdivision count. The count is lowered to the ceiling before
   * the floor is applied, so the floor wins when it is above the ceiling.
   */
  private computeTessellationLevel(nodes: readonly RopeNode[], view: RenderView): number {
    let min = new Vector3(Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE);
    let max = new Vector3(-Number.MAX_VALUE, -Number.MAX_VALUE, -Number.MAX_VALUE);

    for (const node of nodes) {
      min = new Vector3(Math.min(min.x, node.position.x), Math.min(min.y, node.position.y), Math.min(min.z, node.position.z));
      max = new Vector3(Math.max(max.x, node.position.x), Math.max(max.y, node.position.y), Math.max(max.z, node.position.z));
    }

    const diagonal = distance(max, min);
    const coverage = screenSizeFraction(min.add(max).scale(0.5), diagonal, view);
    const metric = (Math.sqrt(coverage) * 1024) / nodes.length;
    const raw = Math.trunc(Math.fround(metric * this.tessScale * 0.1));

    let subdivisions = Math.min(raw, this.maxTessellation);

    if (this.minTessellation > subdivisions) {
      subdivisions = this.minTessellation;
    }

    subdivisions = Math.min(Math.max(subdivisions, 1), MAX_SUBDIVISIONS);
    return subdivisions === 1 ? 0 : Math.floor(Math.log2(subdivisions - 1)) + 1;
  }

  /**
   * Evaluates the three V inputs once for the collection. A control point named by m_nTextureVParamsCP
   * replaces all three outright; otherwise the control point distance factors add to them in world
   * units. The two are mutually exclusive.
   */
  private resolveTextureV(state: ParticleSystemState): { scrollRate: number; offset: number; oneOverWorldSize: number } {
    let scrollRate = this.textureVScrollRate.nextNumber(state);
    let offset = this.textureVOffset.nextNumber(state);
    let worldSize = this.textureVWorldSize.nextNumber(state);

    if (this.textureVParamsControlPoint >= 0) {
      const parameters = state.getControlPoint(this.textureVParamsControlPoint).position;
      return { scrollRate: parameters.y, offset: parameters.z, oneOverWorldSize: 1 / Math.max(FLOAT_EPSILON, parameters.x) };
    }

    const modulated =
      (this.scaleVSizeByControlPointDistance > 0 || this.scaleVScrollByControlPointDistance > 0 || this.scaleVOffsetByControlPointDistance > 0) &&
      this.scaleControlPoint1 > -1 &&
      this.scaleControlPoint2 > -1;

    if (modulated) {
      const d = distance(state.getControlPoint(this.scaleControlPoint1).position, state.getControlPoint(this.scaleControlPoint2).position);

      if (this.scaleVSizeByControlPointDistance > 0) {
        worldSize = this.scaleVSizeByControlPointDistance * d + worldSize;
      }

      if (this.scaleVScrollByControlPointDistance > 0) {
        scrollRate = this.scaleVScrollByControlPointDistance * d + scrollRate;
      }

      if (this.scaleVOffsetByControlPointDistance > 0) {
        offset = this.scaleVOffsetByControlPointDistance * d + offset;
      }
    }

    return { scrollRate, offset, oneOverWorldSize: 1 / Math.max(FLOAT_EPSILON, worldSize) };
  }

  private readonly colorScratch: Rgba = [0, 0, 0, 0];
  private readonly bytesScratch: Rgba = [0, 0, 0, 0];

  /**
   * Copies the live particles into nodes in walk order, grouped by segment when sorted. The radius
   * is before the size clamp and the alpha before the fades, which the shader applies. The tint is
   * truncated to bytes without a clamp, so a channel past 1 wraps around. The alpha scale applies
   * twice: once with the particle's alpha and again where the colour scale combines.
   */
  private collectNodes(particleBag: ParticleCollection, state: ParticleSystemState, view: RenderView): RopeNode[] {
    const count = particleBag.count;
    const grouped = this.sortBySegmentId && this.segmentOrderCount === count;
    const splits = this.splits;
    const scales = this.appliesVisibility ? this.evaluateScales(state, view) : this.evaluateScales(state);

    // The visible alpha goes in with the alpha scale, both times it applies
    const alphaScale = scales.alpha * scales.visibleAlpha;
    const colorScale: Rgba = [scales.color[0], scales.color[1], scales.color[2], alphaScale];

    if (scales.radius === 0 || alphaScale === 0) {
      return [];
    }

    const particles = particleBag.currentSpan;
    const positions = particles.readVectors(ParticleField.Position);
    const colors = particles.readVectors(ParticleField.Color);
    const orientations = particles.readVectors(this.orientationField);
    const radii = particles.readFloats(ParticleField.Radius);
    const alphas = particles.readFloats(ParticleField.Alpha);
    const alpha2s = this.readAlpha2(particles);
    const segments = splits ? particles.readFloats(this.splitField) : null;
    const scalarCoordinates = this.useScalarForTextureCoordinate ? particles.readFloats(this.scalarFieldForTextureCoordinate) : null;
    const extraData1 = particles.readFloats(ParticleField.ShaderExtraData1);
    const extraData2 = particles.readFloats(ParticleField.ShaderExtraData2);
    const rolls = particles.readFloats(ParticleField.Roll);
    const yaws = particles.readFloats(ParticleField.Yaw);
    const pitches = particles.readFloats(ParticleField.Pitch);
    const nodes: RopeNode[] = [];

    for (let i = 0; i < count; i++) {
      const p = grouped ? this.segmentOrder[i] : this.walkIndex(i, count);
      const radius = radii[p] * scales.radius;
      const bytes = this.bytesScratch;
      bytes[0] = wrappedByte(colors[p * 3]);
      bytes[1] = wrappedByte(colors[p * 3 + 1]);
      bytes[2] = wrappedByte(colors[p * 3 + 2]);
      bytes[3] = Math.min(Math.max(alphaScale * 255 * alpha2s[p] * alphas[p], 0), 255);
      const color = applyColorBlend(this.colorBlendType, bytes, colorScale, this.colorScratch);

      nodes.push({
        particleIndex: p,
        segmentBits: segments !== null ? singleToInt32Bits(segments[p]) : 0,
        position: new Vector3(positions[p * 3], positions[p * 3 + 1], positions[p * 3 + 2]),
        radius,
        color: [color[0] / 255, color[1] / 255, color[2] / 255],
        alpha: color[3] / 255,
        orientation: new Vector3(orientations[p * 3], orientations[p * 3 + 1], orientations[p * 3 + 2]),
        scalarCoordinate: scalarCoordinates !== null ? scalarCoordinates[p] * this.scalarAttributeTextureCoordScale : 0,
        extraData1: extraData1[p],
        extraData2: extraData2[p],
        rotation: [rolls[p], yaws[p], pitches[p]],
      });
    }

    return nodes;
  }

  /**
   * Builds the ribbon into the vertex buffer and returns how many quads were written. V is raw world
   * arc length measured between the particles themselves, so subdividing a segment keeps the same V
   * span as the straight chord it replaces. A segment joining two rope segments, or one of no length,
   * is not drawn, but its length still advances V. The segment of an open rope that ends on the first
   * particle ends at V 0.
   */
  protected override updateVertices(particleBag: ParticleCollection, state: ParticleSystemState, view: RenderView): number {
    const nodes = this.collectNodes(particleBag, state, view);
    const nodeCount = nodes.length;

    // A frame with no radius or alpha scale returns before the carried V offset sees a new first
    // particle, where only a collection of fewer than two particles should skip it
    if (nodeCount < 2) {
      return 0;
    }

    const segmentCount = this.closedLoop ? nodeCount : nodeCount - 1;
    const subdivisions = 1 << this.computeTessellationLevel(nodes, view);

    const { scrollRate, offset: vOffset, oneOverWorldSize } = this.resolveTextureV(state);
    this.carryVOffset(particleBag, oneOverWorldSize);
    this.vMapping.set(vOffset, oneOverWorldSize);

    // A first layer showing a sheet places its frames by the card coordinate, and V stays 0
    const lengthV = !this.layers[0].hasSheet;

    const maxQuads = Math.min(MAX_QUADS, segmentCount * subdivisions);
    this.strip ??= new StripBuffer(this.mesh.geometry);
    const vertices = this.strip.reserve(maxQuads);
    let quadCount = 0;
    let arcLength = scrollRate * state.age + this.vOffsetAccumulator;
    const stripAxis = { value: Vector3.zero };

    for (let segment = 0; segment < segmentCount && quadCount < maxQuads; segment++) {
      const n1 = nodes[this.resolveIndex(segment, nodeCount)];
      const n2 = nodes[this.resolveIndex(segment + 1, nodeCount)];

      const segmentLength = distance(n1.position, n2.position);
      const endsAtFirst = n2.particleIndex === 0 && !this.closedLoop;

      if (segment < SEGMENT_BATCH_SIZE) {
        this.firstSegmentLength = segmentLength;
      }

      let vStart = arcLength;
      let vEnd = endsAtFirst ? 0 : arcLength + segmentLength;
      arcLength += segmentLength;

      // A hidden join is skipped rather than drawn with no alpha
      if (n1.segmentBits !== n2.segmentBits || segmentLength === 0) {
        stripAxis.value = Vector3.zero;
        continue;
      }

      const before = nodes[this.resolveIndex(segment - 1, nodeCount)];
      const after = nodes[this.resolveIndex(segment + 2, nodeCount)];
      const n0 = before.segmentBits === n1.segmentBits ? before : n1;
      const n3 = after.segmentBits === n2.segmentBits ? after : n2;

      if (!lengthV) {
        vStart = 0;
        vEnd = 0;
      } else if (this.useScalarForTextureCoordinate) {
        vStart = n1.scalarCoordinate;
        vEnd = n2.particleIndex === 0 ? n1.scalarCoordinate : n2.scalarCoordinate;
      }

      let previous = this.evaluateSample(n0, n1, n2, n3, 0, view);
      alignWidthAxis(previous, stripAxis);

      for (let step = 1; step <= subdivisions && quadCount < maxQuads; step++) {
        const previousT = Math.fround((step - 1) / subdivisions);
        const t = Math.fround(step / subdivisions);
        const current = this.evaluateSample(n0, n1, n2, n3, t, view);
        alignWidthAxis(current, stripAxis);

        writeQuad(vertices, quadCount, n1, previous, current, previousT, t, vStart + (vEnd - vStart) * previousT, vStart + (vEnd - vStart) * t, state.age);

        quadCount++;
        previous = current;
      }
    }

    this.strip.commit(quadCount);
    return quadCount;
  }

  /**
   * Adds firstSegmentLength to the carried V offset, wrapped to the texture's world size, whenever a
   * different particle is first, as when the rope's oldest particle dies.
   */
  private carryVOffset(particleBag: ParticleCollection, oneOverWorldSize: number): void {
    const particleId = particleBag.currentSpan.readInteger(ParticleField.ParticleId, 0);

    if (this.firstParticleId !== -1 && particleId !== this.firstParticleId) {
      // C#'s float % keeps the dividend's sign, as JavaScript's does
      this.vOffsetAccumulator = Math.fround(Math.fround(this.vOffsetAccumulator + this.firstSegmentLength) % Math.fround(1 / oneOverWorldSize));
    }

    this.firstParticleId = particleId;
  }

  /**
   * Splines position, radius and colour between the two middle control points and builds the
   * ribbon's width axis from the spline tangent and the plane the orientation type selects.
   */
  private evaluateSample(n0: RopeNode, n1: RopeNode, n2: RopeNode, n3: RopeNode, t: number, view: RenderView): RibbonSample {
    const position = catmullRomV(n0.position, n1.position, n2.position, n3.position, t);
    const radius = catmullRom(n0.radius, n1.radius, n2.radius, n3.radius, t);
    const tangent = safeNormalizeOr(catmullRomTangent(n0.position, n1.position, n2.position, n3.position, t), Vector3.unitX, MINIMUM_LENGTH_SQUARED);

    const normalAligned = this.orientationType === ParticleOrientation.PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL;
    const orientation = lerpV(n1.orientation, n2.orientation, t);

    let planeNormal: Vector3;

    switch (this.orientationType) {
      case ParticleOrientation.PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL:
        planeNormal = orientation;
        break;
      case ParticleOrientation.PARTICLE_ORIENTATION_WORLD_Z_ALIGNED:
        planeNormal = Vector3.unitZ;
        break;
      default:
        planeNormal = view.location.sub(position);
    }

    // The node colours and alphas are already in [0, 1], so their blend is too
    const mix = (a: number, b: number) => a + (b - a) * t;

    return {
      position,
      widthAxis: ParticleSpritecardRenderer.ribbonWidthAxis(tangent, planeNormal),
      facingAxis: normalAligned ? orientation : tangent,
      radius,
      color: [mix(n1.color[0], n2.color[0]), mix(n1.color[1], n2.color[1]), mix(n1.color[2], n2.color[2]), mix(n1.alpha, n2.alpha)],
    };
  }

  protected override setDrawUniforms(state: ParticleSystemState): void {
    this.setSizeClampAndFadeUniforms(this.enableFadingAndClamping, this.minSize, this.startFadeSize.nextNumber(state), this.endFadeSize.nextNumber(state), this.maxSize);

    // The view angle fade runs in every mode and outside the fade-and-clamp gate
    this.setViewAngleFadeUniforms(this.fadesByViewAngle);

    // A rope does not zoom between sheet frames
    (this.uniforms.uFrameZoom.value as THREE.Vector2).set(1, 1);

    // TODO: Where the V clamp applies is not known; it holds the mapped V to 0-1
    (this.uniforms.uRopeVMapping.value as THREE.Vector2).copy(this.vMapping);
    this.uniforms.uClampV.value = this.clampV;

    super.setDrawUniforms(state);
  }

  override dispose(): void {
    this.strip?.dispose();
    super.dispose();
  }
}

/**
 * How much of the view a sphere fills, from 0 to 1: its radius over its distance, scaled by the
 * projection, or all of it when the camera is inside the sphere (ParticleFunctionRenderer.ScreenSizeFraction).
 */
export function screenSizeFraction(center: Vector3, radius: number, view: RenderView): number {
  const delta = center.sub(view.location);
  const distanceSquared = delta.lengthSquared();

  if (radius * radius > distanceSquared) {
    return 1;
  }

  const fraction = (radius * view.projectionM22) / Math.sqrt(distanceSquared);
  return fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
}

/** ParticleColorBlend.ToWrappedBytes for one channel: truncated to a byte without a clamp, so past 1 wraps. */
function wrappedByte(channel: number): number {
  const truncated = Math.trunc(Math.fround(channel * 255));
  return Number.isFinite(truncated) ? truncated & 0xff : 0;
}

/**
 * Keeps the ribbon side vector on one hemisphere along the strip. The sign of the width axis is
 * visually symmetric per sample, but letting it flip between neighboring samples folds their shared
 * quad into a bowtie where the tangent passes through the view direction.
 */
function alignWidthAxis(sample: RibbonSample, stripAxis: { value: Vector3 }): void {
  if (sample.widthAxis.dot(stripAxis.value) < 0) {
    sample.widthAxis = sample.widthAxis.negate();
  }

  stripAxis.value = sample.widthAxis;
}

/**
 * Writes the four corners between two samples of the segment that starts at `segmentStart`, which
 * every corner takes its particle values from.
 */
function writeQuad(
  vertices: Float32Array,
  quadIndex: number,
  segmentStart: RopeNode,
  start: RibbonSample,
  end: RibbonSample,
  startT: number,
  endT: number,
  vStart: number,
  vEnd: number,
  sheetAge: number,
): void {
  // The card runs from its top at the segment start to its bottom at the segment end
  const startCornerY = 1 - 2 * startT;
  const endCornerY = 1 - 2 * endT;

  // A rope hands over no random value, and the system's age in place of the particle's
  const sheetInputs: [number, number, number, number] = [0, segmentStart.extraData1, sheetAge, segmentStart.extraData2];
  const quadStart = quadIndex * 4;

  writeCorner(vertices, quadStart, start, -1, startCornerY, vStart, segmentStart, sheetInputs);
  writeCorner(vertices, quadStart + 1, end, -1, endCornerY, vEnd, segmentStart, sheetInputs);
  writeCorner(vertices, quadStart + 2, end, 1, endCornerY, vEnd, segmentStart, sheetInputs);
  writeCorner(vertices, quadStart + 3, start, 1, startCornerY, vStart, segmentStart, sheetInputs);
}

/** Writes one corner of a quad, on the side of the ribbon `side` picks: -1 against the width axis, 1 along it. */
function writeCorner(
  vertices: Float32Array,
  index: number,
  sample: RibbonSample,
  side: number,
  cornerY: number,
  v: number,
  segmentStart: RopeNode,
  sheetInputs: [number, number, number, number],
): void {
  const widthAxis = sample.widthAxis.scale(side);
  const corner: StripCorner = {
    position: sample.position.add(widthAxis.scale(sample.radius)),
    color: sample.color,
    sheetInputs,
    cornerV: [side, cornerY, v],
    rotationRadius: [segmentStart.rotation[0], segmentStart.rotation[1], segmentStart.rotation[2], sample.radius],
    widthAxis,
    facingAxis: sample.facingAxis,
    segmentAlphaRadius: [segmentStart.alpha, segmentStart.radius],
  };

  StripBuffer.write(vertices, index, corner);
}
