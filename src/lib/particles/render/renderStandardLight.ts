// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/RenderStandardLight.cs.
//
// Renders a standard point or spot light per particle. Up to m_nMaxAllowed particles with a positive
// intensity get a light each, which follows its particle by id and faces along its angles. A capsule
// light is a tube from the particle along its facing, toward the next particle of a chain, or back
// along the particle's trail.
//
// The old attenuation falls off as 1 / (q*d^2 + l*d) with l the falloff linearity and q = 1 - l,
// brightened by q*10000 + l*100, and the range is cut to where the light falls to a thousandth of its
// luminance. The new attenuation fits 1 / (c + l*d + q*d^2) through 1 at the light, 1/2 at
// m_flFiftyPercentFalloff and 1/256 at m_flZeroPercentFalloff, both as fractions of the range. Either
// curve is drawn as an inverse square falloff that matches it at a fraction of the range.

import * as THREE from 'three';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { Vector3 } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { safeNormalizeOr } from './renderRopes';
import { eulerAnglesToRotationMatrixRadians } from './renderSprites';
import { applyColorBlend, convertColorScale, type Rgba } from './colorBlend';
import { ParticleLightBehaviorChoiceList, ParticleLightTypeChoiceList, StandardLightingAttenuationStyle } from './enums';
import { LightFalloff } from './lightFalloff';
import { LINEAR_BRIGHTNESS_DISTANCE, ParticleLightRenderer } from './lightRenderer';

const LIGHT_FALL_OFF = 0.25;

/** The fraction of the range at which the inverse square falloff matches the light's own. */
const FALLOFF_MATCH_FRACTION = 0.15;

/** The distance at which the falloffs match for a light without a range. */
const FALLOFF_MATCH_DISTANCE_WITHOUT_RANGE = 100;

/** Attenuation terms below this are dropped. */
const MINIMUM_ATTENUATION_TERM = 0.001;

const MINIMUM_ZERO_PERCENT_FALLOFF = 1 / (1 << 22);
const FIFTY_PERCENT_FALLOFF_MARGIN = 1 / (1 << 23);

/** The shortest distance a trail capsule's moved distance is taken as. */
const MINIMUM_TRAIL_DISTANCE = 1.1920929e-7;

export class RenderStandardLight extends ParticleLightRenderer {
  private readonly lightType: number;
  private readonly attenuationStyle: number;
  private readonly intensity: NumberProvider;
  private readonly theta: NumberProvider;
  private readonly phi: NumberProvider;
  private readonly radiusMultiplier: NumberProvider;
  private readonly falloffLinearity: NumberProvider;
  private readonly fiftyPercentFalloff: NumberProvider;
  private readonly zeroPercentFalloff: NumberProvider;
  private readonly reverseOrder: boolean;
  private readonly capsuleBehavior: number;
  private readonly capsuleLength: number;
  private readonly closedLoop: boolean;
  private readonly previousPointSource: number;
  private readonly maxLength: number;
  private readonly minLength: number;
  private readonly ignoreDeltaTime: boolean;
  private readonly lengthScale: number;
  private readonly lengthFadeInTime: number;
  private readonly colorScratch: Rgba = [0, 0, 0, 0];

  constructor(parse: ParticleDefinitionParser) {
    const lightType = parse.enum('m_nLightType', ParticleLightTypeChoiceList, ParticleLightTypeChoiceList.PARTICLE_LIGHT_TYPE_POINT);
    super(parse, lightType === ParticleLightTypeChoiceList.PARTICLE_LIGHT_TYPE_SPOT);
    this.lightType = lightType;
    this.attenuationStyle = parse.enum('m_nAttenuationStyle', StandardLightingAttenuationStyle, StandardLightingAttenuationStyle.LIGHT_STYLE_OLD);
    this.intensity = parse.numberProvider('m_flIntensity', new LiteralNumberProvider(1));
    this.theta = parse.numberProvider('m_flTheta', new LiteralNumberProvider(45));
    this.phi = parse.numberProvider('m_flPhi', new LiteralNumberProvider(60));
    this.radiusMultiplier = parse.numberProvider('m_flRadiusMultiplier', new LiteralNumberProvider(8));
    this.falloffLinearity = parse.numberProvider('m_flFalloffLinearity', new LiteralNumberProvider(0));
    this.fiftyPercentFalloff = parse.numberProvider('m_flFiftyPercentFalloff', new LiteralNumberProvider(0.5));
    this.zeroPercentFalloff = parse.numberProvider('m_flZeroPercentFalloff', new LiteralNumberProvider(1));
    parse.boolean('m_bCastShadows', false);
    parse.boolean('m_bRenderDiffuse', true);
    parse.boolean('m_bRenderSpecular', true);
    this.reverseOrder = parse.boolean('m_bReverseOrder', false);
    this.capsuleBehavior = parse.enum(
      'm_nCapsuleLightBehavior',
      ParticleLightBehaviorChoiceList,
      ParticleLightBehaviorChoiceList.PARTICLE_LIGHT_BEHAVIOR_FOLLOW_DIRECTION,
    );
    this.capsuleLength = parse.float('m_flCapsuleLength', 100);
    this.closedLoop = parse.boolean('m_bClosedLoop', false);
    this.previousPointSource = parse.particleField('m_nPrevPntSource', ParticleField.PositionPrevious);
    this.maxLength = parse.float('m_flMaxLength', 2000);
    this.minLength = parse.float('m_flMinLength', 0);
    this.ignoreDeltaTime = parse.boolean('m_bIgnoreDT', false);
    this.lengthScale = parse.float('m_flLengthScale', 1);
    this.lengthFadeInTime = parse.float('m_flLengthFadeInTime', 0);

    // m_flConstrainRadiusToLengthRatio has no effect on the light
  }

  private get isCapsule(): boolean {
    return this.lightType === ParticleLightTypeChoiceList.PARTICLE_LIGHT_TYPE_CAPSULE;
  }

  protected override updateLights(particles: ParticleCollection, state: ParticleSystemState): boolean {
    if (particles.count === 0) {
      return true;
    }

    const radiusScale = this.radiusMultiplier.nextNumber(state);

    if (radiusScale === 0) {
      return false;
    }

    const authored = this.colorScale.nextVector(state);
    const scale = convertColorScale(this.colorBlendType, [authored.x, authored.y, authored.z]);
    const colorScale: Rgba = [scale[0], scale[1], scale[2], 1];
    const spot = this.lightType === ParticleLightTypeChoiceList.PARTICLE_LIGHT_TYPE_SPOT;
    const cone = spot ? { inner: this.theta.nextNumber(state), outer: this.phi.nextNumber(state) } : { inner: 0, outer: 180 };

    const newAttenuation = this.attenuationStyle === StandardLightingAttenuationStyle.LIGHT_STYLE_NEW;
    const zeroPercent = Math.max(this.zeroPercentFalloff.nextNumber(state), MINIMUM_ZERO_PERCENT_FALLOFF);
    const fiftyPercent = Math.min(Math.max(this.fiftyPercentFalloff.nextNumber(state), FIFTY_PERCENT_FALLOFF_MARGIN), zeroPercent - FIFTY_PERCENT_FALLOFF_MARGIN);
    const old = this.oldAttenuation(this.falloffLinearity.nextNumber(state));

    const current = particles.currentSpan;
    const particleIds = current.readIntegers(ParticleField.ParticleId);
    const positions = current.readVectors(ParticleField.Position);
    const colors = current.readVectors(ParticleField.Color);
    const radii = current.readFloats(ParticleField.Radius);
    const alphas = current.readFloats(ParticleField.Alpha);
    const yaws = current.readFloats(ParticleField.Yaw);
    const pitches = current.readFloats(ParticleField.Pitch);
    const rolls = current.readFloats(ParticleField.Roll);
    const intensities = this.intensity.fillNew(current, state);

    // A trail runs back to the previous position whatever m_nPrevPntSource names, which only decides
    // whether its length is scaled by the step
    const trails = this.isCapsule && this.capsuleBehavior === ParticleLightBehaviorChoiceList.PARTICLE_LIGHT_BEHAVIOR_TRAILS;
    const previousPositions = trails ? current.readVectors(ParticleField.PositionPrevious) : null;
    const trailLengths = trails ? current.readFloats(ParticleField.TrailLength) : null;
    const ages = trails ? current.readAges() : null;
    const trailLengthScale = this.lengthScale * this.trailDeltaTimeScale(state);
    const lengthFadeInRate = 1 / Math.max(this.lengthFadeInTime, 1e-9);
    const position = (i: number) => new Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);

    for (let n = 0; n < current.length; n++) {
      const brightness = intensities[n];

      if (brightness <= 0) {
        continue;
      }

      const index = this.reverseOrder ? current.length - 1 - n : n;
      const slot = this.lights.claim(particleIds[index]);

      if (slot === null || radii[index] === 0 || alphas[index] === 0) {
        continue;
      }

      slot.touched = true;

      const rope = this.isCapsule && this.capsuleBehavior === ParticleLightBehaviorChoiceList.PARTICLE_LIGHT_BEHAVIOR_ROPE;
      const neighbour = rope ? this.ropeNeighbour(n, current.length) : index;

      // A rope capsule takes its colour from the particle it runs to
      const bytes: Rgba = [wrappedByte(colors[neighbour * 3]), wrappedByte(colors[neighbour * 3 + 1]), wrappedByte(colors[neighbour * 3 + 2]), 255];
      const color = applyColorBlend(this.colorBlendType, bytes, colorScale, this.colorScratch).map((c) => roundHalfEven(c) / 255);
      const rgb: [number, number, number] = [color[0], color[1], color[2]];
      const rotation = eulerRows(pitches[index], yaws[index], rolls[index]);
      let range = radiusScale * radii[index];

      let falloff: LightFalloff;
      let brightnessScale: number;

      if (newAttenuation) {
        falloff = LightFalloff.solve(fiftyPercent * range, zeroPercent * range);
        brightnessScale = 1;
      } else {
        falloff = old.falloff;
        brightnessScale = old.brightnessScale;

        const linear = srgbGammaToLinear(rgb).map((c) => c * (brightness * alphas[index] * brightnessScale)) as [number, number, number];
        const cutoff = falloff.cutoffFor(linear);

        if (cutoff.range > 0) {
          range = range > 0 ? Math.min(range, cutoff.range) : cutoff.range;
        }
      }

      const matchDistance = range > 0 ? range * FALLOFF_MATCH_FRACTION : FALLOFF_MATCH_DISTANCE_WITHOUT_RANGE;
      const matchBrightness = (brightness * brightnessScale) / falloff.denominator(matchDistance);
      const linearBrightness = (matchBrightness * (matchDistance * matchDistance)) / (LINEAR_BRIGHTNESS_DISTANCE * LINEAR_BRIGHTNESS_DISTANCE);

      let lightPosition = position(index);
      let tubeHalfLength = 0;
      let luminaireSize = radii[index] * radiusScale;

      if (this.isCapsule) {
        // The tube runs from the particle to the end of this axis
        let axis: Vector3;

        switch (this.capsuleBehavior) {
          case ParticleLightBehaviorChoiceList.PARTICLE_LIGHT_BEHAVIOR_ROPE:
            // The axis to the next particle is normalized, so a rope tube is one unit long however far
            // apart its particles are
            axis = safeNormalizeOr(position(neighbour).sub(position(index)), Vector3.unitZ);
            luminaireSize = 0.5 * (radii[index] + radii[neighbour]) * radiusScale;
            break;
          case ParticleLightBehaviorChoiceList.PARTICLE_LIGHT_BEHAVIOR_TRAILS: {
            const toPrevious = new Vector3(previousPositions![index * 3], previousPositions![index * 3 + 1], previousPositions![index * 3 + 2]).sub(position(index));
            const distance = Math.max(toPrevious.length(), MINIMUM_TRAIL_DISTANCE);
            const fadeIn = Math.min(1, ages![index] * lengthFadeInRate);
            const length = Math.max(this.minLength, Math.min(this.maxLength, fadeIn * (trailLengthScale * trailLengths![index] * distance)));
            axis = toPrevious.scale(length / distance);
            break;
          }
          default:
            axis = rotation[0].scale(this.capsuleLength);
        }

        lightPosition = position(index).add(axis.scale(0.5));
        tubeHalfLength = axis.length() * 0.5;
      }

      const direction = safeNormalizeOr(rotation[0], Vector3.unitX);

      slot.state = {
        color: rgb,
        linearBrightness,
        brightnessScale: alphas[index],
        range,
        spotInnerAngle: cone.inner,
        spotOuterAngle: cone.outer,
        luminaireSize,
        fallOff: LIGHT_FALL_OFF,
        position: new THREE.Vector3(lightPosition.x, lightPosition.y, lightPosition.z),
        direction: new THREE.Vector3(direction.x, direction.y, direction.z),
        tubeHalfLength,
      };
    }

    return true;
  }

  /**
   * The particle a rope capsule runs to from the one `n` places along the walk: the next one, wrapping
   * to the first on a closed loop and staying on itself at the open end.
   */
  private ropeNeighbour(n: number, count: number): number {
    let next = n + 1;

    if (next === count) {
      next = this.closedLoop ? 0 : n;
    }

    return this.reverseOrder ? count - 1 - next : next;
  }

  /** Turns a trail's moved distance into a velocity when its previous point is the one the step moved from, unless the renderer opts out. */
  private trailDeltaTimeScale(state: ParticleSystemState): number {
    if (this.previousPointSource !== ParticleField.PositionPrevious || this.ignoreDeltaTime || state.currentStep === 0) {
      return 1;
    }

    return 1 / state.currentStep;
  }

  /**
   * The old attenuation for a falloff linearity, and the brightness scale that goes with it. Terms too
   * small to matter are dropped, and a light left without any falls off not at all.
   */
  private oldAttenuation(linearity: number): { falloff: LightFalloff; brightnessScale: number } {
    let linear = this.lightType === ParticleLightTypeChoiceList.PARTICLE_LIGHT_TYPE_FX ? 1 : Math.min(Math.max(linearity, 0), 1);
    let quadratic = 1 - linear;
    let constant = 0;

    if (linear < MINIMUM_ATTENUATION_TERM) {
      linear = 0;
    }

    if (quadratic < MINIMUM_ATTENUATION_TERM) {
      quadratic = 0;
    }

    if (linear === 0 && quadratic === 0) {
      constant = 1;
    }

    return { falloff: new LightFalloff(constant, linear, quadratic), brightnessScale: quadratic * 10000 + linear * 100 + constant };
  }
}

/** The rows of EntityTransformHelper.EulerAnglesToRotationMatrixRadians: forward, left, up. */
function eulerRows(pitch: number, yaw: number, roll: number): [Vector3, Vector3, Vector3] {
  const m = eulerAnglesToRotationMatrixRadians(pitch, yaw, roll).m;
  return [new Vector3(m[0], m[1], m[2]), new Vector3(m[4], m[5], m[6]), new Vector3(m[8], m[9], m[10])];
}

function srgbGammaToLinear(c: [number, number, number]): number[] {
  return c.map((x) => (x > 0.04045 ? Math.pow(x / 1.055 + 0.0521327, 2.4) : x / 12.92));
}

function wrappedByte(channel: number): number {
  const truncated = Math.trunc(Math.fround(channel * 255));
  return Number.isFinite(truncated) ? truncated & 0xff : 0;
}

function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  return diff > 0.5 || (diff === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
}

