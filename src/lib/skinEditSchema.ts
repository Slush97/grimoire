import { z } from 'zod';

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
    }).strict()).max(256),
}).strict();
