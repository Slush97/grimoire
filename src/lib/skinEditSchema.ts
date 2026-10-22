import { z } from 'zod';
import { TRIPPY_STYLES } from '../types/mod';

export const skinPartPatternSchema = z.object({
    style: z.enum(TRIPPY_STYLES), intensity: z.number().finite().min(0).max(1),
    phase: z.number().finite().min(0).max(1), scroll: z.number().finite().min(0).max(4),
}).strict();

export const skinEditSourceSchema = z.object({
    heroName: z.string().min(1).max(100),
    skinSources: z.array(z.object({
        metaKey: z.string().min(1).max(240).regex(/^(?:addons\d*\/)?[^/\\:]+\.vpk$/i).refine((key) => !key.includes('..')),
        priority: z.number().finite(),
    }).strict()).max(64),
}).strict();

export const skinEditExportSchema = skinEditSourceSchema.extend({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    edits: z.array(z.object({
        material: z.string().min(1).max(512),
        hidden: z.boolean(),
        tint: z.string().regex(/^#[a-f0-9]{6}$/i).nullable(),
        pattern: skinPartPatternSchema.nullable().optional(),
        adjustments: z.object({
            hue: z.number().finite().min(-180).max(180),
            saturation: z.number().finite().min(0).max(2),
            brightness: z.number().finite().min(0).max(2),
        }).strict().optional(),
        colorize: z.boolean().optional(),
    }).strict()).max(256),
}).strict();

export const skinEditSaveSchema = skinEditExportSchema.extend({ name: z.string().trim().min(1).max(120) }).strict();
