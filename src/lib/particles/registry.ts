// Mirrors ValveResourceFormat (MIT): ValveResourceFormat/Particles/ParticleControllerFactory.cs.
//
// VRF_CLASSES lists every class VRF registers, by kind, in VRF's order. PORTED maps the classes this
// runtime implements to their constructors. A class VRF knows but this runtime has not ported yet, or
// one VRF does not know at all, is reported by the system as unsupported rather than ignored.
//
// To port a class: add its file under the kind's folder (see operators/decay.ts) and its entry here.

import { ConstrainDistance } from './constraints/constrainDistance';
import { WorldTraceConstraint } from './constraints/worldTraceConstraint';
import { ContinuousEmitter } from './emitters/continuousEmitter';
import { InstantaneousEmitter } from './emitters/instantaneousEmitter';
import { MaintainEmitter } from './emitters/maintainEmitter';
import { NoiseEmitter } from './emitters/noiseEmitter';
import { AttractToControlPoint } from './forces/attractToControlPoint';
import { CurlNoiseForce } from './forces/curlNoiseForce';
import type { ParticleFunction } from './functions';
import { CreateFromParentParticles } from './initializers/createFromParentParticles';
import { CreateOnModel } from './initializers/createOnModel';
import { CreateSequentialPathV2 } from './initializers/createSequentialPathV2';
import { CreateWithinBox } from './initializers/createWithinBox';
import { CreateWithinSphereTransform } from './initializers/createWithinSphereTransform';
import { InheritVelocity } from './initializers/inheritVelocity';
import { InitFloat } from './initializers/initFloat';
import { InitFromParentKilled } from './initializers/initFromParentKilled';
import { InitSkinnedPositionFromCPSnapshot } from './initializers/initSkinnedPositionFromCPSnapshot';
import { InitVec } from './initializers/initVec';
import { InitialVelocityNoise } from './initializers/initialVelocityNoise';
import { NormalAlignToCP } from './initializers/normalAlignToCP';
import { PositionOffset } from './initializers/positionOffset';
import { PositionWarpScalar } from './initializers/positionWarpScalar';
import { RandomColor } from './initializers/randomColor';
import { RandomSequence } from './initializers/randomSequence';
import { RandomYawFlip } from './initializers/randomYawFlip';
import { RemapInitialDirectionToTransformToVector } from './initializers/remapInitialDirectionToTransformToVector';
import { RemapInitialTransformDirectionToRotation } from './initializers/remapInitialTransformDirectionToRotation';
import { RemapTransformOrientationToRotations as InitRemapTransformOrientationToRotations } from './initializers/remapTransformOrientationToRotations';
import { RemapTransformToVector } from './initializers/remapTransformToVector';
import { RingWave } from './initializers/ringWave';
import { SequenceLifeTime } from './initializers/sequenceLifeTime';
import { SetAttributeToScalarExpression } from './initializers/setAttributeToScalarExpression';
import { SetVectorAttributeToVectorExpression } from './initializers/setVectorAttributeToVectorExpression';
import { VelocityRandom } from './initializers/velocityRandom';
import { BasicMovement } from './operators/basicMovement';
import { CalculateVectorAttribute } from './operators/calculateVectorAttribute';
import { ClampScalar } from './operators/clampScalar';
import { ColorInterpolate } from './operators/colorInterpolate';
import { CycleScalar } from './operators/cycleScalar';
import { AlphaDecay } from './operators/alphaDecay';
import { Decay } from './operators/decay';
import { FadeAndKill } from './operators/fadeAndKill';
import { DistanceToTransform } from './operators/distanceToTransform';
import { EndCapTimedDecay } from './operators/endCapTimedDecay';
import { FadeOutRandom } from './operators/fadeOutRandom';
import { FadeInSimple, FadeOutSimple } from './operators/fadeSimple';
import { InheritFromParentParticlesV2 } from './operators/inheritFromParentParticlesV2';
import { InterpolateRadius } from './operators/interpolateRadius';
import { LerpEndCapScalar } from './operators/lerpEndCapScalar';
import { LerpScalar } from './operators/lerpScalar';
import { MaintainSequentialPath } from './operators/maintainSequentialPath';
import { MaxVelocity } from './operators/maxVelocity';
import { MovementRotateParticleAroundAxis } from './operators/movementRotateParticleAroundAxis';
import { Noise } from './operators/noise';
import { NormalLock } from './operators/normalLock';
import { OrientTo2dDirection } from './operators/orientTo2dDirection';
import { OscillateVector } from './operators/oscillateVector';
import { OscillateVectorSimple } from './operators/oscillateVectorSimple';
import { LockToBone } from './operators/lockToBone';
import { PositionLock } from './operators/positionLock';
import { SnapshotRigidSkinToBones } from './operators/snapshotRigidSkinToBones';
import { RampScalarLinearSimple } from './operators/rampScalarLinearSimple';
import { RemapDirectionToCPToVector } from './operators/remapDirectionToCPToVector';
import { RemapSpeed } from './operators/remapSpeed';
import { RemapTransformOrientationToRotations } from './operators/remapTransformOrientationToRotations';
import { RotateVector } from './operators/rotateVector';
import { SetFloat } from './operators/setFloat';
import { SetFloatCollection } from './operators/setFloatCollection';
import { SetPerChildControlPoint } from './operators/setPerChildControlPoint';
import { SetToCP } from './operators/setToCP';
import { SetUserEvent } from './operators/setUserEvent';
import { SetVec } from './operators/setVec';
import { Spin } from './operators/spin';
import { SpinUpdate } from './operators/spinUpdate';
import { SpinYaw } from './operators/spinYaw';
import { VectorNoise } from './operators/vectorNoise';
import type { ParticleDefinitionParser } from './parser';
import { RemapSpeedtoCP } from './preEmission/remapSpeedtoCP';
import { SetControlPointFieldToScalarExpression } from './preEmission/setControlPointFieldToScalarExpression';
import { SetControlPointOrientation } from './preEmission/setControlPointOrientation';
import { SetControlPointToVectorExpression } from './preEmission/setControlPointToVectorExpression';
import { SetParentControlPointsToChildCP } from './preEmission/setParentControlPointsToChildCP';
import { SetSingleControlPointPosition } from './preEmission/setSingleControlPointPosition';
import { StopAfterDuration } from './preEmission/stopAfterDuration';

export type FunctionKind = 'preEmission' | 'emitter' | 'initializer' | 'operator' | 'forceGenerator' | 'constraint';

type Factory = (parse: ParticleDefinitionParser) => ParticleFunction;

/** The classes this runtime implements, by kind. */
const PORTED: Record<FunctionKind, Readonly<Record<string, Factory>>> = {
  preEmission: {
    C_OP_SetControlPointFieldToScalarExpression: (parse) => new SetControlPointFieldToScalarExpression(parse),
    C_OP_SetControlPointOrientation: (parse) => new SetControlPointOrientation(parse),
    C_OP_StopAfterCPDuration: (parse) => new StopAfterDuration(parse),
    C_OP_RemapSpeedtoCP: (parse) => new RemapSpeedtoCP(parse),
    C_OP_SetControlPointToVectorExpression: (parse) => new SetControlPointToVectorExpression(parse),
    C_OP_SetParentControlPointsToChildCP: (parse) => new SetParentControlPointsToChildCP(parse),
    C_OP_SetSingleControlPointPosition: (parse) => new SetSingleControlPointPosition(parse),
  },
  emitter: {
    C_OP_InstantaneousEmitter: (parse) => new InstantaneousEmitter(parse),
    C_OP_ContinuousEmitter: (parse) => new ContinuousEmitter(parse),
    C_OP_MaintainEmitter: (parse) => new MaintainEmitter(parse),
    C_OP_NoiseEmitter: (parse) => new NoiseEmitter(parse),
  },
  initializer: {
    C_INIT_CreateFromParentParticles: (parse) => new CreateFromParentParticles(parse),
    C_INIT_RemapInitialTransformDirectionToRotation: (parse) => new RemapInitialTransformDirectionToRotation(parse),
    C_INIT_RemapTransformToVector: (parse) => new RemapTransformToVector(parse),
    C_INIT_SequenceLifeTime: (parse) => new SequenceLifeTime(parse),
    C_INIT_InitFromParentKilled: (parse) => new InitFromParentKilled(parse),
    C_INIT_RemapTransformOrientationToRotations: (parse) => new InitRemapTransformOrientationToRotations(parse),
    C_INIT_SetAttributeToScalarExpression: (parse) => new SetAttributeToScalarExpression(parse),
    C_INIT_InheritVelocity: (parse) => new InheritVelocity(parse),
    C_INIT_RemapInitialDirectionToTransformToVector: (parse) => new RemapInitialDirectionToTransformToVector(parse),
    C_INIT_SetVectorAttributeToVectorExpression: (parse) => new SetVectorAttributeToVectorExpression(parse),
    C_INIT_PositionWarpScalar: (parse) => new PositionWarpScalar(parse),
    C_INIT_CreateSequentialPathV2: (parse) => new CreateSequentialPathV2(parse),
    C_INIT_CreateOnModel: (parse) => new CreateOnModel(parse),
    C_INIT_CreateWithinBox: (parse) => new CreateWithinBox(parse),
    C_INIT_InitSkinnedPositionFromCPSnapshot: (parse) => new InitSkinnedPositionFromCPSnapshot(parse),
    C_INIT_CreateWithinSphereTransform: (parse) => new CreateWithinSphereTransform(parse),
    C_INIT_InitFloat: (parse) => new InitFloat(parse),
    C_INIT_InitVec: (parse) => new InitVec(parse),
    C_INIT_InitialVelocityNoise: (parse) => new InitialVelocityNoise(parse),
    C_INIT_NormalAlignToCP: (parse) => new NormalAlignToCP(parse),
    C_INIT_PositionOffset: (parse) => new PositionOffset(parse),
    C_INIT_RandomColor: (parse) => new RandomColor(parse),
    C_INIT_RandomSequence: (parse) => new RandomSequence(parse),
    C_INIT_RandomYawFlip: (parse) => new RandomYawFlip(parse),
    C_INIT_RingWave: (parse) => new RingWave(parse),
    C_INIT_VelocityRandom: (parse) => new VelocityRandom(parse),
  },
  operator: {
    C_OP_FadeOut: (parse) => new FadeOutRandom(parse),
    C_OP_InheritFromParentParticlesV2: (parse) => new InheritFromParentParticlesV2(parse),
    C_OP_LerpScalar: (parse) => new LerpScalar(parse),
    C_OP_OrientTo2dDirection: (parse) => new OrientTo2dDirection(parse),
    C_OP_RemapDirectionToCPToVector: (parse) => new RemapDirectionToCPToVector(parse),
    C_OP_SetPerChildControlPoint: (parse) => new SetPerChildControlPoint(parse),
    C_OP_SetUserEvent: (parse) => new SetUserEvent(parse),
    C_OP_SpinYaw: (parse) => new SpinYaw(parse),
    C_OP_CycleScalar: (parse) => new CycleScalar(parse),
    C_OP_RemapSpeed: (parse) => new RemapSpeed(parse),
    C_OP_RemapTransformOrientationToRotations: (parse) => new RemapTransformOrientationToRotations(parse),
    C_OP_RotateVector: (parse) => new RotateVector(parse),
    C_OP_Spin: (parse) => new Spin(parse),
    C_OP_ClampScalar: (parse) => new ClampScalar(parse),
    C_OP_SetFloatCollection: (parse) => new SetFloatCollection(parse),
    C_OP_SetToCP: (parse) => new SetToCP(parse),
    C_OP_CalculateVectorAttribute: (parse) => new CalculateVectorAttribute(parse),
    C_OP_MaintainSequentialPath: (parse) => new MaintainSequentialPath(parse),
    C_OP_Noise: (parse) => new Noise(parse),
    C_OP_OscillateVector: (parse) => new OscillateVector(parse),
    C_OP_OscillateVectorSimple: (parse) => new OscillateVectorSimple(parse),
    C_OP_DistanceToTransform: (parse) => new DistanceToTransform(parse),
    C_OP_BasicMovement: (parse) => new BasicMovement(parse),
    C_OP_ColorInterpolate: (parse) => new ColorInterpolate(parse),
    C_OP_Decay: (parse) => new Decay(parse),
    C_OP_AlphaDecay: (parse) => new AlphaDecay(parse),
    C_OP_FadeAndKill: (parse) => new FadeAndKill(parse),
    C_OP_EndCapTimedDecay: (parse) => new EndCapTimedDecay(parse),
    C_OP_FadeInSimple: (parse) => new FadeInSimple(parse),
    C_OP_FadeOutSimple: (parse) => new FadeOutSimple(parse),
    C_OP_InterpolateRadius: (parse) => new InterpolateRadius(parse),
    C_OP_LerpEndCapScalar: (parse) => new LerpEndCapScalar(parse),
    C_OP_MaxVelocity: (parse) => new MaxVelocity(parse),
    C_OP_MovementRotateParticleAroundAxis: (parse) => new MovementRotateParticleAroundAxis(parse),
    C_OP_NormalLock: (parse) => new NormalLock(parse),
    C_OP_LockToBone: (parse) => new LockToBone(parse),
    C_OP_PositionLock: (parse) => new PositionLock(parse),
    C_OP_SnapshotRigidSkinToBones: (parse) => new SnapshotRigidSkinToBones(parse),
    C_OP_RampScalarLinearSimple: (parse) => new RampScalarLinearSimple(parse),
    C_OP_SetFloat: (parse) => new SetFloat(parse),
    C_OP_SetVec: (parse) => new SetVec(parse),
    C_OP_SpinUpdate: (parse) => new SpinUpdate(parse),
    C_OP_VectorNoise: (parse) => new VectorNoise(parse),
  },
  forceGenerator: {
    C_OP_AttractToControlPoint: (parse) => new AttractToControlPoint(parse),
    C_OP_CurlNoiseForce: (parse) => new CurlNoiseForce(parse),
  },
  constraint: {
    C_OP_ConstrainDistance: (parse) => new ConstrainDistance(parse),
    C_OP_WorldTraceConstraint: (parse) => new WorldTraceConstraint(parse),},
};

/** Every class ValveResourceFormat registers, by kind (generated from ParticleControllerFactory.cs). */
export const VRF_CLASSES: Record<FunctionKind, readonly string[]> = {
  preEmission: [
    'C_OP_ChooseRandomChildrenInGroup',
    'C_OP_ControlPointToRadialScreenSpace',
    'C_OP_DistanceBetweenCPsToCP',
    'C_OP_DriveCPFromGlobalSoundFloat',
    'C_OP_EnableChildrenFromParentParticleCount',
    'C_OP_ForceControlPointStub',
    'C_OP_HSVShiftToCP',
    'C_OP_LightningSnapshotGenerator',
    'C_OP_RampCPLinearRandom',
    'C_OP_RemapAverageScalarValuetoCP',
    'C_OP_RemapBoundingVolumetoCP',
    'C_OP_RemapCPtoCP',
    'C_OP_RemapDotProductToCP',
    'C_OP_RemapModelVolumetoCP',
    'C_OP_RemapSpeedtoCP',
    'C_OP_RepeatedTriggerChildGroup',
    'C_OP_SelectivelyEnableChildren',
    'C_OP_SetControlPointFieldFromVectorExpression',
    'C_OP_SetControlPointFieldToScalarExpression',
    'C_OP_SetControlPointFieldToWater',
    'C_OP_SetControlPointOrientationToCPVelocity',
    'C_OP_SetControlPointPositionToRandomActiveCP',
    'C_OP_SetCPOrientationToPointAtCP',
    'C_OP_SetControlPointPositions',
    'C_OP_SetControlPointRotation',
    'C_OP_SetControlPointToCenter',
    'C_OP_SetControlPointFromObjectScale',
    'C_OP_SetControlPointToImpactPoint',
    'C_OP_SetControlPointToPlayer',
    'C_OP_SetControlPointToVectorExpression',
    'C_OP_SetControlPointOrientation',
    'C_OP_PlayEndCapWhenFinished',
    'C_OP_SetGravityToCP',
    'C_OP_SetParentControlPointsToChildCP',
    'C_OP_SetRandomControlPointPosition',
    'C_OP_SetSimulationRate',
    'C_OP_SetSingleControlPointPosition',
    'C_OP_StopAfterCPDuration',
  ],
  emitter: [
    'C_OP_InstantaneousEmitter',
    'C_OP_ContinuousEmitter',
    'C_OP_MaintainEmitter',
    'C_OP_NoiseEmitter',
  ],
  initializer: [
    'C_INIT_AgeNoise',
    'C_INIT_ColorLitPerParticle',
    'C_INIT_CreateAlongPath',
    'C_INIT_CreateInEpitrochoid',
    'C_INIT_CreateOnModel',
    'C_INIT_CreateOnModelAtHeight',
    'C_INIT_CreateOnGrid',
    'C_INIT_CreateParticleImpulse',
    'C_INIT_CreatePhyllotaxis',
    'C_INIT_CreateSequentialPath',
    'C_INIT_CreateSequentialPathV2',
    'C_INIT_CreateSpiralSphere',
    'C_INIT_CreateWithinBox',
    'C_INIT_CreateWithinCone',
    'C_INIT_CreateWithinSphereTransform',
    'C_INIT_CreateFromCPs',
    'C_INIT_CreateFromParentParticles',
    'C_INIT_CreateFromPlaneCache',
    'C_INIT_CreationNoise',
    'C_INIT_DistanceCull',
    'C_INIT_DistanceToCPInit',
    'C_INIT_DistanceToNeighborCull',
    'C_INIT_InheritFromParentParticles',
    'C_INIT_GlobalScale',
    'C_INIT_InitFromCPSnapshot',
    'C_INIT_InitFromParentKilled',
    'C_INIT_InitialSequenceFromModel',
    'C_INIT_InitialVelocityFromHitbox',
    'C_INIT_InitSkinnedPositionFromCPSnapshot',
    'C_INIT_InitFloat',
    'C_INIT_InitFloatCollection',
    'C_INIT_InitVec',
    'C_INIT_InitialRepulsionVelocity',
    'C_INIT_InitialVelocityNoise',
    'C_INIT_InitVecCollection',
    'C_INIT_LifespanFromVelocity',
    'C_INIT_ModelCull',
    'C_INIT_Orient2DRelToCP',
    'C_INIT_PlaneCull',
    'C_INIT_PointList',
    'C_INIT_PositionOffset',
    'C_INIT_PositionOffsetToCP',
    'C_INIT_PositionPlaceOnGround',
    'C_INIT_PositionWarp',
    'C_INIT_PositionWarpScalar',
    'C_INIT_QuantizeFloat',
    'C_INIT_RadiusFromCPObject',
    'C_INIT_RandomColor',
    'C_INIT_RandomModelSequence',
    'C_INIT_RandomNamedModelBodyPart',
    'C_INIT_RandomNamedModelMeshGroup',
    'C_INIT_RandomNamedModelSequence',
    'C_INIT_RandomSequence',
    'C_INIT_ScaleVelocity',
    'C_INIT_SequenceLifeTime',
    'C_INIT_SetHitboxToClosest',
    'C_INIT_SetHitboxToModel',
    'C_INIT_SetRigidAttachment',
    'C_INIT_StatusEffect',
    'C_INIT_StatusEffectCitadel',
    'C_INIT_RandomSecondSequence',
    'C_INIT_RandomVectorComponent',
    'C_INIT_RandomYawFlip',
    'C_INIT_NormalAlignToCP',
    'C_INIT_MoveBetweenPoints',
    'C_INIT_NormalOffset',
    'C_INIT_RemapInitialDirectionToTransformToVector',
    'C_INIT_RemapInitialTransformDirectionToRotation',
    'C_INIT_RemapInitialVisibilityScalar',
    'C_INIT_RemapNamedModelBodyPartToScalar',
    'C_INIT_RemapNamedModelMeshGroupToScalar',
    'C_INIT_RemapNamedModelSequenceToScalar',
    'C_INIT_RemapQAnglesToRotation',
    'C_INIT_RemapScalarToVector',
    'C_INIT_RemapTransformOrientationToRotations',
    'C_INIT_RemapTransformToVector',
    'C_INIT_RemapParticleCountToScalar',
    'C_INIT_RemapParticleCountToNamedModelSequenceScalar',
    'C_INIT_RingWave',
    'C_INIT_RtEnvCull',
    'C_INIT_SequenceFromCP',
    'C_INIT_SetAttributeToScalarExpression',
    'C_INIT_SetFloatAttributeToVectorExpression',
    'C_INIT_SetVectorAttributeToVectorExpression',
    'C_INIT_VelocityFromCP',
    'C_INIT_InheritVelocity',
    'C_INIT_VelocityFromNormal',
    'C_INIT_VelocityRadialRandom',
    'C_INIT_VelocityRandom',
  ],
  operator: [
    'C_OP_AlphaDecay',
    'C_OP_BasicMovement',
    'C_OP_CalculateVectorAttribute',
    'C_OP_ChladniWave',
    'C_OP_ClampScalar',
    'C_OP_ClampVector',
    'C_OP_ColorAdjustHSL',
    'C_OP_ColorInterpolate',
    'C_OP_ColorInterpolateRandom',
    'C_OP_ConnectParentParticleToNearest',
    'C_OP_CPOffsetToPercentageBetweenCPs',
    'C_OP_Cull',
    'C_OP_CycleScalar',
    'C_OP_ControlpointLight',
    'C_OP_CylindricalDistanceToTransform',
    'C_OP_DampenToCP',
    'C_OP_Decay',
    'C_OP_DecayClampCount',
    'C_OP_DecayMaintainCount',
    'C_OP_DecayOffscreen',
    'C_OP_DifferencePreviousParticle',
    'C_OP_DistanceBetweenTransforms',
    'C_OP_DistanceBetweenVecs',
    'C_OP_DistanceCull',
    'C_OP_DistanceToTransform',
    'C_OP_DragRelativeToPlane',
    'C_OP_EndCapDecay',
    'C_OP_EndCapTimedDecay',
    'C_OP_EndCapTimedFreeze',
    'C_OP_FadeAndKill',
    'C_OP_FadeAndKillForTracers',
    'C_OP_FadeIn',
    'C_OP_FadeInSimple',
    'C_OP_FadeOut',
    'C_OP_FadeOutSimple',
    'C_OP_InheritFromParentParticles',
    'C_OP_InheritFromParentParticlesV2',
    'C_OP_InheritFromPeerSystem',
    'C_OP_InterpolateRadius',
    'C_OP_LagCompensation',
    'C_OP_LazyCullCompareFloat',
    'C_OP_LerpEndCapScalar',
    'C_OP_LerpEndCapVector',
    'C_OP_LerpScalar',
    'C_OP_LerpToInitialPosition',
    'C_OP_LerpToOtherAttribute',
    'C_OP_LerpVector',
    'C_OP_LockPoints',
    'C_OP_LockToBone',
    'C_OP_LockToSavedSequentialPath',
    'C_OP_LockToSavedSequentialPathV2',
    'C_OP_MaintainSequentialPath',
    'C_OP_MaxVelocity',
    'C_OP_ModelCull',
    'C_OP_ModelDampenMovement',
    'C_OP_MovementLoopInsideSphere',
    'C_OP_MovementMaintainOffset',
    'C_OP_MovementMoveAlongSkinnedCPSnapshot',
    'C_OP_MoveToHitbox',
    'C_OP_MovementPlaceOnGround',
    'C_OP_MovementRigidAttachToCP',
    'C_OP_MovementRotateParticleAroundAxis',
    'C_OP_MovementSkinnedPositionFromCPSnapshot',
    'C_OP_Noise',
    'C_OP_OrientTo2dDirection',
    'C_OP_RadiusDecay',
    'C_OP_RemapDotProductToScalar',
    'C_OP_VectorNoise',
    'C_OP_NormalLock',
    'C_OP_NormalizeVector',
    'C_OP_Orient2DRelToCP',
    'C_OP_OscillateScalar',
    'C_OP_OscillateScalarSimple',
    'C_OP_OscillateVector',
    'C_OP_OscillateVectorSimple',
    'C_OP_PercentageBetweenTransformLerpCPs',
    'C_OP_PercentageBetweenTransforms',
    'C_OP_PercentageBetweenTransformsVector',
    'C_OP_PinParticleToCP',
    'C_OP_PlaneCull',
    'C_OP_PointVectorAtNextParticle',
    'C_OP_RestartAfterDuration',
    'C_OP_PositionLock',
    'C_OP_QuantizeFloat',
    'C_OP_RampScalarLinear',
    'C_OP_RampScalarLinearSimple',
    'C_OP_RampScalarSpline',
    'C_OP_RampScalarSplineSimple',
    'C_OP_ReadFromNeighboringParticle',
    'C_OP_RemapCrossProductOfTwoVectorsToVector',
    'C_OP_RemapControlPointDirectionToVector',
    'C_OP_RemapCPtoScalar',
    'C_OP_RemapCPtoVector',
    'C_OP_RemapControlPointOrientationToRotation',
    'C_OP_RemapCPVelocityToVector',
    'C_OP_RemapDirectionToCPToVector',
    'C_OP_RemapDistanceToLineSegmentToScalar',
    'C_OP_RemapDistanceToLineSegmentToVector',
    'C_OP_RemapNamedModelBodyPartEndCap',
    'C_OP_RemapNamedModelBodyPartOnceTimed',
    'C_OP_RemapNamedModelMeshGroupEndCap',
    'C_OP_RemapNamedModelMeshGroupOnceTimed',
    'C_OP_RemapNamedModelSequenceEndCap',
    'C_OP_RemapNamedModelSequenceOnceTimed',
    'C_OP_SetCPtoVector',
    'C_OP_RemapParticleCountToScalar',
    'C_OP_RemapParticleCountOnScalarEndCap',
    'C_OP_ReinitializeScalarEndCap',
    'C_OP_RemapScalar',
    'C_OP_RemapScalarEndCap',
    'C_OP_RemapScalarOnceTimed',
    'C_OP_RemapSpeed',
    'C_OP_RemapVelocityToVector',
    'C_OP_RemapVectorToRotations',
    'C_OP_RemapTransformOrientationToRotations',
    'C_OP_RemapTransformOrientationToYaw',
    'C_OP_RemapTransformToVelocity',
    'C_OP_RemapTransformVisibilityToScalar',
    'C_OP_RemapTransformVisibilityToVector',
    'C_OP_RemapVectorComponentToScalar',
    'C_OP_RemapVectortoCP',
    'C_OP_RemapVisibilityScalar',
    'C_OP_RotateVector',
    'C_OP_SequenceFromModel',
    'C_OP_SetAttributeToScalarExpression',
    'C_OP_SetChildControlPoints',
    'C_OP_SetControlPointsToModelParticles',
    'C_OP_SetControlPointsToParticle',
    'C_OP_SetCPOrientationToDirection',
    'C_OP_SetCPOrientationToGroundNormal',
    'C_OP_SetFloat',
    'C_OP_SetFloatAttributeToVectorExpression',
    'C_OP_SetFloatCollection',
    'C_OP_SetFromCPSnapshot',
    'C_OP_SetPerChildControlPoint',
    'C_OP_SetPerChildControlPointFromAttribute',
    'C_OP_SetToCP',
    'C_OP_SetUserEvent',
    'C_OP_SetVec',
    'C_OP_SetVectorAttributeToVectorExpression',
    'C_OP_SnapshotRigidSkinToBones',
    'C_OP_SnapshotSkinToBones',
    'C_OP_Spin',
    'C_OP_SpinUpdate',
    'C_OP_SpinYaw',
    'C_OP_TeleportBeam',
    'C_OP_UpdateLightSource',
    'C_OP_VelocityDecay',
    'C_OP_VelocityMatchingForce',
  ],
  forceGenerator: [
    'C_OP_AttractToControlPoint',
    'C_OP_CPVelocityForce',
    'C_OP_CurlNoiseForce',
    'C_OP_ExternalGameImpulseForce',
    'C_OP_ExternalGenericForce',
    'C_OP_ExternalWindForce',
    'C_OP_ForceBasedOnDistanceToPlane',
    'C_OP_IntraParticleForce',
    'C_OP_LocalAccelerationForce',
    'C_OP_ParentVortices',
    'C_OP_PerParticleForce',
    'C_OP_RandomForce',
    'C_OP_ScreenForceFromPlayerView',
    'C_OP_TimeVaryingForce',
    'C_OP_TurbulenceForce',
    'C_OP_TwistAroundAxis',
    'C_OP_WindForce',
  ],
  constraint: [
    'C_OP_BoxConstraint',
    'C_OP_CollideWithParentParticles',
    'C_OP_CollideWithSelf',
    'C_OP_ConstrainDistance',
    'C_OP_ConstrainDistanceToPath',
    'C_OP_ConstrainDistanceToUserSpecifiedPath',
    'C_OP_ConstrainLineLength',
    'C_OP_PlanarConstraint',
    'C_OP_RopeSpringConstraint',
    'C_OP_WorldCollideConstraint',
    'C_OP_WorldTraceConstraint',
  ],
};

const VRF_CLASS_SETS: Record<FunctionKind, ReadonlySet<string>> = {
  preEmission: new Set(VRF_CLASSES.preEmission),
  emitter: new Set(VRF_CLASSES.emitter),
  initializer: new Set(VRF_CLASSES.initializer),
  operator: new Set(VRF_CLASSES.operator),
  forceGenerator: new Set(VRF_CLASSES.forceGenerator),
  constraint: new Set(VRF_CLASSES.constraint),
};

/** Whether this runtime implements `className` as a function of `kind`. */
export function isPorted(kind: FunctionKind, className: string): boolean {
  return Object.prototype.hasOwnProperty.call(PORTED[kind], className);
}

/** The classes this runtime implements, by kind. */
export function portedClasses(kind: FunctionKind): string[] {
  return Object.keys(PORTED[kind]);
}

/**
 * Creates the function `className` names (ParticleControllerFactory.TryCreateX), or reports null and
 * whether ValveResourceFormat itself knows the class.
 */
export function createFunction(
  kind: FunctionKind,
  className: string,
  parse: ParticleDefinitionParser,
): { function: ParticleFunction | null; knownToVrf: boolean } {
  const knownToVrf = VRF_CLASS_SETS[kind].has(className);

  if (!isPorted(kind, className)) {
    return { function: null, knownToVrf };
  }

  return { function: PORTED[kind][className](parse), knownToVrf };
}
