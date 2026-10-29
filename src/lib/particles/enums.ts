// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Enums/*.cs and the enums
// of AttributeMapping.cs. Each enum is a frozen name-to-value table, which the definition parser
// also uses to read the enum from its member name.

/** A C# enum as a name-to-value table. */
export type EnumTable = Readonly<Record<string, number>>;

export const ParticleControlPointAxis = {
  PARTICLE_CP_AXIS_X: 0,
  PARTICLE_CP_AXIS_Y: 1,
  PARTICLE_CP_AXIS_Z: 2,
  PARTICLE_CP_AXIS_NEGATIVE_X: 3,
  PARTICLE_CP_AXIS_NEGATIVE_Y: 4,
  PARTICLE_CP_AXIS_NEGATIVE_Z: 5,
} as const;

export const ParticleDirectionNoiseType = {
  PARTICLE_DIR_NOISE_PERLIN: 0,
  PARTICLE_DIR_NOISE_CURL: 1,
  PARTICLE_DIR_NOISE_WORLEY_BASIC: 2,
} as const;

export const VectorExpression = {
  VECTOR_EXPRESSION_UNINITIALIZED: -1,
  VECTOR_EXPRESSION_ADD: 0,
  VECTOR_EXPRESSION_SUBTRACT: 1,
  VECTOR_EXPRESSION_MUL: 2,
  VECTOR_EXPRESSION_DIVIDE: 3,
  VECTOR_EXPRESSION_INPUT_1: 4,
  VECTOR_EXPRESSION_MIN: 5,
  VECTOR_EXPRESSION_MAX: 6,
  VECTOR_EXPRESSION_CROSSPRODUCT: 7,
  VECTOR_EXPRESSION_LERP: 8,
} as const;

export const ParticleField = {
  Position: 0,
  LifeDuration: 1,
  PositionPrevious: 2,
  Radius: 3,
  Roll: 4,
  RollSpeed: 5,
  Color: 6,
  Alpha: 7,
  CreationTime: 8,
  SequenceNumber: 9,
  TrailLength: 10,
  ParticleId: 11,
  Yaw: 12,
  SecondSequenceNumber: 13,
  HitboxIndex: 14,
  HitboxOffsetPosition: 15,
  AlphaAlternate: 16,
  ScratchVector: 17,
  ScratchFloat: 18,
  NoneDisabled: 19,
  Pitch: 20,
  Normal: 21,
  GlowRgb: 22,
  GlowAlpha: 23,
  SceneObjectPointer: 24,
  ModelHelperPointer: 25,
  ScratchFloat1: 26,
  ScratchFloat2: 27,
  SceneObjectPointer2: 28,
  RefCountedPointer: 29,
  ScratchVector2: 30,
  BoneIndices: 31,
  BoneWeights: 32,
  ParentParticleIndex: 33,
  ForceScale: 34,
  ModelHelperPointer2: 35,
  ModelHelperPointer3: 36,
  ModelHelperPointer4: 37,
  ManualAnimationFrame: 38,
  ShaderExtraData1: 39,
  ShaderExtraData2: 40,
  BoxMins: 41,
  BoxMaxs: 42,
  BoxAngles: 43,
  BoxFlags: 44,
  UserEventStates: 45,
  ParentParticleId: 46,
  RopeSegmentId: 47,
  RopeSegmentData: 48,
} as const;

export type ParticleField = number;

/** The name of a field, for diagnostics and the diff harness. */
export function particleFieldName(field: ParticleField): string {
  for (const [name, value] of Object.entries(ParticleField)) {
    if (value === field) {
      return name;
    }
  }
  return `Field${field}`;
}

export const ParticleEventType = {
  PARTICLE_EVENT_TYPE_MASK_NONE: 0,
  PARTICLE_EVENT_TYPE_MASK_SPAWNED: 1,
  PARTICLE_EVENT_TYPE_MASK_KILLED: 2,
  PARTICLE_EVENT_TYPE_MASK_COLLISION: 4,
  PARTICLE_EVENT_TYPE_MASK_FIRST_COLLISION: 8,
  PARTICLE_EVENT_TYPE_MASK_COLLISION_STOPPED: 16,
  PARTICLE_EVENT_TYPE_MASK_KILLED_ON_COLLISION: 32,
  PARTICLE_EVENT_TYPE_MASK_USER_1: 64,
  PARTICLE_EVENT_TYPE_MASK_USER_2: 128,
  PARTICLE_EVENT_TYPE_MASK_USER_3: 256,
  PARTICLE_EVENT_TYPE_MASK_USER_4: 512,
  PARTICLE_EVENT_TYPE_MASK_KILLED_ON_CULL: 1024,
  PARTICLE_EVENT_TYPE_MASK_CULLED_ON_SPAWN: 2048,
} as const;

export const ParticleSetMethod = {
  PARTICLE_SET_REPLACE_VALUE: 0,
  PARTICLE_SET_SCALE_INITIAL_VALUE: 1,
  PARTICLE_SET_ADD_TO_INITIAL_VALUE: 2,
  PARTICLE_SET_RAMP_CURRENT_VALUE: 3,
  PARTICLE_SET_SCALE_CURRENT_VALUE: 4,
  PARTICLE_SET_ADD_TO_CURRENT_VALUE: 5,
} as const;

export const ParticleEndCapMode = {
  PARTICLE_ENDCAP_ALWAYS_ON: -1,
  PARTICLE_ENDCAP_ENDCAP_OFF: 0,
  PARTICLE_ENDCAP_ENDCAP_ON: 1,
} as const;

export const ParticleDetailLevel = {
  PARTICLEDETAIL_LOW: 0,
  PARTICLEDETAIL_MEDIUM: 1,
  PARTICLEDETAIL_HIGH: 2,
  PARTICLEDETAIL_ULTRA: 3,
} as const;

// ValveResourceFormat/Particles/Enums/ParticleMissingParentBehavior.cs.
export const ParticleMissingParentBehavior = {
  MISSING_PARENT_DO_NOTHING: -1,
  MISSING_PARENT_KILL: 0,
  MISSING_PARENT_FIND_NEW: 1,
  MISSING_PARENT_SAME_INDEX: 2,
} as const;

// ValveResourceFormat/Particles/Enums/ParticleCollisionMode.cs.
export const ParticleCollisionMode = {
  COLLISION_MODE_PER_PARTICLE_TRACE: 3,
  COLLISION_MODE_USE_NEAREST_TRACE: 2,
  COLLISION_MODE_INITIAL_TRACE_DOWN: 0,
  COLLISION_MODE_DISABLED: -1,
  COLLISION_MODE_PER_FRAME_PLANESET: 1,
} as const;

export const ParticleFloatBiasType = {
  PF_BIAS_TYPE_INVALID: -1,
  PF_BIAS_TYPE_STANDARD: 0,
  PF_BIAS_TYPE_GAIN: 1,
  PF_BIAS_TYPE_EXPONENTIAL: 2,
} as const;

export const ParticleFloatRandomMode = {
  PF_RANDOM_MODE_INVALID: -1,
  PF_RANDOM_MODE_CONSTANT: 0,
  PF_RANDOM_MODE_VARYING: 1,
} as const;

export const ParticleParentSetMode = {
  PARTICLE_SET_PARENT_NO: 0,
  PARTICLE_SET_PARENT_IMMEDIATE: 1,
  PARTICLE_SET_PARENT_ROOT: 2,
} as const;

export const ParticleAttachment = {
  PATTACH_INVALID: -1,
  PATTACH_ABSORIGIN: 0,
  PATTACH_ABSORIGIN_FOLLOW: 1,
  PATTACH_CUSTOMORIGIN: 2,
  PATTACH_CUSTOMORIGIN_FOLLOW: 3,
  PATTACH_POINT: 4,
  PATTACH_POINT_FOLLOW: 5,
  PATTACH_EYES_FOLLOW: 6,
  PATTACH_OVERHEAD_FOLLOW: 7,
  PATTACH_WORLDORIGIN: 8,
  PATTACH_ROOTBONE_FOLLOW: 9,
  PATTACH_RENDERORIGIN_FOLLOW: 10,
  PATTACH_MAIN_VIEW: 11,
  PATTACH_WATERWAKE: 12,
  PATTACH_CENTER_FOLLOW: 13,
  PATTACH_CUSTOM_GAME_STATE_1: 14,
  PATTACH_HEALTHBAR: 15,
} as const;

export const ParticleColorBlendMode = {
  PARTICLEBLEND_DEFAULT: 0,
  PARTICLEBLEND_OVERLAY: 1,
  PARTICLEBLEND_DARKEN: 2,
  PARTICLEBLEND_LIGHTEN: 3,
  PARTICLEBLEND_MULTIPLY: 4,
} as const;

export const ParticleNoiseTurbulence = {
  PF_NOISE_TURB_NONE: 0,
  PF_NOISE_TURB_HIGHLIGHT: 1,
  PF_NOISE_TURB_FEEDBACK: 2,
  PF_NOISE_TURB_LOOPY: 3,
  PF_NOISE_TURB_CONTRAST: 4,
  PF_NOISE_TURB_ALTERNATE: 5,
} as const;

export const ParticleNoiseModifier = {
  PF_NOISE_MODIFIER_NONE: 0,
  PF_NOISE_MODIFIER_LINES: 1,
  PF_NOISE_MODIFIER_CLUMPS: 2,
  PF_NOISE_MODIFIER_RINGS: 3,
} as const;

export const ParticleNoiseType = {
  PF_NOISE_TYPE_PERLIN: 0,
  PF_NOISE_TYPE_SIMPLEX: 1,
  PF_NOISE_TYPE_WORLEY: 2,
  PF_NOISE_TYPE_CURL: 3,
} as const;

// AttributeMapping.cs. Read with EnumNormalized, so they are named as the C# members.

export const PfInputMode = {
  Invalid: -1,
  Clamped: 0,
  Looped: 1,
} as const;

export const PfMapType = {
  Invalid: -1,
  Direct: 0,
  Mult: 1,
  Remap: 2,
  RemapBiased: 3,
  Curve: 4,
  Notched: 5,
  Round: 6,
  Min: 7,
  Max: 8,
  Mod: 9,
} as const;

export const PfRoundType = {
  Invalid: -1,
  Nearest: 0,
  Floor: 1,
  Ceil: 2,
} as const;

// ValveResourceFormat/Particles/Enums/ScalarExpressionType.cs.
export const ScalarExpressionType = {
  SCALAR_EXPRESSION_UNINITIALIZED: -1,
  SCALAR_EXPRESSION_ADD: 0,
  SCALAR_EXPRESSION_SUBTRACT: 1,
  SCALAR_EXPRESSION_MUL: 2,
  SCALAR_EXPRESSION_DIVIDE: 3,
  SCALAR_EXPRESSION_INPUT_1: 4,
  SCALAR_EXPRESSION_MIN: 5,
  SCALAR_EXPRESSION_MAX: 6,
  SCALAR_EXPRESSION_MOD: 7,
  SCALAR_EXPRESSION_EQUAL: 8,
  SCALAR_EXPRESSION_GT: 9,
  SCALAR_EXPRESSION_LT: 10,
} as const;

// ValveResourceFormat/Particles/Enums/VectorExpressionType.cs.
export const VectorExpressionType = {
  VECTOR_EXPRESSION_UNINITIALIZED: -1,
  VECTOR_EXPRESSION_ADD: 0,
  VECTOR_EXPRESSION_SUBTRACT: 1,
  VECTOR_EXPRESSION_MUL: 2,
  VECTOR_EXPRESSION_DIVIDE: 3,
  VECTOR_EXPRESSION_INPUT_1: 4,
  VECTOR_EXPRESSION_MIN: 5,
  VECTOR_EXPRESSION_MAX: 6,
  VECTOR_EXPRESSION_CROSSPRODUCT: 7,
  VECTOR_EXPRESSION_LERP: 8,
} as const;

export const ParticleModelType = {
  PM_TYPE_INVALID: 0,
  PM_TYPE_NAMED_VALUE_MODEL: 1,
  PM_TYPE_NAMED_VALUE_EHANDLE: 2,
  PM_TYPE_CONTROL_POINT: 3,
} as const;

export const SnapshotIndexType = {
  SNAPSHOT_INDEX_INCREMENT: 0,
  SNAPSHOT_INDEX_DIRECT: 1,
} as const;

export const ClosestPointTestType = {
  PARTICLE_CLOSEST_TYPE_BOX: 0,
  PARTICLE_CLOSEST_TYPE_CAPSULE: 1,
  PARTICLE_CLOSEST_TYPE_HYBRID: 2,
} as const;
