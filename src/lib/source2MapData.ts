import { z } from 'zod';

const number = z.number().finite();
const vec3 = z.tuple([number, number, number]);
export const probeVolumeSchema = z.object({
  matrix: z.array(number).length(16), min: vec3, max: vec3, size: vec3, offset: vec3,
  fade: vec3, priority: number, handshake: number,
});
export type Source2ProbeVolume = z.infer<typeof probeVolumeSchema>;
export const mapLightDistributionSchema = z.object({
  kind: z.enum(['omni', 'barn', 'sun']), matrix: z.array(number).length(16), brightness: number,
  size: vec3, shear: z.tuple([number, number]), soft: z.tuple([number, number]), shape: number,
  skirt: number, nearSkirt: number, inner: number, outer: number, temperature: number.nullable(),
});
export const mapProbesSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unavailable') }),
  z.object({ kind: z.literal('atlas'), file: z.literal('probes.bin'), shadows: z.literal('probe-shadows.bin').nullable(),
    encoding: z.enum(['linear', 'rgbm']), volumes: z.array(probeVolumeSchema).max(128) }),
]);
export const mapPostSchema = z.object({
  tonemap: z.object({ exposureBias: number, shoulderStrength: number, linearStrength: number, linearAngle: number,
    toeStrength: number, toeNum: number, toeDenom: number.positive(), whitePoint: number }),
  bloom: z.object({ blendMode: z.enum(['BLOOM_BLEND_ADD', 'BLOOM_BLEND_SCREEN', 'BLOOM_BLEND_BLUR']),
    addBloomStrength: number, screenBloomStrength: number, blurBloomStrength: number, bloomThreshold: number,
    bloomThresholdWidth: number, blurWeight: z.tuple([number, number, number, number, number]), blurTint: z.array(vec3).length(5) }).nullable(),
  exposure: number.positive(), fullScreenGamma: number.positive(),
});
export const mapLutSchema = z.object({ file: z.literal('color-correction.bin'), dimension: z.number().int().min(2).max(64) }).nullable();
/** The map sky: an env_sky material's cube, exposed as the sky shader does. */
export const mapSkySchema = z.object({ file: z.literal('sky.bin'), exposureBias: number, tint: vec3 }).nullable();
export const mapFogVolumeSchema = z.object({
  matrix: z.array(number).length(16), min: vec3, max: vec3, shape: z.number().int().min(0).max(1),
  strength: number.nonnegative(), falloffExponent: number.nonnegative(),
  indirectStrength: number.nonnegative().nullable(), tint: vec3.nullable(),
});
/**
 * Volumetric fog: the master env_volumetric_fog_controller, its baked indirect
 * irradiance volume and the env_volumetric_fog_volume density boxes.
 */
export const mapFogSchema = z.object({
  file: z.literal('fog.bin'), matrix: z.array(number).length(16), min: vec3, max: vec3,
  strength: number.nonnegative(), indirectStrength: number.nonnegative(), tint: vec3,
  drawDistance: number.positive(), fadeIn: z.tuple([number, number]),
  volumes: z.array(mapFogVolumeSchema).max(16),
}).nullable();
export type Source2MapFog = NonNullable<z.infer<typeof mapFogSchema>>;
