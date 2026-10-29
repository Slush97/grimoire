// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/PackedBones.cs.
//
// Four bone indices of 16 bits each packed into a 64-bit value from the low bits up, as the
// BoneIndices attribute holds them.

/** How many bones fit. */
export const PACKED_BONE_COUNT = 4;

/** The index of a slot that holds no bone. */
export const PACKED_BONE_NONE = 0xffff;

/** Every slot holding no bone. */
export const PACKED_BONES_ALL_NONE = 0xffffffffffffffffn;

/** The bone in `slot`. */
export function getPackedBone(bones: bigint, slot: number): number {
  return Number((bones >> BigInt(16 * slot)) & 0xffffn);
}

/** `bone` placed in `slot`, for combining with the other slots. */
export function packBone(bone: number, slot: number): bigint {
  return BigInt(bone & 0xffff) << BigInt(16 * slot);
}
