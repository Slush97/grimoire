// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/RenderTrails.cs.
//
// Renders particles as trail segments stretched between the particle's current and previous
// positions, with configurable length, fade-in, texture scaling, and blend modes. Trails are sprites
// stretched by speed over time.

import * as THREE from 'three';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask, isScalarField } from '../fields';
import { Vector3 } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { FLOAT_EPSILON } from '../utils/particleMath';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';
import type { Rgba } from './colorBlend';
import type { ParticleRendererContext } from './context';
import { ParticleOrientation } from './enums';
import { ParticleSpritecardRenderer } from './spritecardRenderer';
import type { RenderView } from './view';

const DEFAULT_TEXTURE_NAME = 'materials/particle/base_trail.vtex';

/** One particle's attributes, which the shader expands into the four corners of its ribbon. */
const TRAIL_INSTANCE_LAYOUT = [
  // The centre of the ribbon in xyz, the tail's alpha before any fade in w
  ['vPOSITION', 4],
  // The colour before either end's colour scale in rgb, the head's alpha before any fade in a
  ['vCOLOR', 4],
  // The flip and crop scale of the card coordinate
  ['vTrailUvCrop', 2],
  // Across the ribbon in xyz, the head's half width before the size clamp in w
  ['vAxisU', 4],
  // Along the ribbon and already halved in xyz, the tail's half width before the size clamp in w
  ['vAxisV', 4],
  ['vTEXCOORD', 4],
  // The sequence the first layer plays, then the one later layers play
  ['vTEXCOORD1', 2],
  ['vNORMAL', 3],
] as const;

const TRAIL_INSTANCE_STRIDE = TRAIL_INSTANCE_LAYOUT.reduce((sum, [, size]) => sum + size, 0);

export class RenderTrails extends ParticleSpritecardRenderer {
  // m_bEnableFadingAndClamping gates the size clamp and the distance fade together. The bounds below
  // are trail-specific and differ from the sprite renderer's.
  private readonly enableFadingAndClamping: boolean;
  private readonly minSize: number;
  private readonly maxSize: number;
  private readonly startFadeSize: NumberProvider;
  private readonly endFadeSize: NumberProvider;
  private readonly orientationType: number;
  private readonly prevPositionSource: number;
  /** Whether the previous point is the Verlet one, whose distance moved is converted to a velocity. */
  private readonly usesVerletDelta: boolean;
  private readonly flipUvByPitchYaw: boolean;
  /** The fields that crop the card across and along the ribbon; any field that is not a scalar crops nothing. */
  private readonly horizontalCropField: number;
  private readonly verticalCropField: number;
  private readonly maxLength: number;
  private readonly minLength: number;
  private readonly lengthScale: number;
  private readonly lengthFadeInTime: number;
  private readonly ignoreDeltaTime: boolean;
  private readonly constrainRadiusToLengthRatio: number;
  private readonly forwardShift: number;
  private readonly headRadiusTaper: NumberProvider;
  private readonly tailRadiusTaper: NumberProvider;
  private readonly headAlphaScale: NumberProvider;
  private readonly tailAlphaScale: NumberProvider;
  private readonly headColorScale: VectorProvider;
  private readonly tailColorScale: VectorProvider;
  /** Whether the visibility inputs scale the trail, which they do from behavior version 11. */
  private readonly appliesVisibility: boolean;

  // Evaluated with the particle inputs and uploaded with the draw, since they are the same for the whole system
  private headColor = Vector3.one;
  private tailColor = Vector3.one;

  private instances = new Float32Array(0);
  private instanceBuffer: THREE.InstancedInterleavedBuffer | null = null;
  private readonly colorScratch: Rgba = [0, 0, 0, 0];

  constructor(parse: ParticleDefinitionParser, context: ParticleRendererContext) {
    super(parse, context, DEFAULT_TEXTURE_NAME, 2);

    this.orientationType = parse.enum('m_nOrientationType', ParticleOrientation, ParticleOrientation.PARTICLE_ORIENTATION_SCREEN_ALIGNED);
    this.maxLength = parse.float('m_flMaxLength', 2000);
    this.minLength = parse.float('m_flMinLength', 0);
    this.lengthScale = parse.float('m_flLengthScale', 1);
    this.lengthFadeInTime = parse.float('m_flLengthFadeInTime', 0);
    this.ignoreDeltaTime = parse.boolean('m_bIgnoreDT', false);
    this.constrainRadiusToLengthRatio = parse.float('m_flConstrainRadiusToLengthRatio', 1);
    this.forwardShift = parse.float('m_flForwardShift', 0);
    this.enableFadingAndClamping = parse.boolean('m_bEnableFadingAndClamping', false);
    this.minSize = parse.float('m_flMinSize', 0);
    this.maxSize = parse.float('m_flMaxSize', 2000);
    this.startFadeSize = parse.numberProvider('m_flStartFadeSize', new LiteralNumberProvider(1000));
    this.endFadeSize = parse.numberProvider('m_flEndFadeSize', new LiteralNumberProvider(2000));
    let prevPositionSource = parse.particleField('m_nPrevPntSource', ParticleField.PositionPrevious);
    this.usesVerletDelta = prevPositionSource === ParticleField.PositionPrevious;

    // No source still reads the Verlet previous position, but as a plain point
    if (prevPositionSource < 0) {
      prevPositionSource = ParticleField.PositionPrevious;
    }

    this.prevPositionSource = prevPositionSource;
    this.flipUvByPitchYaw = parse.boolean('m_bFlipUVBasedOnPitchYaw', false);
    this.horizontalCropField = parse.particleField('m_nHorizCropField', ParticleField.NoneDisabled);
    this.verticalCropField = parse.particleField('m_nVertCropField', ParticleField.NoneDisabled);
    this.headRadiusTaper = parse.numberProvider('m_flRadiusHeadTaper', new LiteralNumberProvider(1));
    this.tailRadiusTaper = parse.numberProvider('m_flRadiusTaper', new LiteralNumberProvider(1));
    this.headAlphaScale = parse.numberProvider('m_flHeadAlphaScale', new LiteralNumberProvider(1));
    this.tailAlphaScale = parse.numberProvider('m_flTailAlphaScale', new LiteralNumberProvider(1));
    this.headColorScale = parse.vectorProvider('m_vecHeadColorScale', new LiteralVectorProvider(Vector3.one));
    this.tailColorScale = parse.vectorProvider('m_vecTailColorScale', new LiteralVectorProvider(Vector3.one));
    this.appliesVisibility = parse.behaviorVersion >= 11;
  }

  protected override createGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('vCornerId', new THREE.Float32BufferAttribute([0, 1, 2, 3], 1));
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.instanceCount = 0;
    return geometry;
  }

  /** The crop fields are read between two steps like the attributes every renderer blends. */
  override get blendedFields(): bigint {
    return super.blendedFields | scalarMask(this.horizontalCropField) | scalarMask(this.verticalCropField);
  }

  protected override updateVertices(particleBag: ParticleCollection, state: ParticleSystemState, view: RenderView): number {
    const scales = this.appliesVisibility ? this.evaluateScales(state, view) : this.evaluateScales(state);

    if (scales.radius === 0) {
      return 0;
    }

    const radiusScale = scales.radius < 0 ? 1 : scales.radius;

    // Converts the moved distance to a velocity (distance / dt) before scaling by the trail-length
    // attribute. The division only applies when the previous point is the Verlet one, and the operator
    // can opt out of it.
    const oneOverDt = this.ignoreDeltaTime || !this.usesVerletDelta || state.currentStep === 0 ? 1 : 1 / state.currentStep;

    const sorted = particleBag.count > 1;
    const current = ParticleSpritecardRenderer.getBlendedParticles(particleBag, state);
    const order = sorted ? ParticleSpritecardRenderer.sortBackToFront(current, view.location) : null;

    // Every input is evaluated for every particle before the loop, culled or not, in this order
    const tailRadiusTapers = this.tailRadiusTaper.fillNew(current, state);
    const headRadiusTapers = this.headRadiusTaper.fillNew(current, state);
    this.tailColor = this.tailColorScale.nextVector(state);
    const tailAlphaScales = this.tailAlphaScale.fillNew(current, state);
    this.headColor = this.headColorScale.nextVector(state);
    const headAlphaScales = this.headAlphaScale.fillNew(current, state);

    const positions = current.readVectors(ParticleField.Position);
    const previousPositions = current.readVectors(this.prevPositionSource);
    const normals = current.readVectors(ParticleField.Normal);
    const colors = current.readVectors(ParticleField.Color);
    const trailLengths = current.readFloats(ParticleField.TrailLength);
    const radii = current.readFloats(ParticleField.Radius);
    const alphas = current.readFloats(ParticleField.Alpha);
    const alpha2s = this.readAlpha2(current);
    const ages = current.readAges();
    const extraData1 = current.readFloats(ParticleField.ShaderExtraData1);
    const extraData2 = current.readFloats(ParticleField.ShaderExtraData2);
    const sequenceNumbers = current.readFloats(ParticleField.SequenceNumber);
    const sheetAges = this.readSheetAges(current);
    const randoms = ParticleSpritecardRenderer.readParticleRandoms(current, state);
    const yaws = this.flipUvByPitchYaw ? current.readFloats(ParticleField.Yaw) : null;
    const pitches = this.flipUvByPitchYaw ? current.readFloats(ParticleField.Pitch) : null;
    const horizontalCrops = isScalarField(this.horizontalCropField) ? current.readFloats(this.horizontalCropField) : null;
    const verticalCrops = isScalarField(this.verticalCropField) ? current.readFloats(this.verticalCropField) : null;

    const instances = this.reserve(current.length);
    let quadCount = 0;

    for (let n = 0; n < current.length; n++) {
      const index = order !== null ? order[n] : n;
      const position = this.biasTowardCamera(new Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]), view.location);
      const previousPosition = new Vector3(previousPositions[index * 3], previousPositions[index * 3 + 1], previousPositions[index * 3 + 2]);

      // A particle that has not moved has no direction to run in, so its control points collapse onto the position
      const difference = previousPosition.sub(position);
      const distance = Math.max(difference.length(), FLOAT_EPSILON);
      const direction = difference.scale(1 / distance);

      let length = this.lengthScale * trailLengths[index] * distance * oneOverDt;

      // A particle drawn before its birth, with a negative age, gets the minimum length
      length *= Math.min(1, ages[index] / Math.max(this.lengthFadeInTime, 1e-9));
      length = Math.max(this.minLength, Math.min(this.maxLength, length));

      // A short trail is narrowed so it cannot render wider than it is long
      const radius = Math.min(radii[index] * radiusScale, this.constrainRadiusToLengthRatio * length);
      const normal = new Vector3(normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2]);

      // The ribbon always runs along the motion; only the plane it is flattened into changes with the
      // orientation. Only ALIGN_TO_PARTICLE_NORMAL reads the particle's normal.
      let planeNormal: Vector3;

      switch (this.orientationType) {
        case ParticleOrientation.PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL:
          planeNormal = normal;
          break;
        case ParticleOrientation.PARTICLE_ORIENTATION_WORLD_Z_ALIGNED:
          planeNormal = Vector3.unitZ;
          break;
        default:
          planeNormal = view.location.sub(position);
      }

      const widthAxis = ParticleSpritecardRenderer.ribbonWidthAxis(direction, planeNormal);

      // Only the normal-aligned mode has a normal to fade by view angle with; the others substitute the
      // direction the ribbon runs in
      const facingAxis = this.orientationType === ParticleOrientation.PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL ? normal : direction;

      // The trail slides along the motion axis by m_flForwardShift lengths; direction runs backwards
      // along travel here, so the shift subtracts
      const center = position.add(direction.scale(length * (0.5 - this.forwardShift)));

      // Flipping and cropping scale the card coordinate about its centre; the geometry stays
      let uvScaleX = cropScale(horizontalCrops, index);
      let uvScaleY = cropScale(verticalCrops, index);

      if (yaws !== null && pitches !== null) {
        if (yaws[index] >= Math.fround(Math.PI)) {
          uvScaleX = -uvScaleX;
        }

        if (pitches[index] >= Math.fround(Math.PI)) {
          uvScaleY = -uvScaleY;
        }
      }

      const color = this.blendColor(colors[index * 3], colors[index * 3 + 1], colors[index * 3 + 2], alphas[index], alpha2s[index], scales, this.colorScratch);

      // Only the first layer plays the particle's sequence; the later ones play sequence 0
      const sequence = this.sequenceLane(sequenceNumbers[index], false);

      // The shader scales each end's colour and saturates it, then fades both ends by their own half
      // width and distance. The per particle modes read the tail's alpha and half width.
      const o = quadCount * TRAIL_INSTANCE_STRIDE;
      instances[o] = center.x;
      instances[o + 1] = center.y;
      instances[o + 2] = center.z;
      instances[o + 3] = saturate(color[3] * tailAlphaScales[index]);
      instances[o + 4] = color[0];
      instances[o + 5] = color[1];
      instances[o + 6] = color[2];
      instances[o + 7] = saturate(color[3] * headAlphaScales[index]);
      instances[o + 8] = uvScaleX;
      instances[o + 9] = uvScaleY;
      instances[o + 10] = widthAxis.x;
      instances[o + 11] = widthAxis.y;
      instances[o + 12] = widthAxis.z;
      instances[o + 13] = radius * headRadiusTapers[index];
      instances[o + 14] = direction.x * length * 0.5;
      instances[o + 15] = direction.y * length * 0.5;
      instances[o + 16] = direction.z * length * 0.5;
      instances[o + 17] = radius * tailRadiusTapers[index];
      instances[o + 18] = randoms[index];
      instances[o + 19] = extraData1[index];
      instances[o + 20] = sheetAges[index];
      instances[o + 21] = extraData2[index];
      instances[o + 22] = sequence;
      instances[o + 23] = 0;
      instances[o + 24] = facingAxis.x;
      instances[o + 25] = facingAxis.y;
      instances[o + 26] = facingAxis.z;
      quadCount++;
    }

    const geometry = this.mesh.geometry as THREE.InstancedBufferGeometry;
    geometry.instanceCount = quadCount;
    this.instanceBuffer!.addUpdateRange(0, quadCount * TRAIL_INSTANCE_STRIDE);
    this.instanceBuffer!.needsUpdate = true;
    return quadCount;
  }

  private reserve(count: number): Float32Array {
    if (this.instances.length >= count * TRAIL_INSTANCE_STRIDE && this.instanceBuffer !== null) {
      this.instanceBuffer.clearUpdateRanges();
      return this.instances;
    }

    const capacity = Math.max(16, 1 << Math.ceil(Math.log2(Math.max(count, 1))));
    this.instances = new Float32Array(capacity * TRAIL_INSTANCE_STRIDE);
    this.instanceBuffer = new THREE.InstancedInterleavedBuffer(this.instances, TRAIL_INSTANCE_STRIDE, 1);
    this.instanceBuffer.setUsage(THREE.DynamicDrawUsage);

    let offset = 0;

    for (const [name, size] of TRAIL_INSTANCE_LAYOUT) {
      this.mesh.geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.instanceBuffer, size, offset));
      offset += size;
    }

    return this.instances;
  }

  protected override setDrawUniforms(state: ParticleSystemState): void {
    // Both fade bounds are a radius per unit of camera distance, as the two size bounds are. Each end
    // is faded and clamped by its own constrained and tapered half width.
    this.setSizeClampAndFadeUniforms(this.enableFadingAndClamping, this.minSize, this.startFadeSize.nextNumber(state), this.endFadeSize.nextNumber(state), this.maxSize);

    // The view angle fade runs in every mode and outside the fade-and-clamp gate
    this.setViewAngleFadeUniforms(this.fadesByViewAngle);

    // A trail does not zoom between sheet frames
    (this.uniforms.uFrameZoom.value as THREE.Vector2).set(1, 1);

    (this.uniforms.uTrailHeadColorScale.value as THREE.Vector3).set(this.headColor.x, this.headColor.y, this.headColor.z);
    (this.uniforms.uTrailTailColorScale.value as THREE.Vector3).set(this.tailColor.x, this.tailColor.y, this.tailColor.z);

    super.setDrawUniforms(state);
  }
}

function scalarMask(field: number): bigint {
  return isScalarField(field) ? fieldMask(field) : 0n;
}

/** How much of the card coordinate a crop field leaves, which travels to the shader as a byte. */
function cropScale(crops: Float32Array | null, index: number): number {
  if (crops === null) {
    return 1;
  }

  const crop = Math.trunc(saturate(crops[index] * 0.5) * 255) / 255;
  return 1 - crop;
}

function saturate(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
