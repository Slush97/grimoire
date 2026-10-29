import { z } from 'zod';

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const mapParticleSchema = z.object({
  id: z.string(), classname: z.string(), system: z.string(), startActive: z.boolean(),
  matrix: z.array(z.number().finite()).length(16),
  controlPoints: z.array(z.object({ index: z.number().int().min(0).max(63), matrix: z.array(z.number().finite()).length(16), parent: z.number().int().min(0).max(63) })),
  values: z.array(z.object({ index: z.number().int().min(0).max(63), value: vector })),
  issues: z.array(z.string()),
});
export const mapParticlesSchema = z.object({ file: z.literal('particles/bundle.json'), entities: z.array(mapParticleSchema),
  /** Each particle light cookie's texture path and its file in the bundle, so the room's cookie atlas can hold it. */
  lightCookies: z.record(z.string(), z.string().regex(/^particles\/tex\/[A-Za-z0-9_]+\.png$/)).optional() });
export type MapParticle = z.infer<typeof mapParticleSchema>;
export type MapParticleScene = z.infer<typeof mapParticlesSchema>;
