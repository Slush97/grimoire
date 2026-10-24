import { z } from 'zod';

export const profileShuffleSchema = z.object({
  onLaunch: z.boolean(),
  included: z.array(z.string().min(1).max(1024)).max(10000),
  variants: z.array(z.tuple([
    z.string().min(1).max(1024),
    z.union([z.literal('random'), z.object({ fileId: z.number().int().positive() })]),
  ])).max(10000),
});

export type ProfileShuffle = z.infer<typeof profileShuffleSchema>;
