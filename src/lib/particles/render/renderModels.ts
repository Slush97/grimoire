// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/RenderModels.cs and
// Renderer/Particles/Renderers/ParticleHandlePool.cs, with MathUtils.Perpendicular, MathUtils.CreateBasis
// and ParticleColorBlend.ApplyRounded.
//
// Renders each particle as the model its model input's control point carries or a model from the
// authored list, placed, turned and scaled by the particle and tinted by its colour. VRF adds an
// ordinary model scene node per particle; here each is a three.js group of the model's meshes under
// the renderer's own group, drawn with the material the model's draws use (see modelMaterial.ts). An
// override material replaces the materials of every mesh.
//
// Departures, all for what the host supplies rather than for what is computed:
// - The meshes come from the host's ParticleModelSource (every mesh the model's export draws); mesh
//   groups are not picked per particle (m_nBodyGroupField, m_nSubModelField).
// - Models are drawn in their bind pose: whether a model would be posed (m_bAnimated, the posing below
//   full alpha) is decided as VRF decides it, and the rate input evaluated, but no skeleton is posed.
// - A model's own materials are drawn only when the source supplies them, as the override is.
// - As in VRF, m_MaterialVars are not applied (model materials are shared by name), cloth is not
//   simulated, and models that draw only into the bloom or water effects passes are not drawn.

import * as THREE from 'three';
import type { ParticleCollection } from '../collection';
import type { ControlPointDefaults } from '../controlPointDefaults';
import { ParticleField } from '../enums';
import { getObjectArray, getString } from '../kv';
import { Matrix4x4, Vector3, cross, dot, f32, safeNormalize } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSystemState } from '../state';
import { FLOAT_EPSILON } from '../utils/particleMath';
import { eulerAnglesToRotationMatrix } from '../utils/vectorMath';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';
import { applyColorBlend, type Rgba } from './colorBlend';
import type { ParticleRendererContext } from './context';
import { ParticleModelType, RenderModelSubModelFieldType } from './enums';
import { ParticleFunctionRenderer } from './functionRenderer';
import { ModelMaterial } from './modelMaterial';
import { type ParticleMaterialData, type ParticleModelMesh, particleResourceKey } from './particleModels';
import { eulerAnglesToRotationMatrixRadians } from './renderSprites';
import type { RenderView } from './view';

const MODEL_FLAG_TRANSLUCENT = 0x1;
const MODEL_FLAG_TRANSLUCENT_TWO_PASS = 0x2;
const MODEL_FLAG_HAS_SKINNED_MESHES = 0x400;
const MODEL_FLAG_ANIMATION_DRIVEN_FLEXES = 0x200000;

/** ParticleHandlePool: entries kept per particle at the slot its handle names less one. */
class ParticleHandlePool<T> {
  private readonly slots: T[] = [];
  private readonly freeSlots: number[] = [];
  column: number | null = null;
  private readonly empty: () => T;

  constructor(empty: () => T) {
    this.empty = empty;
  }

  get count(): number {
    return this.slots.length;
  }

  get entries(): readonly T[] {
    return this.slots;
  }

  get(slot: number): T {
    return this.slots[slot];
  }

  set(slot: number, entry: T): void {
    this.slots[slot] = entry;
  }

  claim(particles: ParticleCollection): number {
    this.column ??= particles.claimHandleColumn();
    return this.column;
  }

  releaseDead(particles: ParticleCollection, column: number, release: (entry: T) => void): void {
    const released = particles.releasedHandlesOf(column);

    for (const handle of released) {
      const slot = handle - 1;
      release(this.slots[slot]);
      this.free(slot);
    }

    released.length = 0;
  }

  allocate(entry: T): number {
    const slot = this.freeSlots.pop();

    if (slot !== undefined) {
      this.slots[slot] = entry;
      return slot;
    }

    this.slots.push(entry);
    return this.slots.length - 1;
  }

  free(slot: number): void {
    this.slots[slot] = this.empty();
    this.freeSlots.push(slot);
  }

  clear(): void {
    this.slots.length = 0;
    this.freeSlots.length = 0;
  }
}

/** A model drawn on one particle: VRF's ModelSceneNode, as the meshes of the model under one group. */
class ModelNode {
  readonly group = new THREE.Group();
  readonly materials: ModelMaterial[] = [];
  readonly localBounds: { center: Vector3 };

  constructor(mesh: ParticleModelMesh, materials: (ParticleMaterialData | null)[], context: ParticleRendererContext, name: string) {
    this.group.name = name;
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;

    mesh.primitives.forEach((primitive, index) => {
      const data = materials[index] ?? null;

      if (data === null) {
        return;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(primitive.positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(primitive.normals ?? new Float32Array(primitive.positions.length), 3));
      const uvs = primitive.uvs ?? new Float32Array((primitive.positions.length / 3) * 2);
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setAttribute('uv1', new THREE.BufferAttribute(primitive.uvs2 ?? uvs, 2));
      geometry.setAttribute('color', new THREE.BufferAttribute(primitive.colors ?? new Float32Array((primitive.positions.length / 3) * 4).fill(1), 4));

      if (primitive.indices !== null) {
        geometry.setIndex(new THREE.BufferAttribute(primitive.indices, 1));
      }

      const material = new ModelMaterial(data, context, primitive.colors !== null);
      this.materials.push(material);
      const draw = new THREE.Mesh(geometry, material.material);
      draw.frustumCulled = false;
      draw.name = `${mesh.name} [${data.name}]`;
      this.group.add(draw);
    });

    const [min, max] = [mesh.bounds.min, mesh.bounds.max];
    this.localBounds = { center: new Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2) };
  }

  set transform(value: Matrix4x4) {
    this.group.matrix.fromArray(value.m);
    this.group.matrixWorldNeedsUpdate = true;

    const m = value.m;
    // How far the transform carries each model axis (its rows), as the texcoord scale by model reads it
    const scale: [number, number, number] = [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])];
    for (const material of this.materials) {
      material.setModelScale(scale);
      material.setModelTransform(this.group.matrix);
    }
  }

  setTint(tint: [number, number, number], alpha: number): void {
    for (const material of this.materials) material.setTint(tint, alpha);
  }

  set visible(value: boolean) {
    this.group.visible = value;
  }

  dispose(): void {
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.group.clear();
  }
}

interface PoolEntry {
  node: ModelNode | null;
  model: number;
  skin: number;
}

interface ModelEntry {
  model: ParticleModelMesh | null;
  weight: number;
  skins: string[];
}

/** MathUtils.Perpendicular: a unit vector perpendicular to the unit vector `direction`, by a fixed rule. */
function perpendicular(direction: Vector3): Vector3 {
  const guess = safeNormalize(new Vector3(f32(f32(f32(1 - direction.z) * direction.y) * direction.y) + direction.z, 0, -direction.x));
  return safeNormalize(guess.sub(direction.scale(dot(guess, direction))));
}

/** MathUtils.CreateBasis: rows x, y and z. */
function createBasis(x: Vector3, y: Vector3, z: Vector3): Matrix4x4 {
  return new Matrix4x4([x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, 0, 0, 0, 1]);
}

function createScale(scale: Vector3): Matrix4x4 {
  return new Matrix4x4([scale.x, 0, 0, 0, 0, scale.y, 0, 0, 0, 0, scale.z, 0, 0, 0, 0, 1]);
}

function createTranslation(offset: Vector3): Matrix4x4 {
  return new Matrix4x4([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset.x, offset.y, offset.z, 1]);
}

/** ParticleColorBlend.ApplyRounded: the blend rounded to whole bytes, half to even. */
function applyRounded(type: number, color: Rgba, scale: Rgba, out: Rgba): Rgba {
  applyColorBlend(type, color, scale, out);

  for (let i = 0; i < 4; i++) {
    const floor = Math.floor(out[i]);
    const diff = out[i] - floor;
    out[i] = diff > 0.5 || (diff === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
  }

  return out;
}

/** ParticleColorBlend.ToWrappedBytes: bytes truncated without a clamp, so a channel past 1 wraps around. */
function wrappedByte(channel: number): number {
  const truncated = Math.trunc(Math.fround(channel * 255));
  return Number.isFinite(truncated) ? truncated & 0xff : 0;
}

export class RenderModels extends ParticleFunctionRenderer {
  private readonly context: ParticleRendererContext;
  private readonly group = new THREE.Group();
  private readonly models: ModelEntry[] = [];
  private readonly totalWeight: number;
  /** How many models the list was authored with, before models from the model input are added. */
  private readonly authoredModelCount: number;
  private readonly modelInputControlPoint: number = -1;
  private readonly inputModels = new Map<string, number>();

  private readonly ignoreNormal: boolean;
  private readonly orientZ: boolean;
  private readonly ignoreRadius: boolean;
  private readonly localScale: boolean;
  private readonly suppressTint: boolean;
  private readonly centerOffset: boolean;
  private readonly modelScaleControlPoint: number;
  private readonly localOffset: VectorProvider;
  private readonly localRotation: VectorProvider;
  private readonly componentScale: VectorProvider;
  private readonly manualModelSelection: NumberProvider;
  private readonly skin: NumberProvider;
  private readonly overrideMaterial: string | null;
  private readonly overrideTranslucentMaterials: boolean;
  private readonly renderFilter: NumberProvider;


  private readonly animated: boolean;
  /** Whether models are posed from their sequence even when not animated. */
  private readonly posedWhenNotAnimated: boolean;
  /** Whether a particle was ever drawn below full alpha, which poses models from then on. */
  private posedForAlpha = false;
  private readonly animationRate: NumberProvider;

  private readonly pool = new ParticleHandlePool<PoolEntry>(() => ({ node: null, model: -1, skin: 0 }));
  private readonly idle: { node: ModelNode; skin: number }[][];
  private readonly releaseNode = (entry: PoolEntry) => this.release(entry);
  private readonly tintScratch: Rgba = [0, 0, 0, 0];
  private readonly alphaScratch: Rgba = [0, 0, 0, 0];

  constructor(parse: ParticleDefinitionParser, context: ParticleRendererContext) {
    super(parse);
    this.context = context;
    this.group.name = 'particle models';

    if (!this.onlyRenderInEffectsBloomPass && !this.onlyRenderInEffectsWaterPass) {
      const modelInputData = parse.data.m_modelInput;

      if (modelInputData !== null && typeof modelInputData === 'object' && !Array.isArray(modelInputData)) {
        const modelInput = parse.nested(modelInputData);

        if (modelInput.enum('m_nType', ParticleModelType, ParticleModelType.PM_TYPE_INVALID) === ParticleModelType.PM_TYPE_CONTROL_POINT) {
          this.modelInputControlPoint = modelInput.int32('m_nControlPoint', -1);
        }
      }

      for (const entry of getObjectArray(parse.data, 'm_ModelList')) {
        const path = getString(entry, 'm_model', '');
        const model = path === '' ? null : context.models?.model(path) ?? null;
        const weight = typeof entry.m_flRelativeProbabilityOfSpawn === 'number' ? entry.m_flRelativeProbabilityOfSpawn : 1;
        this.models.push({ model, weight, skins: model?.materialGroups ?? [] });
      }
    }

    this.authoredModelCount = this.models.length;
    this.totalWeight = this.models.filter((entry) => entry.model !== null && entry.weight > 0).reduce((sum, entry) => sum + entry.weight, 0);
    this.idle = this.models.map(() => []);

    this.ignoreNormal = parse.boolean('m_bIgnoreNormal', false);
    this.orientZ = parse.boolean('m_bOrientZ', false);
    this.ignoreRadius = parse.boolean('m_bIgnoreRadius', false);
    this.localScale = parse.boolean('m_bLocalScale', false);
    this.suppressTint = parse.boolean('m_bSuppressTint', false);
    this.centerOffset = parse.boolean('m_bCenterOffset', false);
    this.modelScaleControlPoint = parse.int32('m_nModelScaleCP', -1);
    this.localOffset = parse.vectorProvider('m_vecLocalOffset', new LiteralVectorProvider(Vector3.zero));
    this.localRotation = parse.vectorProvider('m_vecLocalRotation', new LiteralVectorProvider(Vector3.zero));
    this.componentScale = parse.vectorProvider('m_vecComponentScale', new LiteralVectorProvider(Vector3.one));
    this.manualModelSelection = parse.numberProvider('m_flManualModelSelection', new LiteralNumberProvider(-1));
    this.skin = parse.numberProvider('m_nSkin', new LiteralNumberProvider(0));
    this.overrideTranslucentMaterials = parse.boolean('m_bOverrideTranslucentMaterials', true);
    const overrideName = parse.string('m_hOverrideMaterial', '');
    this.overrideMaterial = overrideName === '' ? null : overrideName;
    this.renderFilter = parse.numberProvider('m_flRenderFilter', new LiteralNumberProvider(1));
    parse.int32('m_nLOD', -1);

    // Mesh groups are not picked per particle (see the header)
    parse.particleField('m_nBodyGroupField', ParticleField.SequenceNumber);
    parse.particleField('m_nSubModelField', ParticleField.ScratchFloat);
    parse.enum('m_nSubModelFieldType', RenderModelSubModelFieldType, RenderModelSubModelFieldType.SUBMODEL_AS_BODYGROUP_SUBMODEL);

    let animated = parse.boolean('m_bAnimated', false);
    this.animationRate = parse.numberProvider('m_flAnimationRate', new LiteralNumberProvider(30));
    parse.boolean('m_bScaleAnimationRate', false);
    parse.boolean('m_bForceLoopingAnimation', false);
    parse.boolean('m_bResetAnimOnStop', false);
    parse.boolean('m_bManualAnimFrame', false);
    parse.particleField('m_nAnimationScaleField', ParticleField.TrailLength);
    parse.particleField('m_nAnimationField', ParticleField.SecondSequenceNumber);
    parse.particleField('m_nManualFrameField', ParticleField.CreationTime);
    parse.string('m_SequenceName', '');

    // An activity (m_ActivityName) is not resolved to a sequence, so a model without a named sequence
    // plays the sequence its animation attribute picks.
    const doNotDrawInParticlePass = parse.boolean('m_bDoNotDrawInParticlePass', false);
    let drawInterleaved = parse.boolean('m_bForceDrawInterlevedWithSiblings', false);

    // Without a model that can be animated or a model input, nothing is posed or drawn interleaved;
    // otherwise a translucent model is always drawn interleaved with the renderer's siblings.
    // The sequences a model carries are not supplied, so a model counts as animatable by its flags alone
    if (this.modelInputControlPoint < 0 && !this.models.some((entry) => entry.model !== null && RenderModels.canAnimate(entry.model))) {
      animated = false;
      drawInterleaved = false;
    } else if (!doNotDrawInParticlePass && this.models.some((entry) => entry.model !== null && RenderModels.isTranslucent(entry.model))) {
      drawInterleaved = true;
    }

    this.animated = animated;
    this.posedWhenNotAnimated = !doNotDrawInParticlePass
      && (drawInterleaved || this.onlyRenderInEffectsBloomPass || this.onlyRenderInEffectsWaterPass || RenderModels.scalesWithControlPointView(parse));

    // m_szRenderAttribute's dynamic combo, m_bDisableShadows and m_bAcceptsDecals have no counterpart
    // in the three.js materials. TODO (as VRF): m_MaterialVars set material attributes per particle.
  }

  private static modelFlags(model: ParticleModelMesh): number {
    return model.flags;
  }

  private static isTranslucent(model: ParticleModelMesh): boolean {
    return (RenderModels.modelFlags(model) & (MODEL_FLAG_TRANSLUCENT | MODEL_FLAG_TRANSLUCENT_TWO_PASS)) !== 0;
  }

  private static canAnimate(model: ParticleModelMesh): boolean {
    return (RenderModels.modelFlags(model) & (MODEL_FLAG_HAS_SKINNED_MESHES | MODEL_FLAG_ANIMATION_DRIVEN_FLEXES)) !== 0;
  }

  /** Whether the draw is scaled by how the camera sees a control point, or by the field of view. */
  private static scalesWithControlPointView(parse: ParticleDefinitionParser): boolean {
    const visibilityInputs = parse.data.VisibilityInputs;

    if (visibilityInputs === null || typeof visibilityInputs !== 'object' || Array.isArray(visibilityInputs)) {
      return false;
    }

    const visibility = parse.nested(visibilityInputs);
    return visibility.int32('m_nCPin', -1) >= 0 || visibility.float('m_flRadiusScaleFOVBase', 0) > 0;
  }

  /** Whether any of the first four particles is drawn below full alpha, with its alpha2 value and the alpha scale combined. */
  private static firstBlockBelowFullAlpha(alphas: Float32Array, alpha2s: Float32Array, alphaScale: number): boolean {
    const count = Math.min(alphas.length, 4);

    for (let i = 0; i < count; i++) {
      if (alphas[i] * alpha2s[i] * alphaScale < 1) {
        return true;
      }
    }

    return false;
  }

  override get drawsInPasses(): boolean {
    return false;
  }

  override get objects(): readonly THREE.Object3D[] {
    return [this.group];
  }

  override addControlPointDefaults(defaults: ControlPointDefaults): void {
    defaults.addScale(this.modelScaleControlPoint);
  }

  override act(particles: ParticleCollection, state: ParticleSystemState): void {
    const column = this.pool.column;

    if (this.models.length === 0 || column === null) {
      return;
    }

    this.pool.releaseDead(particles, column, this.releaseNode);

    const scales = this.evaluateScales(state);
    const controlPointScale = this.modelScaleControlPoint >= 0 ? state.getControlPoint(this.modelScaleControlPoint).position : Vector3.one;
    const current = particles.currentSpan;
    const handles = particles.handles(column);
    const positions = current.readVectors(ParticleField.Position);
    const normals = current.readVectors(ParticleField.Normal);
    const yaws = current.readFloats(ParticleField.Yaw);
    const pitches = current.readFloats(ParticleField.Pitch);
    const rolls = current.readFloats(ParticleField.Roll);
    const colors = current.readVectors(ParticleField.Color);
    const radii = current.readFloats(ParticleField.Radius);
    const alphas = current.readFloats(ParticleField.Alpha);
    const alpha2s = this.readAlpha2(current);
    const componentScales = this.componentScale.prepare(current, state);
    const localOffsets = this.localOffset.prepare(current, state);
    const localRotations = this.localRotation.prepare(current, state);
    const skinIndices = this.skin.fillNew(current, state);
    const renderFilters = this.renderFilter.fillNew(current, state);

    const posed = this.animated || this.posedWhenNotAnimated || this.posedForAlpha;

    // A particle below full alpha poses the models from the next frame on
    if (!this.posedForAlpha && RenderModels.firstBlockBelowFullAlpha(alphas, alpha2s, scales.alpha)) {
      this.posedForAlpha = true;
    }

    // The animation rate is evaluated as VRF evaluates it, for its draws; models are not posed (see the header)
    if (posed) {
      this.animationRate.fillNew(current, state);
    }

    let nextInputBlock = 0;

    for (let i = 0; i < current.length; i++) {
      const slot = handles[i] - 1;
      let entry: PoolEntry = slot >= 0 ? this.pool.get(slot) : { node: null, model: -1, skin: 0 };
      const skinIndex = Math.trunc(skinIndices[i]);

      if (entry.node === null && entry.model >= 0) {
        entry = this.takeNode(entry.model);
      }

      const node = entry.node;

      if (node !== null) {
        const skins = this.models[entry.model].skins;
        const modelSkin = skinIndex >>> 0 < skins.length ? skinIndex : 0;

        if (modelSkin !== entry.skin) {
          // A material group is drawn with the materials the source supplies for it, which are the same
          entry = { ...entry, skin: modelSkin };
        }

        // Vector inputs drawing per block of four draw only for the blocks with a model drawn, in this order
        if (i >= nextInputBlock) {
          const { offset, block } = current.blockAt(i);
          const lane = block.start & 3;
          this.localRotation.fillPerBlock(block, lane, state, localRotations.subarray(offset * 3));
          this.componentScale.fillPerBlock(block, lane, state, componentScales.subarray(offset * 3));
          this.localOffset.fillPerBlock(block, lane, state, localOffsets.subarray(offset * 3));
          nextInputBlock = offset + block.length;
        }

        const at = (values: Float32Array) => new Vector3(values[i * 3], values[i * 3 + 1], values[i * 3 + 2]);
        const rotation = at(localRotations);
        const radiusScale = this.ignoreRadius ? 1 : Math.max(FLOAT_EPSILON, f32(radii[i] * scales.radius));
        const component = at(componentScales);
        const scale = new Vector3(f32(f32(component.x * controlPointScale.x) * radiusScale), f32(f32(component.y * controlPointScale.y) * radiusScale),
          f32(f32(component.z * controlPointScale.z) * radiusScale));
        const offset = at(localOffsets);

        // The alpha scale applies twice: once with the particle's alpha and again in the blend
        const blended = this.blendColor(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2], alphas[i], alpha2s[i], scales, this.alphaScratch, scales.alpha);
        const alpha = blended[3];

        // The tint is truncated to bytes without a clamp, so a channel past 1 wraps around
        const tintBytes = applyRounded(this.colorBlendType,
          [wrappedByte(colors[i * 3]), wrappedByte(colors[i * 3 + 1]), wrappedByte(colors[i * 3 + 2]), 0], scales.color, this.tintScratch);

        node.transform = this.particleTransform(at(positions), at(normals), pitches[i], yaws[i], rolls[i], node, rotation, scale, offset, scales.roll);
        node.setTint(this.suppressTint ? [1, 1, 1] : [tintBytes[0] / 255, tintBytes[1] / 255, tintBytes[2] / 255], alpha);
        node.visible = renderFilters[i] >= 1;
      }

      if (slot >= 0) {
        this.pool.set(slot, entry);
      }
    }
  }

  override initializeParticles(particles: ParticleCollection, state: ParticleSystemState, first: number, count: number): void {
    if (this.models.length === 0 && this.modelInputControlPoint < 0) {
      return;
    }

    const current = particles.currentSpan;
    const handles = particles.handles(this.pool.claim(particles));

    // The selection is evaluated for every particle before any pick draws. Each new particle reads its
    // own value
    const manualSelections = this.manualModelSelection.fillNew(current, state);

    for (let i = first; i < first + count; i++) {
      const slot = this.pool.allocate({ node: null, model: this.pickModel(Math.trunc(manualSelections[i]), state), skin: 0 });
      handles[i] = slot + 1;
    }
  }

  override hide(particles: ParticleCollection): void {
    const column = this.pool.column;

    if (column !== null) {
      this.pool.releaseDead(particles, column, this.releaseNode);
    }

    // The nodes stay with their particles, to be shown again by the next render
    for (const entry of this.pool.entries) {
      if (entry.node !== null) {
        entry.node.visible = false;
      }
    }
  }

  /**
   * The model a new particle draws: the model bound to the model input's control point when there is
   * one, otherwise the list entry the manual selection names when it is in range, otherwise one picked
   * by relative probability with one draw from the system's random sequence, or -1.
   */
  private pickModel(manual: number, state: ParticleSystemState): number {
    const inputModel = state.getControlPointModel(this.modelInputControlPoint);

    if (inputModel !== null) {
      return this.inputModelIndex(inputModel.name);
    }

    if (manual >>> 0 < this.authoredModelCount && manual >= 0) {
      return this.models[manual].model !== null ? manual : -1;
    }

    if (this.totalWeight <= 0) {
      return -1;
    }

    let pick = f32(state.random.next() * this.totalWeight);
    let picked = -1;

    for (let i = 0; i < this.models.length; i++) {
      if (this.models[i].model === null || this.models[i].weight <= 0) {
        continue;
      }

      picked = i;
      pick = f32(pick - this.models[i].weight);

      if (pick <= 0) {
        break;
      }
    }

    return picked;
  }

  /** Where a model a control point supplies sits in the model list, adding it with no spawn weight the first time. */
  private inputModelIndex(name: string): number {
    const key = particleResourceKey(name);
    let index = this.inputModels.get(key);

    if (index === undefined) {
      index = this.models.length;
      this.inputModels.set(key, index);
      const model = this.context.models?.model(name) ?? null;
      this.models.push({ model, weight: 0, skins: model?.materialGroups ?? [] });
      this.idle.push([]);
    }

    return index;
  }

  private takeNode(model: number): PoolEntry {
    const pooled = this.idle[model].pop();

    if (pooled !== undefined) {
      return { node: pooled.node, model, skin: pooled.skin };
    }

    const mesh = this.models[model].model;

    if (mesh === null) {
      return { node: null, model, skin: 0 };
    }

    const node = new ModelNode(mesh, this.materialsFor(mesh), this.context, `${this.className}: ${mesh.name}`);
    this.group.add(node.group);
    return { node, model, skin: 0 };
  }

  /**
   * ApplyOverrideMaterial: every draw takes the override material. Without one, or for a translucent
   * draw the override leaves alone, the model's own material, as far as the source supplies it.
   */
  private materialsFor(mesh: ParticleModelMesh): (ParticleMaterialData | null)[] {
    const override = this.overrideMaterial === null ? null : this.context.models?.material(this.overrideMaterial) ?? null;
    const own = mesh.primitives.map((primitive, index) => this.context.models?.material(primitive.material ?? `${mesh.name}#${index}`) ?? null);

    return own.map((material, index) => {
      if (override === null) {
        if (material === null) this.logger.warn(`Particle model draw '${mesh.name}#${index}' has no material; the draw is omitted.`);
        return material;
      }
      if (material === null) return override;
      const attributes = material.intAttributes;
      const translucent = attributes.translucent === 1 || material.intParams.F_TRANSLUCENT === 1;
      const shouldOverride = this.overrideTranslucentMaterials || (!translucent && (attributes.IgnoreMaterialOverride ?? 0) === 0)
        || (attributes.ForceMaterialOverride ?? 0) !== 0;
      return shouldOverride ? override : material;
    });
  }

  /** Hides a particle's node and hands it back for the next particle of that model. */
  private release(entry: PoolEntry): void {
    if (entry.node === null) {
      return;
    }

    entry.node.visible = false;
    this.idle[entry.model].push({ node: entry.node, skin: entry.skin });
  }

  /**
   * Model space to world. The model takes the local offset, less the centre of its mesh bounds when
   * centred, then the scale, the authored local rotation and the particle's own angles, and is then
   * turned into the frame its normal gives, unless the normal is ignored. A local scale applies along
   * the model's own axes, otherwise it applies after the turns, along the axes of that frame.
   */
  private particleTransform(position: Vector3, normal: Vector3, pitch: number, yaw: number, roll: number, node: ModelNode, rotation: Vector3,
    scale: Vector3, offset: Vector3, rollScale: number): Matrix4x4 {
    const turn = eulerAnglesToRotationMatrix(rotation).multiply(eulerAnglesToRotationMatrixRadians(pitch, yaw, f32(roll * rollScale)));
    const scaling = createScale(scale);
    const basis = this.ignoreNormal ? Matrix4x4.identity() : RenderModels.normalBasis(normal, this.orientZ);
    const model = this.localScale ? scaling.multiply(turn).multiply(basis) : turn.multiply(scaling).multiply(basis);

    if (this.centerOffset) {
      offset = offset.sub(node.localBounds.center);
    }

    return createTranslation(offset).multiply(model).multiply(createTranslation(position));
  }

  /**
   * The frame a normal turns the model into: the normal becomes the model's forward axis, or its up axis
   * when oriented on Z, and the other two axes come from a fixed perpendicular to it.
   */
  private static normalBasis(normal: Vector3, orientZ: boolean): Matrix4x4 {
    const length = normal.length();

    if (length === 0 || !Number.isFinite(length)) {
      return Matrix4x4.identity();
    }

    const direction = normal.scale(1 / length);
    const side = perpendicular(direction);
    const third = cross(direction, side);

    return orientZ ? createBasis(third, side.negate(), direction) : createBasis(direction, side, third);
  }

  /** The model nodes draw themselves with the rest of the scene; their materials read the view each frame. */
  override updateBuffers(_particles: ParticleCollection, _state: ParticleSystemState, view: RenderView): void {
    for (const entry of this.pool.entries) {
      for (const material of entry.node?.materials ?? []) material.update(view, this.context);
    }

    for (const stack of this.idle) {
      for (const { node } of stack) for (const material of node.materials) material.update(view, this.context);
    }
  }

  override setVisible(): void {
    // The model nodes are scene nodes of their own in VRF, shown by act and hidden by hide
    this.group.visible = true;
  }

  override dispose(): void {
    for (const entry of this.pool.entries) entry.node?.dispose();

    for (const stack of this.idle) {
      for (const { node } of stack) node.dispose();
      stack.length = 0;
    }

    this.pool.clear();
    this.group.clear();
  }
}
