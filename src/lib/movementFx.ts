import { z } from 'zod';
import type { FxDescriptor } from '../components/locker/fxDescriptor';

export const movementFxSchema = z.object({
  kind: z.enum(['dash', 'heavy-melee']),
  color: z.string().regex(/^#[a-f0-9]{6}$/i),
  palette: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('solid') }).strict(),
    z.object({ mode: z.literal('gradient'), end: z.string().regex(/^#[a-f0-9]{6}$/i) }).strict(),
    z.object({ mode: z.literal('rainbow') }).strict(),
  ]).default({ mode: 'solid' }),
  image: z.string().max(750_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).nullable(),
  brightness: z.number().min(.25).max(4).default(1),
  illuminated: z.boolean().default(false),
  outline: z.boolean().default(false),
  outlineColor: z.string().regex(/^#[a-f0-9]{6}$/i).default('#ffffff'),
}).strict().refine((value) => !value.image || value.kind === 'dash', 'Image stamps require dash trails.');
export type MovementFxChoice = z.infer<typeof movementFxSchema>;
export const movementFxLinkSchema = z.object({ kind: z.literal('movement'), choice: movementFxSchema }).strict();
export type MovementFxLink = z.infer<typeof movementFxLinkSchema>;
export const movementFxSaveSchema = z.object({
  choice: movementFxSchema,
  thumbnailDataUrl: z.string().max(1_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export type MovementFxSaveRequest = z.infer<typeof movementFxSaveSchema>;
export const movementFxPreviewSchema = z.object({ choice: movementFxSchema, heroName: z.string().min(1).max(100) }).strict();
export type MovementFxPreviewRequest = z.infer<typeof movementFxPreviewSchema>;
export interface MovementFxPreview { key: string; descriptor: FxDescriptor; textureBaseUrl: string }
