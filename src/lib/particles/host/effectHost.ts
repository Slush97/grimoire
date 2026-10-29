// Runs one bundled effect on a posed hero model and binds its control points the way ValveResourceFormat
// binds them. Ported from ValveResourceFormat (MIT): Renderer/Renderer/SceneNodes/ParticleSceneNode.cs
// (CreatePreviewModel, ApplyControlPointDefaults, ApplyPreviewControlPoints, ApplyRuntimeControlPointValues,
// CreateModelParticles, AttachOnModel, Place, SeedControlPointFromTransform, PlacementSeed, Simulate) and
// Renderer/Particles/ParticleModelNodeObject.cs.
//
// Pure, no graphics: the owner supplies the bone pose each frame (model space, Source units, row-vector
// matrices as System.Numerics lays them out) and steps the host on a fixed timestep.
//
// Two bindings, chosen by what the effect's source names:
// - A control point configuration (model particle_cfg_list, CFG animation events, and effects the game
//   dispatches from code): the preview binding. Defaults first, then each driver of the configuration
//   (`preview`, else the first, unless the source names one) places its control point at its offset in
//   the driver's attachment frame, with its angles, and every driven control point carries the model.
//   VRF places the drivers once and then keeps only control point 0 on the first driver's attachment;
//   here a driver whose attach type follows (PATTACH_*_FOLLOW) is placed again every step by the same
//   rule, since the preview model animates. Driver orientations are VRF's: from the angles alone.
// - An attachment (model particles_list, other animation events): CreateModelParticles. Control point 0
//   carries the model and follows the attachment frame (position and orientation), the `game`
//   configuration's driver offsets are applied once, and control point 1 follows the event's second
//   attachment when it names one.

import { ControlPointDefaults } from '../controlPointDefaults';
import { ParticleAttachment } from '../enums';
import { type KVObject, type KVValue, getArray, getString, isCollection } from '../kv';
import { type ParticleModel, type ParticleModelObject, createTranslation } from '../model';
import { Matrix4x4, Quaternion, Vector3, eulerAnglesToQuaternion, f32, roundHalfEven, safeNormalize, transform, transformNormal } from '../numerics';
import { ParticleSystemSimulation } from '../simulation';
import type { ParticleDefinitionSource } from '../simulation';
import { stringToken } from '../utils/stringToken';
import { attachmentTransform, childFrame, rigidTransform } from './attachments';
import type { BundleAttachment, BundleEffect } from './bundle';
import { applyIdleParticleInputs } from './runtimeInputs';

/** The hero's pose as the owner last read it. */
export interface HostPose {
  /** Every bone in model space by bone index, or undefined for one the owner does not drive (bind pose). */
  readonly bones: (Matrix4x4 | undefined)[];
  /** The model's placement in the particle world. */
  transform: Matrix4x4;
}

/** ParticleModelNodeObject over the owner's pose: an undriven bone reads its bind pose. */
export class PosedModelObject implements ParticleModelObject {
  readonly model: ParticleModel;
  readonly sequenceIndex = -1;
  readonly sequenceRate = 1;
  private readonly pose: HostPose;
  private readonly bind: Matrix4x4[];

  constructor(model: ParticleModel, pose: HostPose) {
    this.model = model;
    this.pose = pose;
    this.bind = new Array<Matrix4x4>(model.skeleton.bones.length);
    model.getBindPose(this.bind);
  }

  get transform(): Matrix4x4 {
    return this.pose.transform;
  }

  getBonePose(bones: Matrix4x4[]): void {
    for (let i = 0; i < bones.length; i++) {
      bones[i] = this.pose.bones[i] ?? this.bind[i];
    }
  }

  /** The pose with undriven bones filled from the bind pose. */
  get resolvedPose(): Matrix4x4[] {
    const bones = new Array<Matrix4x4>(this.bind.length);
    this.getBonePose(bones);
    return bones;
  }
}

const FOLLOW_TYPES: ReadonlySet<number> = new Set([
  ParticleAttachment.PATTACH_ABSORIGIN_FOLLOW,
  ParticleAttachment.PATTACH_CUSTOMORIGIN_FOLLOW,
  ParticleAttachment.PATTACH_POINT_FOLLOW,
  ParticleAttachment.PATTACH_EYES_FOLLOW,
  ParticleAttachment.PATTACH_OVERHEAD_FOLLOW,
  ParticleAttachment.PATTACH_ROOTBONE_FOLLOW,
  ParticleAttachment.PATTACH_RENDERORIGIN_FOLLOW,
  ParticleAttachment.PATTACH_CENTER_FOLLOW,
]);

function attachTypeOf(value: KVValue | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return ParticleAttachment.PATTACH_INVALID;
  const key = value.toUpperCase().startsWith('PATTACH_') ? value.toUpperCase() : `PATTACH_${value.toUpperCase()}`;
  return (ParticleAttachment as Record<string, number>)[key] ?? ParticleAttachment.PATTACH_INVALID;
}

/** ReadDriverVector: three components, a null or missing one reading 0. */
function driverVector(driver: KVObject, key: string): Vector3 {
  const value = driver[key];
  return Array.isArray(value) && value.length >= 3 ? new Vector3(Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0) : Vector3.zero;
}

interface Driver {
  controlPoint: number;
  attachType: number;
  attachmentName: string;
  offset: Vector3;
  angleOffset: Vector3;
}

function readDriver(driver: KVObject): Driver {
  return {
    controlPoint: Number(driver.m_iControlPoint ?? 0) | 0,
    attachType: 'm_iAttachType' in driver ? attachTypeOf(driver.m_iAttachType) : ParticleAttachment.PATTACH_INVALID,
    attachmentName: getString(driver, 'm_attachmentName') ?? '',
    offset: driverVector(driver, 'm_vecOffset'),
    angleOffset: driverVector(driver, 'm_angOffset'),
  };
}

/** The configuration of `name`, or VRF's preview pick: `preview`, else the first. */
function pickConfiguration(definition: KVObject, name: string | null): KVObject | null {
  const configurations = (getArray(definition, 'm_controlPointConfigurations') ?? []).filter(isCollection);
  const named = (wanted: string) => configurations.find((configuration) => (getString(configuration, 'm_name') ?? '').toLowerCase() === wanted.toLowerCase());
  return (name !== null ? named(name) : undefined) ?? named('preview') ?? configurations[0] ?? null;
}

/** ApplyRuntimeControlPointValues' pick: `fps_view` for viewmodel effects, else `game`, else any but `preview`. */
function pickRuntimeConfiguration(definition: KVObject): KVObject | null {
  const wanted = getString(definition, 'm_nViewModelEffect') === 'INHERITABLE_BOOL_TRUE' ? 'fps_view' : 'game';
  let chosen: KVObject | null = null;

  for (const configuration of (getArray(definition, 'm_controlPointConfigurations') ?? []).filter(isCollection)) {
    const name = (getString(configuration, 'm_name') ?? '').toLowerCase();

    if (name === wanted) {
      return configuration;
    }

    if (chosen === null && name !== 'preview') {
      chosen = configuration;
    }
  }

  return chosen;
}

export interface EffectHostContext {
  source: ParticleDefinitionSource;
  model: ParticleModel;
  modelObject: PosedModelObject;
  attachments: ReadonlyMap<string, BundleAttachment>;
}

export class ParticleEffectHost {
  readonly effect: BundleEffect;
  readonly simulation: ParticleSystemSimulation;
  /** Whether the effect starts over when it has finished, as the preview loops it. */
  readonly loop: boolean;
  private readonly context: EffectHostContext;
  private readonly drivers: Driver[] = [];
  private readonly previewAttachmentPoint: string | null;
  private readonly usesConfiguration: boolean;
  private readonly defaults = new ControlPointDefaults();
  private nodeTransform: Matrix4x4 | null = null;
  private seededTransform: string | null = null;
  private seeded = false;
  private pendingRestart = false;
  private started = false;
  private stagedPlaced = false;
  /** Set once a stop has been requested; the host then runs until its particles are gone. */
  stopped = false;

  constructor(effect: BundleEffect, context: EffectHostContext) {
    this.effect = effect;
    this.context = context;
    const loaded = context.source.loadSystem(effect.system);

    if (loaded === null) {
      throw new Error(`Particle system not in bundle: ${effect.system}`);
    }

    this.simulation = new ParticleSystemSimulation(loaded, context.source);
    this.usesConfiguration = effect.attachment === null;
    this.loop = effect.source !== 'anim-event';
    const definition = this.simulation.definition;

    if (this.usesConfiguration) {
      this.applyControlPointDefaults();
      const configuration = pickConfiguration(definition, effect.configuration);
      this.drivers = (configuration ? getArray(configuration, 'm_drivers') ?? [] : []).filter(isCollection).map(readDriver);
      const first = this.drivers[0];
      this.previewAttachmentPoint = first !== undefined && (first.attachType === ParticleAttachment.PATTACH_POINT || first.attachType === ParticleAttachment.PATTACH_POINT_FOLLOW)
        ? first.attachmentName : null;
      this.simulation.getControlPoint(0).modelObject = context.modelObject;
      this.applyPreviewControlPoints(true);
    } else {
      this.previewAttachmentPoint = null;
      this.applyRuntimeControlPointValues(definition);
      this.simulation.getControlPoint(0).modelObject = context.modelObject;
    }
  }

  /** Adds defaults a renderer implies (VRF asks each renderer too); call before `start`. */
  addRendererDefaults(add: (defaults: ControlPointDefaults) => void): void {
    if (!this.usesConfiguration) return;
    // One set for the simulation and its renderers, as VRF collects them: per component the first wins
    add(this.defaults);
    this.writeDefaults(this.defaults);
    this.applyPreviewControlPoints(true);
  }

  private applyControlPointDefaults(): void {
    this.simulation.addControlPointDefaults(this.defaults);
    this.writeDefaults(this.defaults);
  }

  private writeDefaults(defaults: ControlPointDefaults): void {
    for (const [index, value] of defaults.values) {
      this.simulation.getControlPoint(index).position = value;
    }
  }

  private applyRuntimeControlPointValues(definition: KVObject): void {
    const configuration = pickRuntimeConfiguration(definition);

    for (const driver of (configuration ? getArray(configuration, 'm_drivers') ?? [] : []).filter(isCollection).map(readDriver)) {
      if (driver.controlPoint !== 0 && !driver.offset.equals(Vector3.zero)) {
        this.simulation.getControlPoint(driver.controlPoint).position = driver.offset;
      }
    }
  }

  private pose(): Matrix4x4[] {
    return this.context.modelObject.resolvedPose;
  }

  /** ApplyPreviewControlPoints, every driver at creation and the following ones after. */
  private applyPreviewControlPoints(all: boolean): void {
    const pose = all || this.drivers.some((driver) => FOLLOW_TYPES.has(driver.attachType)) ? this.pose() : [];

    for (const driver of this.drivers) {
      if (!all && !FOLLOW_TYPES.has(driver.attachType)) {
        continue;
      }

      let attach = Matrix4x4.identity();
      const onPoint = (driver.attachType === ParticleAttachment.PATTACH_POINT || driver.attachType === ParticleAttachment.PATTACH_POINT_FOLLOW) && driver.attachmentName !== '';

      if (onPoint) {
        attach = attachmentTransform(driver.attachmentName, this.context.attachments, this.context.model.skeleton, pose, this.context.modelObject.transform);
      }

      const point = this.simulation.getControlPoint(driver.controlPoint);
      point.position = transform(driver.offset, attach);

      if (onPoint) {
        // DEVIATION from VRF's preview, which orients a driven control point by its angles alone on a
        // model that does not move: the game orients one on an attachment by the attachment's frame,
        // turned by the driver's angles, and the viewer's model animates. Effects that work in a
        // control point's frame (local space boxes, local coordinate offsets, position locks) turn
        // with the attachment then, as Abrams' book glow and Dynamo's head stars do in game.
        const angles = driver.angleOffset.equals(Vector3.zero) ? Matrix4x4.identity() : Matrix4x4.fromQuaternion(eulerAnglesToQuaternion(driver.angleOffset));
        point.setRotation(Quaternion.fromRotationMatrix(rigidTransform(angles.multiply(attach))));
      } else if (all) {
        if (driver.angleOffset.equals(Vector3.zero)) {
          point.orientation = Vector3.zero;
        } else {
          point.setRotation(eulerAnglesToQuaternion(driver.angleOffset));
        }
      }

      if (all) {
        point.attachType = driver.attachType;
        point.modelObject = this.context.modelObject;
      }
    }
  }

  /** The node frame AttachOnModel gives an attached effect on the current pose. */
  private attachedFrame(attachment: NonNullable<BundleEffect['attachment']>, pose: Matrix4x4[]): Matrix4x4 {
    const type = attachTypeOf(attachment.type);
    const offset = createTranslation(new Vector3(...attachment.offset));
    const frame = (name: string) => childFrame(name, this.context.attachments, this.context.model.skeleton, pose, this.context.modelObject.transform);

    switch (type) {
      case ParticleAttachment.PATTACH_POINT:
      case ParticleAttachment.PATTACH_POINT_FOLLOW:
        return offset.multiply(frame(attachment.point));
      case ParticleAttachment.PATTACH_WORLDORIGIN:
        return offset;
      case ParticleAttachment.PATTACH_CUSTOMORIGIN:
        return this.nodeTransform ?? offset.multiply(frame(''));
      default:
        return offset.multiply(frame(''));
    }
  }

  /** ParticleSceneNode.SetControlPoint: position and full orientation from a transform. */
  private setControlPointTo(index: number, frame: Matrix4x4): void {
    const point = this.simulation.getControlPoint(index);
    point.position = frame.translation;
    const forward = transformNormal(Vector3.unitX, frame);

    if (forward.lengthSquared() > f32(1e-12)) {
      const rows = [0, 1, 2].map((row) => safeNormalize(new Vector3(frame.m[row * 4], frame.m[row * 4 + 1], frame.m[row * 4 + 2])));
      point.setRotation(Quaternion.fromRotationMatrix(Matrix4x4.createBasis(rows[0], rows[1], rows[2])));
    }
  }

  /** Place: the following control points, then control point 0 on its attachment, then the staged ones. */
  place(): void {
    this.placeBound();
    this.placeStaged();
  }

  /**
   * The control points a stage places (BundleEffect.controlPoints), after the binding: one that follows
   * every time, the others once, when the effect is first placed.
   */
  private placeStaged(): void {
    const staged = this.effect.controlPoints;

    if (staged === undefined || staged.length === 0) {
      return;
    }

    const first = !this.stagedPlaced;
    this.stagedPlaced = true;
    const pose = this.pose();

    for (const point of staged) {
      if (point.kind === 'world') {
        if (first) {
          const forward = new Vector3(...point.forward);
          const side = safeNormalize(new Vector3(-forward.y, forward.x, 0).lengthSquared() > 0 ? new Vector3(-forward.y, forward.x, 0) : Vector3.unitY);
          const up = safeNormalize(new Vector3(forward.y * side.z - forward.z * side.y, forward.z * side.x - forward.x * side.z, forward.x * side.y - forward.y * side.x));
          this.setControlPointTo(point.cp, Matrix4x4.createBasis(safeNormalize(forward), side, up).withTranslation(new Vector3(...point.position)));
        }
      } else if (point.kind === 'origin') {
        if (first || point.follow) this.setControlPointTo(point.cp, rigidTransform(this.context.modelObject.transform));
      } else if (first || point.follow) {
        const frame = childFrame(this.stagedAttachmentName(point.attachment), this.context.attachments, this.context.model.skeleton, pose,
          this.context.modelObject.transform);
        this.setControlPointTo(point.cp, point.facing === 'model' ? rigidTransform(this.context.modelObject.transform).withTranslation(frame.translation) : frame);
      }
    }
  }

  /**
   * The model's own spelling of an attachment or bone a stage names. Source looks names up without
   * regard to case, and game data does not always match the model's (Lash's ability names `palm_r`,
   * his model `palm_R`).
   */
  private stagedAttachmentName(name: string): string {
    if (this.context.attachments.has(name) || this.context.model.skeleton.getBoneIndex(name) !== -1) return name;
    const lower = name.toLowerCase();
    return [...this.context.attachments.keys()].find((key) => key.toLowerCase() === lower)
      ?? this.context.model.skeleton.bones.find((bone) => bone.name.toLowerCase() === lower)?.name
      ?? name;
  }

  private placeBound(): void {
    if (this.usesConfiguration) {
      this.applyPreviewControlPoints(false);

      if (this.previewAttachmentPoint !== null) {
        const pose = this.pose();
        this.simulation.mainControlPoint.position = attachmentTransform(this.previewAttachmentPoint, this.context.attachments, this.context.model.skeleton,
          pose, this.context.modelObject.transform).translation;
      }

      return;
    }

    const pose = this.pose();
    const frame = this.attachedFrame(this.effect.attachment!, pose);
    this.nodeTransform = frame;
    const key = Array.from(frame.m).join(',');

    // SeedControlPointFromTransform: only a changed node transform re-seeds control point 0
    if (key !== this.seededTransform) {
      this.seededTransform = key;
      this.setControlPointTo(0, frame);
    }

    if (this.effect.attachmentCp1 !== null) {
      this.setControlPointTo(1, this.attachedFrame(this.effect.attachmentCp1, pose));
    }
  }

  /** Starts emitting; construct any renderer for the simulation first, as VRF does. */
  start(): void {
    if (!this.started) {
      this.started = true;
      this.place();
      applyIdleParticleInputs(this.simulation, this.effect.system);
      this.simulation.start();
    }
  }

  /** Simulate: seed once, restart when due, step, and loop a finished preview. */
  step(frameTime: number, uptime: number, cameraPosition: Vector3): void {
    if (!this.seeded) {
      this.seeded = true;
      this.simulation.seedRandom(this.placementSeed());
    }

    if (this.pendingRestart) {
      this.pendingRestart = false;
      this.simulation.replay();
    }

    this.simulation.setCameraPosition(cameraPosition);
    this.simulation.update(frameTime, uptime);

    if (this.loop && !this.stopped && this.simulation.isFinished()) {
      this.pendingRestart = true;
    }
  }

  /** PlacementSeed: the effect name, and where its node first runs. */
  private placementSeed(): number {
    const position = this.usesConfiguration ? Vector3.zero : (this.nodeTransform?.translation ?? Vector3.zero);
    return (stringToken(this.simulation.name) ^ Math.imul(roundHalfEven(position.x), 73856093) ^ Math.imul(roundHalfEven(position.y), 19349663)
      ^ Math.imul(roundHalfEven(position.z), 83492791)) | 0;
  }

  /** Stops emission, playing the end cap or not; an immediate stop also drops the particles. */
  stop(immediately: boolean, endCap: boolean): void {
    this.stopped = true;
    this.simulation.stopEmission(immediately, endCap);
  }

  /** Whether a stopped effect has nothing left to draw. */
  get done(): boolean {
    return this.stopped && this.simulation.isFinished();
  }
}
