// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Constraints/WorldTraceConstraint.cs.

import { readVector, writeVector } from '../buffer';
import { type ParticleCollection } from '../collection';
import { ParticleField, ParticleEventType, ParticleCollisionMode } from '../enums';
import { fieldMask, isVectorField } from '../fields';
import { ParticleFunctionConstraint } from '../functions';
import { Vector3, f32, safeNormalize, distance, distanceSquared } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import { type ParticleDefinitionParser } from '../parser';
import { type ParticleSystemState } from '../state';
import { FLOAT_EPSILON } from '../utils/particleMath';
import { CollisionPlaneSet } from './collisionPlaneSet';
import { reflect } from '../utils/vectorMath';

export class WorldTraceConstraint extends ParticleFunctionConstraint {
  private readonly controlPoint: number;
  private readonly controlPointOffset: Vector3;
  private readonly collisionMode: number;
  private readonly collisionModeMin: number;
  private readonly controlPointMovementTolerance: number;
  private readonly retestRate: number;
  private readonly confirmationSpeed: number;
  private readonly maxConfirmationTraces: number;
  private readonly radiusScale: NumberProvider;
  private readonly bounceAmount: NumberProvider;
  private readonly slideAmount: NumberProvider;
  private readonly randomDirectionScale: NumberProvider;
  private readonly decayBounce: boolean;
  private readonly killOnContact: boolean;
  private readonly minimumSpeed: number;
  private readonly bounceKilledParticles: boolean;
  private readonly setNormal: boolean;
  private readonly stickField: number;
  private readonly stopSpeed: NumberProvider;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.controlPoint = parse.int32('m_nCP', 0);
    this.controlPointOffset = parse.vector3('m_vecCpOffset', Vector3.zero);
    this.collisionMode = parse.enum('m_nCollisionMode', ParticleCollisionMode, ParticleCollisionMode.COLLISION_MODE_PER_PARTICLE_TRACE);
    this.collisionModeMin = Math.min(parse.enum('m_nCollisionModeMin', ParticleCollisionMode, ParticleCollisionMode.COLLISION_MODE_DISABLED), this.collisionMode);
    this.controlPointMovementTolerance = parse.float('m_flCpMovementTolerance', 5);
    this.retestRate = parse.float('m_flRetestRate', -1);
    this.confirmationSpeed = parse.float('m_flCollisionConfirmationSpeed', 24);
    this.maxConfirmationTraces = parse.int32('m_nMaxTracesPerFrame', -1);
    this.radiusScale = parse.numberProvider('m_flRadiusScale', new LiteralNumberProvider(1));
    this.bounceAmount = parse.numberProvider('m_flBounceAmount', new LiteralNumberProvider(0));
    this.slideAmount = parse.numberProvider('m_flSlideAmount', new LiteralNumberProvider(0));
    this.randomDirectionScale = parse.numberProvider('m_flRandomDirScale', new LiteralNumberProvider(0));
    this.decayBounce = parse.boolean('m_bDecayBounce', false);
    this.killOnContact = parse.boolean('m_bKillonContact', false);
    this.minimumSpeed = parse.float('m_flMinSpeed', -1);
    this.bounceKilledParticles = parse.boolean('m_bKillonContactBounce', false);
    this.setNormal = parse.boolean('m_bSetNormal', false);
    this.stickField = parse.particleField('m_nStickOnCollisionField', ParticleField.NoneDisabled);
    this.stopSpeed = parse.numberProvider('m_flStopSpeed', new LiteralNumberProvider(-1));
  }

  get storedFields(): bigint {
    let fields = fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious) | fieldMask(ParticleField.UserEventStates);
    if (this.stickField !== ParticleField.NoneDisabled) {
      fields |= fieldMask(this.stickField);
    }
    if (this.killOnContact || this.minimumSpeed >= 0) {
      fields |= fieldMask(ParticleField.LifeDuration);
    }
    if (this.setNormal) {
      fields |= fieldMask(ParticleField.Normal);
    }
    return fields;
  }

  get isFinalConstraint(): boolean { return !(this.bounceAmount instanceof LiteralNumberProvider && this.bounceAmount.value === 0) || !(this.slideAmount instanceof LiteralNumberProvider && this.slideAmount.value === 0); }

  applyConstraint(particles: ParticleCollection, frameTime: number, state: ParticleSystemState): boolean {
    const collision = state.collision;
    const mode = this.effectiveMode(state.detailLevel);
    if (mode === ParticleCollisionMode.COLLISION_MODE_DISABLED || !collision.hasGeometry) {
      return false;
    }
    const planeSet = mode === ParticleCollisionMode.COLLISION_MODE_PER_PARTICLE_TRACE ? null : this.refreshPlaneSet(state, mode);
    let hitAny = false;
    let confirmations = 0;
    const listened = state.data?.listenedEvents ?? 0;
    const hitEvent = this.killOnContact ? ParticleEventType.PARTICLE_EVENT_TYPE_MASK_KILLED_ON_COLLISION : ParticleEventType.PARTICLE_EVENT_TYPE_MASK_COLLISION;
    const current = particles.currentSpan;
    const positions = current.vectors(ParticleField.Position);
    const previous = current.vectors(ParticleField.PositionPrevious);
    const events = current.integers(ParticleField.UserEventStates);
    const radii = current.readFloats(ParticleField.Radius);
    const lifetimes = this.killOnContact || this.minimumSpeed >= 0 ? current.floats(ParticleField.LifeDuration) : null;
    const normals = this.setNormal ? current.vectors(ParticleField.Normal) : null;
    const stick = this.stickField !== ParticleField.NoneDisabled && isVectorField(this.stickField) ? current.vectors(this.stickField) : null;
    const bounces = this.bounceAmount.fillNew(current, state);
    const slides = this.slideAmount.fillNew(current, state);
    const scatters = this.randomDirectionScale.fillNew(current, state);
    const scales = this.radiusScale.fillNew(current, state);
    const stops = this.stickField !== ParticleField.NoneDisabled ? this.stopSpeed.fillNew(current, state) : null;
    const bounceOffset = (listened & ParticleEventType.PARTICLE_EVENT_TYPE_MASK_COLLISION) !== 0 ? FLOAT_EPSILON : 0;
    let scatterPoints = new Array<Vector3>(4).fill(Vector3.zero);
    let blockBounces = false;
    let blockScatters = false;
    let scatterDrawn = false;
    for (let i = 0; i < current.length; i++) {
      if (i % 4 === 0) {
        confirmations = 0;
        blockBounces = false;
        blockScatters = false;
        for (let j = i; j < Math.min(i + 4, current.length); j++) {
          blockBounces ||= f32(bounces[j] + bounceOffset) > 0 || slides[j] > 0;
          blockScatters ||= scatters[j] > 0;
        }
        scatterDrawn = false;
      }
      const bounce = f32(bounces[i] + bounceOffset);
      const slide = slides[i];
      const scatter = scatters[i];
      const scale = scales[i];
      const stuck = stick === null ? Vector3.zero : readVector(stick, i);
      if (stuck.lengthSquared() > 0) {
        writeVector(positions, i, stuck);
        writeVector(previous, i, stuck);
        continue;
      }
      const prev = readVector(previous, i);
      const step = readVector(positions, i).sub(prev);
      const squared = step.lengthSquared();
      if (squared <= FLOAT_EPSILON) {
        continue;
      }
      const length = f32(Math.sqrt(squared));
      const direction = step.div(length);
      const halfRadius = f32(f32(radii[i] * scale) * 0.5);
      const traceEnd = readVector(positions, i).add(direction.scale(halfRadius));
      const contactTrace = planeSet !== null ? planeSet.intersect(prev, traceEnd) : collision.traceRay(prev, traceEnd);
      let fraction = contactTrace.fraction;
      const normal = contactTrace.normal;
      if (!(fraction < 1)) {
        continue;
      }
      hitAny = true;
      const remaining = Math.max(0, f32(1 - fraction));
      if ((!this.killOnContact || this.bounceKilledParticles) && blockBounces && blockScatters && !scatterDrawn) {
        scatterPoints = state.threadRandom.nextInUnitBall();
        scatterDrawn = true;
      }
      if (planeSet !== null) {
        const start = prev.sub(direction.scale(halfRadius));
        const segmentSquared = distanceSquared(start, traceEnd);
        const maxTraces = this.maxConfirmationTraces === -1 ? 100 : this.maxConfirmationTraces;
        if (!(f32(this.confirmationSpeed * this.confirmationSpeed) > f32(segmentSquared / frameTime) || confirmations >= maxTraces)) {
          confirmations++;
          const end = traceEnd.add(direction.scale(64));
          const confirmed = collision.traceRay(start, end);
          if (!confirmed.hit) {
            continue;
          }
          planeSet.add(confirmed.position, confirmed.normal);
          const confirmedFraction = f32(f32(distance(start, end) * confirmed.fraction) / f32(Math.sqrt(segmentSquared)));
          if (confirmedFraction >= 1) {
            continue;
          }
          fraction = confirmedFraction;
        }
      }
      const tooSlow = this.minimumSpeed >= 0 && length < f32(this.minimumSpeed * frameTime);
      const contact = prev.add(step.scale(fraction));
      if (this.killOnContact) {
        if ((this.minimumSpeed < 0 || tooSlow) && lifetimes !== null) {
          lifetimes[i] = 0;
        }
        writeVector(positions, i, contact);
        if ((listened & ParticleEventType.PARTICLE_EVENT_TYPE_MASK_KILLED_ON_COLLISION) === 0) {
          writeVector(previous, i, contact);
        }
      }
      else if (tooSlow && lifetimes !== null) {
        lifetimes[i] = 0;
      }
      let writeNormal = this.setNormal;
      let stopped = false;
      if (!this.killOnContact || this.bounceKilledParticles) {
        if (blockBounces) {
          let reflected = reflect(direction, normal);
          if (blockScatters) {
            reflected = safeNormalize(reflected.add(scatterPoints[i % 4].scale(scatter)));
          }
          if (this.decayBounce) {
            reflected = reflected.scale(length);
          }
          const projected = step.sub(normal.scale(step.dot(normal)));
          const outgoing = reflected.scale(bounce).add(projected.scale(slide));
          const position = contact.add(outgoing.scale(remaining));
          writeVector(positions, i, position);
          writeVector(previous, i, position.sub(outgoing));
        }
        else {
          writeVector(positions, i, contact);
        }
        if (stops !== null) {
          const stop = f32(stops[i] * frameTime);
          stopped = !(stop >= 0 && distanceSquared(readVector(positions, i), readVector(previous, i)) >= f32(stop * stop));
          if (stopped && stick !== null) {
            writeVector(stick, i, readVector(positions, i));
          }
          writeNormal = stopped && this.setNormal;
        }
      }
      if (writeNormal && normals !== null) {
        writeVector(normals, i, normal);
      }
      if ((listened & (ParticleEventType.PARTICLE_EVENT_TYPE_MASK_COLLISION | ParticleEventType.PARTICLE_EVENT_TYPE_MASK_KILLED_ON_COLLISION)) !== 0) {
        particles.raiseEvent(i, hitEvent);
      }
      if ((listened & ParticleEventType.PARTICLE_EVENT_TYPE_MASK_FIRST_COLLISION) !== 0 && (events[i] & 0x10000) === 0) {
        events[i] |= 0x10000;
        particles.raiseEvent(i, ParticleEventType.PARTICLE_EVENT_TYPE_MASK_FIRST_COLLISION);
      }
      if (stopped && (listened & ParticleEventType.PARTICLE_EVENT_TYPE_MASK_COLLISION_STOPPED) !== 0) {
        particles.raiseEvent(i, ParticleEventType.PARTICLE_EVENT_TYPE_MASK_COLLISION_STOPPED);
      }
    }
    return hitAny;
  }
  private effectiveMode(detail: number): number {
    let level = detail;
    if (detail === 0) {
      level = ParticleCollisionMode.COLLISION_MODE_DISABLED;
    }
    else if (this.collisionMode <= level) {
      return this.collisionMode;
    }
    return this.collisionModeMin > level ? this.collisionModeMin : level;
  }
  private refreshPlaneSet(state: ParticleSystemState, mode: number): CollisionPlaneSet {
    const set = state.collisionPlaneSets[mode] ??= new CollisionPlaneSet();
    const last = set.lastRefreshTime;
    const force = last === -1 || (this.retestRate >= 0 && state.age > f32(this.retestRate + last));
    const origin = state.getControlPoint(this.controlPoint).position.add(this.controlPointOffset);
    set.refresh(state.collision, mode, origin, this.controlPointMovementTolerance, force, state.age);
    return set;
  }
}
