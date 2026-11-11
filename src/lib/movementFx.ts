import { z } from 'zod';
import type { FxDescriptor } from '../components/locker/fxDescriptor';

const hexColor = z.string().regex(/^#[a-f0-9]{6}$/i);
const paletteSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('solid') }).strict(),
  z.object({ mode: z.literal('gradient'), end: hexColor }).strict(),
  z.object({ mode: z.literal('rainbow') }).strict(),
]);
export type MovementPalette = z.infer<typeof paletteSchema>;

/** The parts of a parry colored on their own: while it is up, on a caught blow, on the stunned attacker. */
export const PARRY_PARTS = ['shield', 'catch', 'stun'] as const;
export type ParryPart = (typeof PARRY_PARTS)[number];
const parryPartSchema = z.object({
  /** Keeps the game's own colors for this part (an image stamp still applies). */
  original: z.boolean().default(false),
  /** The part's own color, used when the parts are not linked. */
  color: hexColor,
  palette: paletteSchema.default({ mode: 'solid' }),
}).strict();
export type ParryPartChoice = z.infer<typeof parryPartSchema>;
const parryPartsSchema = z.object({
  /** Linked parts all take the effect's color; unlinked ones their own. */
  linked: z.boolean(),
  shield: parryPartSchema,
  catch: parryPartSchema,
  stun: parryPartSchema,
}).strict();
export type ParryParts = z.infer<typeof parryPartsSchema>;

export const movementFxSchema = z.object({
  kind: z.enum(['dash', 'heavy-melee', 'parry']),
  color: hexColor,
  palette: paletteSchema.default({ mode: 'solid' }),
  /** Parry only: per-part colors. Absent (as on parries saved before parts) is every part linked. */
  parts: parryPartsSchema.nullable().default(null),
  /** The dash trail stamp, or the parry shield symbol. */
  image: z.string().max(750_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).nullable(),
  /** Parry only: the icon over a parried enemy. */
  stunImage: z.string().max(750_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/).nullable().default(null),
  brightness: z.number().min(.25).max(4).default(1),
  illuminated: z.boolean().default(false),
  outline: z.boolean().default(false),
  outlineColor: z.string().regex(/^#[a-f0-9]{6}$/i).default('#ffffff'),
}).strict()
  .refine((value) => !value.image || value.kind !== 'heavy-melee', 'Image stamps are for dash trails and the parry shield.')
  .refine((value) => !value.stunImage || value.kind === 'parry', 'A stun icon is a parry option.')
  .refine((value) => !value.parts || value.kind === 'parry', 'Part colors are a parry option.')
  .refine((value) => !value.parts || !PARRY_PARTS.every((part) => value.parts![part].original) || !!value.image || !!value.stunImage,
    'Every part keeps its original colors: nothing to change.');
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
/** The faithful runtime's preview of a movement effect on one hero (see previewMovementEngine). */
export interface MovementEnginePreview {
  key: string;
  data: import('./movementGameData').MovementGameData;
  /** Staged actors' own movement data (the parried attacker's heavy melee), by actor id. */
  actors?: Record<string, import('./movementGameData').MovementGameData>;
  /** The particle bundle (src/lib/particles/host/bundle.ts) and its texture directory, over grimoire-hero:. */
  bundleUrl: string;
  textureBaseUrl: string;
  /**
   * The bundle is the game's own: the renderer applies the choice to these systems (by bundle key) as the
   * bake would (src/lib/movementRecolour.ts). `stamp` is the texture header a stamp image takes.
   */
  recolour?: { systems: Record<string, import('./movementRecolour').RecolourSystem>; stamp: import('./particles/render/sheet').ParticleTextureInfo | null };
}

/** The `--part` specs vpkmerge takes for a parry's parts: an original part, or an unlinked part's own palette. */
export function parryPartArgs(parts: ParryParts | null): string[] {
  if (!parts) return [];
  return PARRY_PARTS.flatMap((part) => {
    const value = parts[part];
    if (value.original) return [`${part}=original`];
    if (parts.linked) return [];
    const spec = value.palette.mode === 'rainbow' ? 'rainbow' : value.palette.mode === 'gradient' ? `${value.color}:${value.palette.end}` : value.color;
    return [`${part}=${spec}`];
  });
}

/**
 * The `workshop movement` arguments that bake `choice` (after `--vpk` and before `--encode-vpk`), with
 * its stamp images written to the files `stamps` names.
 */
export function movementBakeArgs(choice: MovementFxChoice, stamps: { image?: string; stunImage?: string }): string[] {
  const args = ['--kind', choice.kind, '--color', choice.color];
  if (choice.palette.mode === 'gradient') args.push('--end-color', choice.palette.end);
  if (choice.palette.mode === 'rainbow') args.push('--rainbow');
  if (choice.kind !== 'heavy-melee') {
    args.push('--brightness', String(choice.brightness));
    if (choice.illuminated) args.push('--illuminated');
    if (choice.outline && choice.image) args.push('--outline-color', choice.outlineColor);
  }
  if (choice.image && stamps.image) args.push('--image', stamps.image);
  if (choice.stunImage && stamps.stunImage) args.push('--stun-image', stamps.stunImage);
  for (const spec of parryPartArgs(choice.parts)) args.push('--part', spec);
  return args;
}
