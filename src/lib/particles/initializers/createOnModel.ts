// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Initializers/CreateOnModel.cs.

import { readVector, writeVector } from '../buffer';
import type { ParticleCollection } from '../collection';
import { ParticleField } from '../enums';
import { fieldMask } from '../fields';
import { ParticleFunctionInitializer } from '../functions';
import { type ParticleModelObject } from '../model';
import { Matrix4x4, Vector3, f32, minF, safeNormalize, toInt, transform, transformNormal } from '../numerics';
import { LiteralNumberProvider, type NumberProvider } from '../numberProviders';
import type { ParticleDefinitionParser } from '../parser';
import type { ParticleSpan } from '../span';
import type { ParticleSystemState } from '../state';
import { ControlPointTransformProvider, type TransformProvider } from '../transformProviders';
import { HitBoxCache, type HitBoxSampling } from '../utils/hitBoxCache';
import type { MeshTriangles, MeshVertex } from '../utils/meshTriangles';
import { PACKED_BONE_COUNT, getPackedBone } from '../utils/packedBones';
import { clampLength, triangleCross } from '../utils/quaternionMath';
import { ParticleRandom } from '../utils/random';
import { modelInputControlPoint } from '../utils/skinnedSnapshot';
import { LiteralVectorProvider, type VectorProvider } from '../vectorProviders';

const MESH_CANDIDATES = 16;

/**
 * C_INIT_CreateOnModel: places new particles at random points inside the hitboxes, or the bones, of
 * the model its model input reads, recording the box and the point's place in it for the functions
 * that keep particles on the model. Particles can inherit the velocity of their box.
 *
 * With m_bUseMesh particles are placed on the triangles of the model's render meshes instead,
 * posed by its bones and pushed along the triangle normal by the shell size minus 1. The triangle
 * is picked by area among 16 random candidates. A model whose skinned meshes carry no bone remap
 * table falls back to the hitboxes.
 */
export class CreateOnModel extends ParticleFunctionInitializer {
  private readonly modelControlPoint: number;
  private readonly transformInput: TransformProvider;
  private readonly forceInModel: number;
  private readonly scaleToVolume: boolean;
  private readonly evenDistribution: boolean;
  private readonly desiredHitbox: NumberProvider;
  private readonly hitboxValueFromControlPoint: number;
  private readonly hitBoxScale: VectorProvider;
  private readonly boneVelocity: number;
  private readonly maxBoneVelocity: number;
  private readonly directionBias: VectorProvider;
  private readonly hitboxSetName: string;
  private readonly localCoords: boolean;
  private readonly useBones: boolean;
  private readonly shellSize: NumberProvider;
  private readonly useMesh: boolean;

  private meshRandomCounter = 0;
  private meshSkin: Matrix4x4[] = [];
  private meshRigid = Matrix4x4.identity();
  private meshSkinTime = Number.NaN;
  private meshUnavailableReported = false;

  constructor(parse: ParticleDefinitionParser) {
    super(parse);
    this.modelControlPoint = modelInputControlPoint(parse);
    this.transformInput = parse.transformInput('m_transformInput', new ControlPointTransformProvider());
    this.forceInModel = parse.int32('m_nForceInModel', 0);
    this.scaleToVolume = parse.boolean('m_bScaleToVolume', false);
    this.evenDistribution = parse.boolean('m_bEvenDistribution', false);
    this.desiredHitbox = parse.collectionNumberProvider('m_nDesiredHitbox', new LiteralNumberProvider(-1));
    this.hitboxValueFromControlPoint = parse.int32('m_nHitboxValueFromControlPointIndex', -1);
    this.hitBoxScale = parse.collectionVectorProvider('m_vecHitBoxScale', new LiteralVectorProvider(Vector3.one));
    this.boneVelocity = parse.float('m_flBoneVelocity', 0);
    this.maxBoneVelocity = parse.float('m_flMaxBoneVelocity', 0);
    this.directionBias = parse.collectionVectorProvider('m_vecDirectionBias', new LiteralVectorProvider(Vector3.zero));
    this.hitboxSetName = parse.string('m_HitboxSetName', 'default');
    this.localCoords = parse.boolean('m_bLocalCoords', false);
    this.useBones = parse.boolean('m_bUseBones', false);
    this.shellSize = parse.collectionNumberProvider('m_flShellSize', new LiteralNumberProvider(1));
    this.useMesh = parse.boolean('m_bUseMesh', false);
  }

  reset(): void {
    this.meshRandomCounter = 0;
    this.meshSkinTime = Number.NaN;
  }

  get writtenFields(): bigint {
    return fieldMask(ParticleField.Position) | fieldMask(ParticleField.PositionPrevious) | fieldMask(ParticleField.CreationTime)
      | fieldMask(ParticleField.HitboxIndex) | fieldMask(ParticleField.HitboxOffsetPosition)
      | (this.useMesh ? fieldMask(ParticleField.Normal) | fieldMask(ParticleField.BoneIndices) | fieldMask(ParticleField.BoneWeights) : 0n);
  }

  protected initializeCall(run: ParticleSpan, _particles: ParticleCollection, state: ParticleSystemState): void {
    const directionBiasValue = this.directionBias.nextVector(state);
    const shell = this.shellSize.nextNumber(state);
    const transformValue = this.transformInput.nextTransform(state);
    let desired = toInt(this.desiredHitbox.nextNumber(state));

    if (this.hitboxValueFromControlPoint >= 0) {
      desired = toInt(state.getControlPoint(this.hitboxValueFromControlPoint).position.x);
    }

    const scale = this.hitBoxScale.nextVector(state);
    const bias = this.localCoords ? transformNormal(directionBiasValue, transformValue) : directionBiasValue;

    const positions = run.vectors(ParticleField.Position);
    const previous = ParticleFunctionInitializer.spawnPreviousPositions(run, state);
    const hitboxIndices = ParticleFunctionInitializer.unwrittenIntegers(run, state, ParticleField.HitboxIndex);
    const hitboxOffsets = ParticleFunctionInitializer.unwrittenVectors(run, state, ParticleField.HitboxOffsetPosition);
    const normals = this.useMesh ? ParticleFunctionInitializer.unwrittenVectors(run, state, ParticleField.Normal) : null;
    const boneIndices = this.useMesh && ParticleFunctionInitializer.isUnwritten(state, ParticleField.BoneIndices) ? run.boneIndices : null;
    const boneWeights = this.useMesh ? ParticleFunctionInitializer.unwrittenVectors(run, state, ParticleField.BoneWeights) : null;

    const haltonIndex = { value: state.spawnIndex(run.start) };

    for (let i = 0; i < run.length; i++) {
      const meshPick = this.useMesh ? this.tryPickOnMesh(state, shell) : null;

      if (meshPick !== null) {
        writeVector(positions, i, meshPick.point);

        if (previous !== null) {
          writeVector(previous, i, meshPick.point);
        }

        if (hitboxOffsets !== null) {
          writeVector(hitboxOffsets, i, meshPick.point);
        }

        if (normals !== null) {
          writeVector(normals, i, meshPick.normal);
        }

        if (hitboxIndices !== null) {
          hitboxIndices[i] = 0;
        }

        if (boneIndices !== null) {
          boneIndices[i] = meshPick.bones;
        }

        if (boneWeights !== null) {
          writeVector(boneWeights, i, Vector3.unitX);
        }

        continue;
      }

      const cache = this.modelControlPoint < 0
        ? null
        : HitBoxCache.refresh(state, this.modelControlPoint, this.hitboxSetName, this.useBones, this.scaleToVolume && !this.useBones);

      if (cache === null) {
        continue;
      }

      const sampling: HitBoxSampling = {
        tries: this.forceInModel,
        desiredHitbox: desired,
        scale,
        directionBias: bias,
        shellSize: shell,
        evenDistribution: this.evenDistribution,
        weightByVolume: this.scaleToVolume && !this.useBones,
      };
      const { position, fraction, index } = cache.randomPoint(state, transformValue.translation, sampling, haltonIndex);

      writeVector(positions, i, position);

      if (hitboxIndices !== null) {
        hitboxIndices[i] = index;
      }

      if (hitboxOffsets !== null) {
        writeVector(hitboxOffsets, i, fraction);
      }

      if (previous === null) {
        continue;
      }

      writeVector(previous, i, position);

      let velocity = this.boneVelocity !== 0 ? cache.boxVelocity(index) : null;

      if (velocity !== null) {
        velocity = velocity.scale(this.boneVelocity);

        if (this.maxBoneVelocity > 0) {
          velocity = clampLength(velocity, this.maxBoneVelocity);
        }

        writeVector(previous, i, readVector(previous, i).sub(velocity.scale(state.previousStep)));
      }
    }
  }

  private tryPickOnMesh(state: ParticleSystemState, shell: number): { point: Vector3; normal: Vector3; bones: bigint } | null {
    const modelObject = this.modelControlPoint < 0 ? null : state.getControlPoint(this.modelControlPoint).resolveModelObject();

    if (modelObject === null) {
      return null;
    }

    const mesh = modelObject.model.meshTriangles;

    if (mesh === null) {
      if (!this.meshUnavailableReported) {
        this.meshUnavailableReported = true;
        state.data?.diagnostics.report('unsupported-input', `Render mesh triangles of ${modelObject.model.name} are not available; placing on hitboxes`, state.data.name);
      }

      return null;
    }

    if (mesh.triangleCount <= 0) {
      return null;
    }

    const candidates: number[] = [];
    let totalArea = 0;

    for (let i = 0; i < MESH_CANDIDATES; i++) {
      candidates.push(Math.min(toInt(f32(this.nextMeshRandom(state) * mesh.triangleCount)), mesh.triangleCount - 1));
      totalArea = f32(totalArea + mesh.area(candidates[i]));
    }

    let pick = minF(f32(this.nextMeshRandom(state) * totalArea), totalArea);
    let triangle = candidates[0];

    for (const candidate of candidates) {
      const area = mesh.area(candidate);

      if (pick <= area) {
        triangle = candidate;
        break;
      }

      pick = f32(pick - area);
    }

    this.poseSkin(state, modelObject, mesh);

    const v0 = this.trySkin(mesh.corner(triangle, 0));
    const v1 = v0 === null ? null : this.trySkin(mesh.corner(triangle, 1));
    const v2 = v1 === null ? null : this.trySkin(mesh.corner(triangle, 2));

    if (v0 === null || v1 === null || v2 === null) {
      return null;
    }

    let u = this.nextMeshRandom(state);
    let v = this.nextMeshRandom(state);

    if (f32(u + v) > 1) {
      [u, v] = [f32(1 - u), f32(1 - v)];
    }

    const normal = safeNormalize(triangleCross(v0, v1, v2));
    const point = v1.scale(u).add(v0.scale(f32(f32(1 - u) - v))).add(v2.scale(v)).add(normal.scale(f32(shell - 1)));
    return { point, normal, bones: mesh.corner(triangle, 0).bones };
  }

  // Mesh placement draws the candidates, area pick and barycentrics from a global random stream, so it differs
  // on every play; a seeded counter keeps it repeatable here
  private nextMeshRandom(state: ParticleSystemState): number {
    return ParticleRandom.forSample((state.random.seed + this.meshRandomCounter++) | 0);
  }

  /**
   * Works out, once per step, every bone's skinning transform into the world and the transform a
   * rigid vertex follows: the first bone's pose, or the model's placement when it has no bones.
   */
  private poseSkin(state: ParticleSystemState, modelObject: ParticleModelObject, mesh: MeshTriangles): void {
    const boneCount = mesh.inverseBindPose.length;

    if (this.meshSkinTime === state.age && this.meshSkin.length === boneCount) {
      return;
    }

    this.meshSkinTime = state.age;

    if (this.meshSkin.length !== boneCount) {
      this.meshSkin = new Array<Matrix4x4>(boneCount).fill(Matrix4x4.identity());
    }

    modelObject.getBonePose(this.meshSkin);
    this.meshRigid = boneCount > 0 ? this.meshSkin[0].multiply(modelObject.transform) : modelObject.transform;

    for (let i = 0; i < boneCount; i++) {
      this.meshSkin[i] = mesh.inverseBindPose[i].multiply(this.meshSkin[i]).multiply(modelObject.transform);
    }
  }

  /** Moves a vertex into the world by its bones, null for a skinned vertex whose bones were not mapped to the model's. */
  private trySkin(vertex: MeshVertex): Vector3 | null {
    if (vertex.weights[0] <= 0) {
      return transform(vertex.position, this.meshRigid);
    }

    if (!vertex.remapped) {
      return null;
    }

    let world = Vector3.zero;

    for (let k = 0; k < PACKED_BONE_COUNT; k++) {
      const bone = getPackedBone(vertex.bones, k);
      const weight = vertex.weights[k];

      if (weight > 0 && bone < this.meshSkin.length) {
        world = world.add(transform(vertex.position, this.meshSkin[bone]).scale(weight));
      }
    }

    return world;
  }
}
