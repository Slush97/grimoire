// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/RenderOmni2Light.cs and the
// helpers it calls (SceneLight.ComputeConeSolidAngle, SceneLight.LinearBrightnessFromCandelas,
// ParticleColorBlend.ToWrappedBytes, EntityTransformHelper.ForwardDirectionToRotationMatrix).
//
// Renders an Omni2 light per particle. Up to m_nMaxAllowed particles get a light each, which follows
// its particle by id; particles past that wait for a light to come free. A point or sphere light is a
// three.js point light; a barn light is a spot light over its frustum (three.js has no barn light),
// with VRF's barn brightness. The skirt and the luminaire shape are kept on the state for hosts that
// light another way: three.js lights end smoothly at their distance where VRF's fade over the skirt.
// Light styles come from the map (VRF's scene light styles), so none is ever found here.

import * as THREE from 'three';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { Matrix4x4, Vector3, f32, safeNormalize } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';
import { applyColorBlend, convertColorScale, type Rgba } from './colorBlend';
import { ParticleLightUnitChoiceList, ParticleOmni2LightOrientationChoiceList, ParticleOmni2LightTypeChoiceList } from './enums';
import { LINEAR_BRIGHTNESS_DISTANCE, ParticleLightRenderer } from './lightRenderer';
import { safeNormalizeOr } from './renderRopes';
import { eulerAnglesToRotationMatrixRadians } from './renderSprites';

/** SceneLight.BrightnessPerCandela. */
const BRIGHTNESS_PER_CANDELA = f32(40 * Math.PI);

/** The smallest near size a barn light's frustum is given. */
const BARN_MINIMUM_NEAR_SIZE = 1.1920929e-7;

/** The largest one minus softness a barn light's frustum edges are given. */
const BARN_MAXIMUM_HARDNESS = 0.99999988;

/** SceneLight.LinearBrightnessFromCandelas. */
export function linearBrightnessFromCandelas(candelas: number): number {
  return (candelas * BRIGHTNESS_PER_CANDELA) / (LINEAR_BRIGHTNESS_DISTANCE * LINEAR_BRIGHTNESS_DISTANCE);
}

/** SceneLight.ComputeConeSolidAngle: the solid angle of a cone between its inner and outer angles, in degrees. */
export function computeConeSolidAngle(spotOuterAngle: number, spotInnerAngle: number): number {
  const outer = THREE.MathUtils.degToRad(Math.min(Math.max(spotOuterAngle, 1), 180));
  const inner = THREE.MathUtils.degToRad(Math.min(Math.max(spotInnerAngle, 0), spotOuterAngle));
  const averageCos = (Math.cos(outer) + Math.cos(inner)) * 0.5;
  return Math.min(2 * Math.PI * (1 - averageCos), 4 * Math.PI);
}

/** EntityTransformHelper.ForwardDirectionToRotationMatrix: forward, left and up rows, yaw pinned at the poles. */
export function forwardDirectionToRotationMatrix(direction: Vector3): Matrix4x4 {
  let forward: Vector3;
  let left: Vector3;
  let up: Vector3;
  const xyDist = Math.sqrt(direction.x * direction.x + direction.y * direction.y);

  if (xyDist <= 0.001) {
    if (direction.z > 0) {
      [forward, left, up] = [Vector3.unitZ, Vector3.unitY, Vector3.unitX.negate()];
    } else {
      [forward, left, up] = [Vector3.unitZ.negate(), Vector3.unitY, Vector3.unitX];
    }
  } else {
    forward = direction.scale(1 / direction.length());
    const flat = Math.sqrt(forward.x * forward.x + forward.y * forward.y);
    const cosYaw = forward.x / flat;
    const sinYaw = forward.y / flat;
    left = new Vector3(-sinYaw, cosYaw, 0);
    up = new Vector3(-forward.z * cosYaw, -forward.z * sinYaw, flat);
  }

  return new Matrix4x4([forward.x, forward.y, forward.z, 0, left.x, left.y, left.z, 0, up.x, up.y, up.z, 0, 0, 0, 0, 1]);
}

function createRotationX(radians: number): Matrix4x4 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return new Matrix4x4([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

/** ParticleColorBlend.ToWrappedBytes: bytes truncated without a clamp, so a channel past 1 wraps around. */
function wrappedByte(channel: number): number {
  const truncated = Math.trunc(Math.fround(channel * 255));
  return Number.isFinite(truncated) ? truncated & 0xff : 0;
}

/** The barn fields of a light's state (VRF's LightState with a barn's members). */
export interface BarnLightState {
  distanceSkirt: number;
  /** The near half size along X and Y, and one over the apex distance. */
  sizeParams: [number, number, number];
  shape: number;
  soft: [number, number];
}

export class RenderOmni2Light extends ParticleLightRenderer {
  private readonly lightType: number;
  private readonly colorBlend: VectorProvider;
  private readonly brightnessUnit: number;
  private readonly brightnessLumens: NumberProvider;
  private readonly brightnessCandelas: NumberProvider;
  private readonly luminaireRadius: NumberProvider;
  private readonly skirt: NumberProvider;
  private readonly range: NumberProvider;
  private readonly innerConeAngle: NumberProvider;
  private readonly outerConeAngle: NumberProvider;
  private readonly orientationType: number;
  /** The direction for the normal orientations, or null to read the particle's normal. */
  private readonly normal: VectorProvider | null;
  private readonly target: VectorProvider;
  private readonly lightStyleTime: NumberProvider;
  private readonly fieldOfView: NumberProvider;
  private readonly barnShape: NumberProvider;
  private readonly barnNearSizeX: NumberProvider;
  private readonly barnNearSizeY: NumberProvider;
  private readonly barnSoftX: NumberProvider;
  private readonly barnSoftY: NumberProvider;
  private readonly colorScratch: Rgba = [0, 0, 0, 0];

  /** The barn fields of the lights in use, by particle id, for hosts that draw barn lights themselves. */
  readonly barnStates = new Map<number, BarnLightState>();

  constructor(parse: ParticleDefinitionParser) {
    const lightType = parse.enum('m_nLightType', ParticleOmni2LightTypeChoiceList, ParticleOmni2LightTypeChoiceList.PARTICLE_OMNI2_LIGHT_TYPE_POINT);
    super(parse, lightType === ParticleOmni2LightTypeChoiceList.PARTICLE_OMNI2_LIGHT_TYPE_BARN);
    this.lightType = lightType;
    this.colorBlend = parse.vectorProvider('m_vColorBlend', new LiteralVectorProvider(Vector3.one));
    this.brightnessUnit = parse.enum('m_nBrightnessUnit', ParticleLightUnitChoiceList, ParticleLightUnitChoiceList.PARTICLE_LIGHT_UNIT_LUMENS);
    this.brightnessLumens = parse.numberProvider('m_flBrightnessLumens', new LiteralNumberProvider(1000));
    this.brightnessCandelas = parse.numberProvider('m_flBrightnessCandelas', new LiteralNumberProvider(1000));
    parse.boolean('m_bCastShadows', false);
    this.luminaireRadius = parse.numberProvider('m_flLuminaireRadius', new LiteralNumberProvider(1));
    this.skirt = parse.numberProvider('m_flSkirt', new LiteralNumberProvider(0.1));
    this.range = parse.numberProvider('m_flRange', new LiteralNumberProvider(512));
    this.innerConeAngle = parse.numberProvider('m_flInnerConeAngle', new LiteralNumberProvider(180));
    this.outerConeAngle = parse.numberProvider('m_flOuterConeAngle', new LiteralNumberProvider(180));
    this.orientationType = parse.enum('m_nOrientationType', ParticleOmni2LightOrientationChoiceList,
      ParticleOmni2LightOrientationChoiceList.PARTICLE_OMNI2_LIGHT_ORIENTATION_ROTATIONS);
    this.normal = 'm_vNormal' in parse.data ? parse.vectorProvider('m_vNormal', new LiteralVectorProvider(Vector3.zero)) : null;
    this.target = parse.vectorProvider('m_vTarget', new LiteralVectorProvider(Vector3.zero));
    // FindLightStyle: a named style (m_strLightStyle) comes from the map's scene, which has none here.
    // The default style time is the particle's age, which draws nothing and is never read.
    this.lightStyleTime = parse.numberProvider('m_flLightStyleTime', new LiteralNumberProvider(0));
    this.fieldOfView = parse.numberProvider('m_flFOVAngle', new LiteralNumberProvider(30));
    this.barnShape = parse.numberProvider('m_flBarnShape', new LiteralNumberProvider(1));
    this.barnNearSizeX = parse.numberProvider('m_flBarnNearSizeX', new LiteralNumberProvider(1));
    this.barnNearSizeY = parse.numberProvider('m_flBarnNearSizeY', new LiteralNumberProvider(1));
    this.barnSoftX = parse.numberProvider('m_flBarnSoftX', new LiteralNumberProvider(0.25));
    this.barnSoftY = parse.numberProvider('m_flBarnSoftY', new LiteralNumberProvider(0.25));
  }

  private get isBarn(): boolean {
    return this.lightType === ParticleOmni2LightTypeChoiceList.PARTICLE_OMNI2_LIGHT_TYPE_BARN;
  }

  /** Whether the light faces its target rather than a normal or the particle's angles. */
  private get targetsDirection(): boolean {
    return this.orientationType === ParticleOmni2LightOrientationChoiceList.PARTICLE_OMNI2_LIGHT_ORIENTATION_TARGET
      || this.orientationType === ParticleOmni2LightOrientationChoiceList.PARTICLE_OMNI2_LIGHT_ORIENTATION_TARGET_ROLL;
  }

  protected override updateLights(particles: ParticleCollection, state: ParticleSystemState): boolean {
    const current = particles.currentSpan;
    const particleIds = current.readIntegers(ParticleField.ParticleId);
    const positions = current.readVectors(ParticleField.Position);
    const particleNormals = current.readVectors(ParticleField.Normal);
    const colors = current.readVectors(ParticleField.Color);
    const alphas = current.readFloats(ParticleField.Alpha);
    const yaws = current.readFloats(ParticleField.Yaw);
    const pitches = current.readFloats(ParticleField.Pitch);
    const rolls = current.readFloats(ParticleField.Roll);

    // The colour blend is set up before the other inputs and read after them, so only an input drawing
    // per block draws after them
    const setUpColorBlend = this.colorBlend.drawsPerBlock ? Vector3.zero : this.colorBlend.nextVector(state);

    // Both brightness inputs are evaluated whichever unit is used, so the draws stay in this order
    const ranges = this.range.fillNew(current, state);
    const skirts = this.skirt.fillNew(current, state);
    // Evaluated for every light type so the random draws stay in order, though no light uses the radius
    this.luminaireRadius.fillNew(current, state);
    const innerAngles = this.innerConeAngle.fillNew(current, state);
    const outerAngles = this.outerConeAngle.fillNew(current, state);

    const lumens = this.brightnessLumens.fillNew(current, state);
    const candelas = this.brightnessCandelas.fillNew(current, state);
    const brightnesses = this.brightnessUnit === ParticleLightUnitChoiceList.PARTICLE_LIGHT_UNIT_CANDELAS ? candelas : lumens;
    // No light style is ever found (see the header), so the style times are evaluated and not read
    this.lightStyleTime.fillNew(current, state);

    const targets = this.target.prepare(current, state);
    const normals = this.normal !== null ? this.normal.prepare(current, state) : null;

    // The barn inputs are evaluated for every light type so the random draws stay in order
    const fieldsOfView = this.fieldOfView.fillNew(current, state);
    const barnShapes = this.barnShape.fillNew(current, state);
    const barnSoftsX = this.barnSoftX.fillNew(current, state);
    const barnSoftsY = this.barnSoftY.fillNew(current, state);
    const barnNearSizesX = this.barnNearSizeX.fillNew(current, state);
    const barnNearSizesY = this.barnNearSizeY.fillNew(current, state);

    const colorBlendValue = this.colorBlend.drawsPerBlock ? this.colorBlend.nextVector(state) : setUpColorBlend;
    const scale = convertColorScale(this.colorBlendType, [colorBlendValue.x, colorBlendValue.y, colorBlendValue.z]);
    const blend: Rgba = [scale[0], scale[1], scale[2], 1];

    let directionInput = this.normal;
    let directions = normals;

    if (this.targetsDirection) {
      directionInput = this.target;
      directions = targets;
    } else if (this.orientationType === ParticleOmni2LightOrientationChoiceList.PARTICLE_OMNI2_LIGHT_ORIENTATION_ROTATIONS) {
      directionInput = null;
    }

    let nextDirectionBlock = 0;
    this.barnStates.clear();

    for (let i = 0; i < current.length; i++) {
      const lightRange = ranges[i];
      const brightness = brightnesses[i];
      const slot = lightRange <= 0 || brightness === 0 ? null : this.lights.claim(particleIds[i]);

      if (slot === null) {
        continue;
      }

      // A direction input drawing per block of four draws for the first particle of a block that claims a light
      if (directionInput !== null && directions !== null && i >= nextDirectionBlock) {
        const { offset, block } = current.blockAt(i);
        directionInput.fillPerBlock(block, block.start & 3, state, directions.subarray(offset * 3));
        nextDirectionBlock = offset + block.length;
      }

      slot.touched = true;

      const particleColor: Rgba = [wrappedByte(colors[i * 3]), wrappedByte(colors[i * 3 + 1]), wrappedByte(colors[i * 3 + 2]), 255];
      const color = applyColorBlend(this.colorBlendType, particleColor, blend, this.colorScratch);

      const outerAngle = Math.min(Math.max(outerAngles[i], 0), 180);
      const innerAngle = Math.min(Math.max(innerAngles[i], 0), outerAngle);

      // Lumens are spread over the cone's solid angle
      let lightCandelas = brightness;

      if (this.brightnessUnit !== ParticleLightUnitChoiceList.PARTICLE_LIGHT_UNIT_CANDELAS) {
        lightCandelas /= computeConeSolidAngle(outerAngle, innerAngle);
      }

      const rotation = this.lightRotation(i, positions, particleNormals, pitches, yaws, rolls, directions);
      const direction = safeNormalizeOr(new Vector3(rotation.m[0], rotation.m[1], rotation.m[2]), Vector3.unitX);
      let linearBrightness = linearBrightnessFromCandelas(lightCandelas);
      let fallOff = skirts[i];
      let spotInner = innerAngle;
      let spotOuter = outerAngle;

      if (this.isBarn) {
        const nearSize: [number, number] = [Math.max(BARN_MINIMUM_NEAR_SIZE, barnNearSizesX[i]), Math.max(BARN_MINIMUM_NEAR_SIZE, barnNearSizesY[i])];

        // The near size is the frustum's half size at the light, and the field of view is the angle from
        // its axis to that edge along X, which places the apex behind the light
        const fieldOfView = THREE.MathUtils.degToRad(Math.min(Math.max(fieldsOfView[i], 0), 89));
        const inverseApexDistance = Math.tan(fieldOfView) / nearSize[0];
        const hardness = [1 - barnSoftsX[i], 1 - barnSoftsY[i]];
        const soft: [number, number] = [1 - Math.min(Math.max(hardness[0], 0), BARN_MAXIMUM_HARDNESS), 1 - Math.min(Math.max(hardness[1], 0), BARN_MAXIMUM_HARDNESS)];

        linearBrightness = this.barnLinearBrightness(brightness, nearSize, inverseApexDistance);
        // The skirt fades a barn light with distance from its apex over the last skirt fraction of its
        // range, as it fades a point light, rather than over the frustum's far depth
        fallOff = 0;
        this.barnStates.set(particleIds[i], { distanceSkirt: skirts[i], sizeParams: [nearSize[0], nearSize[1], inverseApexDistance], shape: barnShapes[i], soft });
        // three.js draws the frustum as a cone over its horizontal half angle
        spotOuter = THREE.MathUtils.radToDeg(fieldOfView) * 2;
        spotInner = spotOuter * Math.min(hardness[0], 1);
      }

      slot.state = {
        color: [color[0] / 255, color[1] / 255, color[2] / 255],
        linearBrightness,
        brightnessScale: Math.max(0, alphas[i]) * this.visibleAlpha,
        range: ranges[i] * this.visibleRadius,
        spotInnerAngle: spotInner,
        spotOuterAngle: spotOuter,
        // The sphere type's radius makes the light a sphere luminaire with its intensity scaled by 1/r^2,
        // which is not represented yet
        luminaireSize: 0,
        fallOff,
        position: new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]),
        direction: new THREE.Vector3(direction.x, direction.y, direction.z),
        tubeHalfLength: 0,
      };
    }

    return true;
  }

  /**
   * The light's frame, facing along its first row: the particle's angles, its normal or the way to its
   * target, the roll variants turning that about the facing direction by the particle's roll.
   */
  private lightRotation(index: number, positions: Float32Array, particleNormals: Float32Array, pitches: Float32Array, yaws: Float32Array,
    rolls: Float32Array, directions: Float32Array | null): Matrix4x4 {
    if (this.orientationType === ParticleOmni2LightOrientationChoiceList.PARTICLE_OMNI2_LIGHT_ORIENTATION_ROTATIONS) {
      return eulerAnglesToRotationMatrixRadians(pitches[index], yaws[index], rolls[index]);
    }

    const at = (values: Float32Array) => new Vector3(values[index * 3], values[index * 3 + 1], values[index * 3 + 2]);
    const direction = this.targetsDirection
      ? safeNormalizeOr(at(directions!).sub(at(positions)), Vector3.unitZ.negate())
      : safeNormalize(this.normal !== null ? at(directions!) : at(particleNormals));

    const frame = forwardDirectionToRotationMatrix(direction);

    return this.orientationType === ParticleOmni2LightOrientationChoiceList.PARTICLE_OMNI2_LIGHT_ORIENTATION_NORMAL_ROLL
      || this.orientationType === ParticleOmni2LightOrientationChoiceList.PARTICLE_OMNI2_LIGHT_ORIENTATION_TARGET_ROLL
      ? createRotationX(rolls[index]).multiply(frame)
      : frame;
  }

  /**
   * The linear brightness of a barn light. Its intensity is divided by the squared distance from the
   * frustum's apex to the light, and lumens are spread over the solid angle of the rectangular frustum
   * whatever its shape. The barn light scales that back up by the squared distance from its apex to the
   * brightness reference distance, which is divided out here.
   */
  private barnLinearBrightness(brightness: number, nearSize: [number, number], inverseApexDistance: number): number {
    const lumens = this.brightnessUnit !== ParticleLightUnitChoiceList.PARTICLE_LIGHT_UNIT_CANDELAS;
    const referenceDistanceSquared = LINEAR_BRIGHTNESS_DISTANCE * LINEAR_BRIGHTNESS_DISTANCE;

    if (inverseApexDistance <= 0) {
      const parallelCandelas = lumens ? brightness / (4 * nearSize[0] * nearSize[1]) : brightness;
      return linearBrightnessFromCandelas(parallelCandelas) * referenceDistanceSquared;
    }

    const apexDistance = 1 / inverseApexDistance;
    let candelas = brightness;

    if (lumens) {
      const diagonal = Math.sqrt(apexDistance * apexDistance + nearSize[0] * nearSize[0] + nearSize[1] * nearSize[1]);
      const solidAngle = 4 * Math.atan((nearSize[0] * nearSize[1]) / (apexDistance * diagonal));
      candelas /= solidAngle;
    }

    const referenceDistance = apexDistance + LINEAR_BRIGHTNESS_DISTANCE;
    return (linearBrightnessFromCandelas(candelas) * referenceDistanceSquared) / (referenceDistance * referenceDistance);
  }
}
