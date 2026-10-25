import { z } from 'zod';
import { TRIPPY_STYLES, TRIPPY_ANIMATION_STYLES } from '../types/mod';

export const trippySkinDraftSchema = z.object({
  style: z.enum(TRIPPY_STYLES), intensity: z.number().finite().min(0).max(1),
  phase: z.number().finite().min(0).max(1), scroll: z.number().finite().min(0).max(4),
  targets: z.enum(['all', 'body', 'weapons']),
}).strict();

export const heroColorDraftSchema = z.object({
  hue: z.number().finite().min(0).max(360), saturation: z.number().finite().min(0).max(3),
  brightness: z.number().finite().min(0.2).max(2), mode: z.enum(['hue', 'prism', 'gradient', 'trippy']), animated: z.boolean(),
  gradientPreset: z.string().max(100), customStops: z.array(z.object({
    pos: z.number().finite().min(0).max(1), hue: z.number().finite().min(0).max(360), sat: z.number().finite().min(0).max(1),
  }).strict()).min(2).max(16),
  trippyStyle: z.enum(TRIPPY_STYLES), trippyIntensity: z.number().finite().min(0).max(1),
  trippyPhase: z.number().finite().min(0).max(1), trippyAnimStyle: z.enum(TRIPPY_ANIMATION_STYLES),
  trippyAnimIntensity: z.number().finite().min(0).max(3), trippyTargets: z.enum(['all', 'abilities', 'weapons']),
}).strict();
