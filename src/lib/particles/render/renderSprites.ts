// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/RenderSprites.cs.
//
// Renders particles as camera-facing or orientation-aligned textured quads (sprites), with support for
// sprite sheet animation, blend modes, and per-particle color and alpha. The workhorse renderer used by
// most effects.

import * as THREE from 'three';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { Matrix4x4, Vector3, cross, normalize, transformNormal } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { MINIMUM_LENGTH_SQUARED } from '../utils/particleMath';
import { createFromAxisAngle } from '../utils/vectorMath';
import type { Rgba } from './colorBlend';
import type { ParticleRendererContext } from './context';
import { ParticleAnimationType, ParticleOrientation } from './enums';
import { ParticleSpritecardRenderer, NO_EDGE_SOFTNESS } from './spritecardRenderer';
import type { RenderView } from './view';

const DEFAULT_TEXTURE_NAME = 'materials/particle/base_sprite.vtex';

/** One particle's attributes, which the shader expands into the four corners of its card. */
const CARD_INSTANCE_LAYOUT = [
  ['vPOSITION', 3],
  ['vAxisU', 3],
  ['vAxisV', 3],
  ['vCOLOR', 4],
  ['vTEXCOORD', 4],
  ['vTEXCOORD1', 2],
  ['vTEXCOORD3', 4],
  ['vNORMAL', 3],
] as const;

const CARD_INSTANCE_STRIDE = CARD_INSTANCE_LAYOUT.reduce((sum, [, size]) => sum + size, 0);

type Basis = [Vector3, Vector3];

/**
 * The quad's (right, up) axes from a base pair with the particle roll folded in, matching the
 * spritecard vertex shader. The axes are intentionally not re-normalized (some modes rely on that,
 * e.g. SCREEN_Z foreshortens as the camera tilts).
 */
export function quadBasis(baseRight: Vector3, baseUp: Vector3, roll: number, yaw: number): Basis {
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  let right = baseRight.scale(c).add(baseUp.scale(s));
  const up = baseUp.scale(c).sub(baseRight.scale(s));

  // Yaw turns the card about its own up axis, foreshortening it horizontally to nothing at 90
  // degrees. Only the right axis is turned, and the axis is normalized without touching up.
  if (yaw !== 0 && up.lengthSquared() > MINIMUM_LENGTH_SQUARED) {
    right = transformNormal(right, createFromAxisAngle(normalize(up), yaw));
  }

  return [right, up];
}

/** EntityTransformHelper.EulerAnglesToRotationMatrixRadians: roll about X, then pitch about Y, then yaw about Z. */
export function eulerAnglesToRotationMatrixRadians(pitch: number, yaw: number, roll: number): Matrix4x4 {
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const rollMatrix = new Matrix4x4([1, 0, 0, 0, 0, cr, sr, 0, 0, -sr, cr, 0, 0, 0, 0, 1]);
  const pitchMatrix = new Matrix4x4([cp, 0, -sp, 0, 0, 1, 0, 0, sp, 0, cp, 0, 0, 0, 0, 1]);
  const yawMatrix = new Matrix4x4([cy, sy, 0, 0, -sy, cy, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return rollMatrix.multiply(pitchMatrix).multiply(yawMatrix);
}

function rotationBasis(rotation: Matrix4x4): Basis {
  const m = rotation.m;
  return [new Vector3(m[0], m[1], m[2]), new Vector3(m[4], m[5], m[6])];
}

/** SCREEN_ALIGNED: the plain camera billboard, built from the camera's own right and up axes. */
export function screenAlignedBasis(view: RenderView, roll: number, yaw: number): Basis {
  return quadBasis(view.right, view.up, roll, yaw);
}

/**
 * SCREEN_Z_ALIGNED: up locked to world +Z, right = cross(worldZ, forward) left un-normalized, so the
 * sprite yaws about vertical to face the camera and foreshortens as the view tilts off-horizontal.
 */
export function screenZAlignedBasis(view: RenderView, roll: number, yaw: number): Basis {
  return quadBasis(cross(Vector3.unitZ, view.forward), Vector3.unitZ, roll, yaw);
}

/** WORLD_Z_ALIGNED: the quad lies flat in the world XY plane (normal = +Z), rolling about vertical. */
export function worldZAlignedBasis(roll: number, yaw: number): Basis {
  return quadBasis(new Vector3(0, -1, 0), new Vector3(1, 0, 0), roll, yaw);
}

/**
 * ALIGN_TO_PARTICLE_NORMAL: quad plane perpendicular to the particle normal. The reference axis is
 * world -Y once the normal tilts at all off horizontal, and world +Z only while it is nearly horizontal.
 */
export function particleNormalBasis(normal: Vector3, roll: number, yaw: number): Basis {
  const reference = Math.abs(normal.z) > 0.1 ? new Vector3(0, -1, 0) : new Vector3(0, 0, 1);
  const up = normalize(cross(normal, reference));
  const right = cross(up, normal);
  return quadBasis(right, up, roll, yaw);
}

/**
 * SCREENALIGN_TO_PARTICLE_NORMAL: the quad's right edge follows the particle normal while it turns
 * toward the camera about that normal. Falls back to a billboard when the normal points at the camera.
 */
export function screenAlignToNormalBasis(view: RenderView, normal: Vector3, roll: number, yaw: number): Basis {
  const n = normalize(normal);
  const w = cross(n, view.forward);

  if (w.lengthSquared() < MINIMUM_LENGTH_SQUARED) {
    return [view.right, view.up];
  }

  return quadBasis(n, normalize(w), roll, yaw);
}

export class RenderSprites extends ParticleSpritecardRenderer {
  private readonly minSize: NumberProvider;
  private readonly maxSize: NumberProvider;
  private readonly startFadeSize: NumberProvider;
  private readonly endFadeSize: NumberProvider;
  /** Selects the signed distance field alpha treatment, which drives soft edges and outlines. */
  private readonly distanceAlpha: boolean;
  private readonly softEdges: boolean;
  private readonly edgeSoftnessStart: number;
  private readonly edgeSoftnessEnd: number;
  private readonly orientationType: number;
  private readonly useYawWithNormalAligned: boolean;
  private readonly sequenceOverride: NumberProvider;
  private readonly sequenceNumbersAreRawIndices: boolean;
  private readonly outline: boolean;
  private readonly outlineColor = new THREE.Vector4(1, 1, 1, 1);
  // Start0, End0, Start1, End1: the order the shader's two-sided ramp wants them in
  private readonly outlineRanges = new THREE.Vector4(0.5, 0.7, 0.6, 0.8);

  private instances = new Float32Array(0);
  private instanceBuffer: THREE.InstancedInterleavedBuffer | null = null;
  private readonly colorScratch: Rgba = [0, 0, 0, 0];

  constructor(parse: ParticleDefinitionParser, context: ParticleRendererContext) {
    super(parse, context, DEFAULT_TEXTURE_NAME, 1);

    // Older definitions play their sheets by age whatever their animation type asks, while the rate is
    // still read by that type
    if (parse.behaviorVersion < 10) {
      this.ageAnimationType = ParticleAnimationType.ANIMATION_TYPE_FIXED_RATE;
    }

    this.orientationType = Math.min(
      Math.max(parse.enum('m_nOrientationType', ParticleOrientation, ParticleOrientation.PARTICLE_ORIENTATION_SCREEN_ALIGNED), ParticleOrientation.PARTICLE_ORIENTATION_SCREEN_ALIGNED),
      ParticleOrientation.PARTICLE_ORIENTATION_FULL_3AXIS_ROTATION,
    );
    this.useYawWithNormalAligned = parse.boolean('m_bUseYawWithNormalAligned', false);
    this.sequenceOverride = parse.numberProvider('m_nSequenceOverride', new LiteralNumberProvider(-1));
    this.sequenceNumbersAreRawIndices = parse.boolean('m_bSequenceNumbersAreRawSequenceIndices', false);
    this.minSize = parse.numberProvider('m_flMinSize', new LiteralNumberProvider(0));
    this.maxSize = parse.numberProvider('m_flMaxSize', new LiteralNumberProvider(5000));
    this.startFadeSize = parse.numberProvider('m_flStartFadeSize', new LiteralNumberProvider(100000000));
    this.endFadeSize = parse.numberProvider('m_flEndFadeSize', new LiteralNumberProvider(200000000));
    this.distanceAlpha = parse.boolean('m_bDistanceAlpha', false);
    this.softEdges = parse.boolean('m_bSoftEdges', false);
    this.edgeSoftnessStart = parse.float('m_flEdgeSoftnessStart', 0.6);
    this.edgeSoftnessEnd = parse.float('m_flEdgeSoftnessEnd', 0.5);

    // TODO: m_bParticleShadows and m_flShadowDensity, where sprites are shaded by the particles between
    // them and the light, are not drawn

    this.outline = parse.boolean('m_bOutline', false);

    if (this.outline) {
      const color = srgbGammaToLinear(parse.color24('m_OutlineColor', new Vector3(1, 1, 1)));
      this.outlineColor.set(color.x, color.y, color.z, parse.int32('m_nOutlineAlpha', 255) / 255);
      this.outlineRanges.set(
        parse.float('m_flOutlineStart0', this.outlineRanges.x),
        parse.float('m_flOutlineEnd0', this.outlineRanges.y),
        parse.float('m_flOutlineStart1', this.outlineRanges.z),
        parse.float('m_flOutlineEnd1', this.outlineRanges.w),
      );
    }
  }

  protected override createGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('vCornerId', new THREE.Float32BufferAttribute([0, 1, 2, 3], 1));
    // The strip 0 1 2 3 as two triangles sharing the 1-2 edge
    geometry.setIndex([0, 1, 2, 2, 1, 3]);
    geometry.instanceCount = 0;
    return geometry;
  }

  private get normalAligned(): boolean {
    return (
      this.orientationType === ParticleOrientation.PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL ||
      this.orientationType === ParticleOrientation.PARTICLE_ORIENTATION_SCREENALIGN_TO_PARTICLE_NORMAL
    );
  }

  protected override updateVertices(particles: ParticleCollection, state: ParticleSystemState, view: RenderView): number {
    const scales = this.evaluateScales(state, view);

    if (scales.radius === 0 || scales.alpha === 0) {
      return 0;
    }

    const overrideSequence = this.overrideSequence(this.sequenceOverride.nextNumber(state));
    const zeroYaw = this.normalAligned && !this.useYawWithNormalAligned;
    const current = ParticleSpritecardRenderer.getBlendedParticles(particles, state);
    const sorted = this.sortsByDistance && particles.count > 1;
    const order = sorted ? ParticleSpritecardRenderer.sortBackToFront(current, view.location) : null;

    const positions = current.readVectors(ParticleField.Position);
    const normals = current.readVectors(ParticleField.Normal);
    const colors = current.readVectors(ParticleField.Color);
    const radii = current.readFloats(ParticleField.Radius);
    const alphas = current.readFloats(ParticleField.Alpha);
    const alpha2s = this.readAlpha2(current);
    const rolls = current.readFloats(ParticleField.Roll);
    const yaws = current.readFloats(ParticleField.Yaw);
    const pitches = current.readFloats(ParticleField.Pitch);
    const extraData1 = current.readFloats(ParticleField.ShaderExtraData1);
    const extraData2 = current.readFloats(ParticleField.ShaderExtraData2);
    const sequenceNumbers = current.readFloats(ParticleField.SequenceNumber);
    const secondSequenceNumbers = current.readFloats(ParticleField.SecondSequenceNumber);
    const sheetAges = this.readSheetAges(current);
    const randoms = ParticleSpritecardRenderer.readParticleRandoms(current, state);

    const instances = this.reserve(current.length);
    let i = 0;

    for (let n = 0; n < current.length; n++) {
      const index = order !== null ? order[n] : current.length - 1 - n;

      // Each tint channel is packed from the low byte of round(tint * 255) without a clamp, so a tint
      // past 1 or below 0 wraps; it is saturated here
      const color = this.blendColor(colors[index * 3], colors[index * 3 + 1], colors[index * 3 + 2], alphas[index], alpha2s[index], scales, this.colorScratch);

      // The fades only take alpha away, and the shader collapses a card left below 1/255
      if (color[3] < 1 / 255) {
        continue;
      }

      // Per-mode quad orientation, as in the spritecard vertex shader. Every mode folds in roll and yaw
      // and none of them read pitch; only FULL_3AXIS_ROTATION uses the full basis.
      const roll = rolls[index] * scales.roll;
      const yaw = zeroYaw ? 0 : yaws[index];
      const normal = new Vector3(normals[index * 3], normals[index * 3 + 1], normals[index * 3 + 2]);
      let basis: Basis;

      switch (this.orientationType) {
        case ParticleOrientation.PARTICLE_ORIENTATION_SCREEN_ALIGNED:
          basis = screenAlignedBasis(view, roll, yaw);
          break;
        case ParticleOrientation.PARTICLE_ORIENTATION_SCREEN_Z_ALIGNED:
          basis = screenZAlignedBasis(view, roll, yaw);
          break;
        case ParticleOrientation.PARTICLE_ORIENTATION_WORLD_Z_ALIGNED:
          basis = worldZAlignedBasis(roll, yaw);
          break;
        case ParticleOrientation.PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL:
          basis = particleNormalBasis(normal, roll, yaw);
          break;
        case ParticleOrientation.PARTICLE_ORIENTATION_SCREENALIGN_TO_PARTICLE_NORMAL:
          basis = screenAlignToNormalBasis(view, normal, roll, yaw);
          break;
        default:
          basis = rotationBasis(eulerAnglesToRotationMatrixRadians(pitches[index], yaw, roll));
      }

      const radius = radii[index] * scales.radius;
      const firstSequence = overrideSequence >= 0 ? overrideSequence : this.sequenceLane(sequenceNumbers[index], this.sequenceNumbersAreRawIndices);
      const laterSequence = overrideSequence >= 0 ? overrideSequence : this.sequenceLane(secondSequenceNumbers[index], this.sequenceNumbersAreRawIndices);
      const position = this.biasTowardCamera(new Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]), view.location);

      // The per particle modes read the yaw as the card turns by it
      const o = i * CARD_INSTANCE_STRIDE;
      instances[o] = position.x;
      instances[o + 1] = position.y;
      instances[o + 2] = position.z;
      instances[o + 3] = basis[0].x;
      instances[o + 4] = basis[0].y;
      instances[o + 5] = basis[0].z;
      instances[o + 6] = basis[1].x;
      instances[o + 7] = basis[1].y;
      instances[o + 8] = basis[1].z;
      instances[o + 9] = color[0];
      instances[o + 10] = color[1];
      instances[o + 11] = color[2];
      instances[o + 12] = color[3];
      instances[o + 13] = randoms[index];
      instances[o + 14] = extraData1[index];
      instances[o + 15] = sheetAges[index];
      instances[o + 16] = extraData2[index];
      instances[o + 17] = firstSequence;
      instances[o + 18] = laterSequence;
      instances[o + 19] = roll;
      instances[o + 20] = yaw;
      instances[o + 21] = pitches[index];
      instances[o + 22] = radius;
      instances[o + 23] = normal.x;
      instances[o + 24] = normal.y;
      instances[o + 25] = normal.z;
      i++;
    }

    const geometry = this.mesh.geometry as THREE.InstancedBufferGeometry;
    geometry.instanceCount = i;
    this.instanceBuffer!.needsUpdate = true;
    this.instanceBuffer!.addUpdateRange(0, i * CARD_INSTANCE_STRIDE);
    return i;
  }

  /** The instance array, grown to hold `count` cards. */
  private reserve(count: number): Float32Array {
    if (this.instances.length >= count * CARD_INSTANCE_STRIDE && this.instanceBuffer !== null) {
      this.instanceBuffer.clearUpdateRanges();
      return this.instances;
    }

    const capacity = Math.max(16, 1 << Math.ceil(Math.log2(Math.max(count, 1))));
    this.instances = new Float32Array(capacity * CARD_INSTANCE_STRIDE);
    this.instanceBuffer = new THREE.InstancedInterleavedBuffer(this.instances, CARD_INSTANCE_STRIDE, 1);
    this.instanceBuffer.setUsage(THREE.DynamicDrawUsage);

    const geometry = this.mesh.geometry;
    let offset = 0;

    for (const [name, size] of CARD_INSTANCE_LAYOUT) {
      geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.instanceBuffer, size, offset));
      offset += size;
    }

    return this.instances;
  }

  protected override setDrawUniforms(state: ParticleSystemState): void {
    // TODO: Which flag gates the size clamp and the distance fade of a card is not known. A screen-space
    // card keeps its raw radius, neither faded nor clamped
    this.setSizeClampAndFadeUniforms(
      true,
      this.minSize.nextNumber(state),
      this.startFadeSize.nextNumber(state),
      this.endFadeSize.nextNumber(state),
      this.maxSize.nextNumber(state),
    );

    // Only the two normal-aligned modes fade by view angle
    this.setViewAngleFadeUniforms(this.normalAligned && this.fadesByViewAngle);

    (this.uniforms.uCenterOffset.value as THREE.Vector2).set(this.centerXOffset.nextNumber(state), this.centerYOffset.nextNumber(state));

    this.uniforms.uOutline.value = this.outline;
    (this.uniforms.uOutlineColor.value as THREE.Vector4).copy(this.outlineColor);
    (this.uniforms.uOutlineRanges.value as THREE.Vector4).copy(this.outlineRanges);

    // Distance alpha with soft edges renders an SDF texture through a smoothstep over the edge softness pair
    const edgeSoftness = this.uniforms.uEdgeSoftness.value as THREE.Vector2;

    if (this.distanceAlpha && this.softEdges) {
      edgeSoftness.set(this.edgeSoftnessEnd, this.edgeSoftnessStart);
    } else {
      edgeSoftness.copy(NO_EDGE_SOFTNESS);
    }
  }
}

/** ColorSpace.SrgbGammaToLinear. */
function srgbGammaToLinear(color: Vector3): Vector3 {
  const channel = (c: number) => (c > 0.04045 ? Math.pow(c / 1.055 + 0.0521327, 2.4) : c / 12.92);
  return new Vector3(channel(color.x), channel(color.y), channel(color.z));
}
