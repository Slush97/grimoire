import { z } from 'zod';
import { TRIPPY_STYLES } from '../types/mod';

export const skinPartPatternSchema = z.object({
    colors: z.array(z.string().regex(/^#[a-f0-9]{6}$/i)).min(2).max(4).optional(),
    style: z.enum(TRIPPY_STYLES), intensity: z.number().finite().min(0).max(1),
    phase: z.number().finite().min(0).max(1), scroll: z.number().finite().min(0).max(4),
    scale: z.number().finite().min(0.25).max(8).optional(),
}).strict();

const skinSourcesSchema = (metaKey: RegExp) => z.array(z.object({
    metaKey: z.string().min(1).max(240).regex(metaKey).refine((key) => !key.includes('..')),
    priority: z.number().finite(),
}).strict()).max(64);

export const skinEditSourceSchema = z.object({
    heroName: z.string().min(1).max(100),
    skinSources: skinSourcesSchema(/^(?:addons\d*\/)?[^/\\:]+\.vpk$/i),
}).strict();

/** A Locker link may name Global skins. The editor reports those instead of editing them. */
export const skinEditLinkSchema = skinEditSourceSchema.extend({
    skinSources: skinSourcesSchema(/^(?:addons\d*\/|grimoire\/)?[^/\\:]+\.vpk$/i),
}).strict();

/** Global skins load from the priority root, above any overlay the editor can save. */
export function isGlobalSkinSource(source: { metaKey: string; priorityMod?: boolean }): boolean {
    return !!source.priorityMod || source.metaKey.startsWith('grimoire/');
}

const adjustmentsSchema = z.object({
    hue: z.number().finite().min(-180).max(180),
    saturation: z.number().finite().min(0).max(2),
    brightness: z.number().finite().min(0).max(2),
}).strict();

/** Numbers in one stroke seed's path: 255 more dabs after its own. */
export const STROKE_PATH_LENGTH = 765;

export const skinPartRegionSchema = z.object({
    id: z.string().regex(/^[a-z0-9]{1,16}$/),
    name: z.string().max(60).optional(),
    layout: z.string().regex(/^[a-f0-9]{8}$/).optional(),
    seeds: z.array(z.object({
        u: z.number().finite().min(-64).max(64), v: z.number().finite().min(-64).max(64), remove: z.literal(true).optional(),
        by: z.enum(['color', 'brush']).optional(), tolerance: z.number().finite().min(0).max(100).optional(),
        radius: z.number().finite().min(0).max(1000).optional(),
        path: z.array(z.number().finite().min(-1000).max(1000)).max(STROKE_PATH_LENGTH).refine((path) => path.length % 3 === 0).optional(),
        from: z.string().regex(/^[a-z0-9]{1,16}$/).optional(),
    }).strict()).max(4096),
    paint: z.string().regex(/^#[a-f0-9]{6}$/i).nullable().optional(),
    adjustments: adjustmentsSchema.optional(),
    pattern: skinPartPatternSchema.extend({ scroll: z.literal(0) }).nullable().optional(),
    finish: z.object({
        roughness: z.number().finite().min(0).max(1),
        metalness: z.number().finite().min(0).max(1),
    }).strict().optional(),
    glow: z.object({
        color: z.string().regex(/^#[a-f0-9]{6}$/i),
        animation: z.enum(['steady', 'pulse', 'rainbow']),
    }).strict().optional(),
}).strict();

export const regionMaskSchema = z.string().max(4_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);

export function regionMaskKey(material: string, region: string): string {
    return `${material}|${region}`;
}

export const skinEditExportSchema = skinEditSourceSchema.extend({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    edits: z.array(z.object({
        material: z.string().min(1).max(512),
        hidden: z.boolean(),
        tint: z.string().regex(/^#[a-f0-9]{6}$/i).nullable(),
        pattern: skinPartPatternSchema.nullable().optional(),
        adjustments: adjustmentsSchema.optional(),
        colorize: z.boolean().optional(),
        repaint: z.boolean().optional(),
        finish: z.object({
            roughness: z.number().finite().min(0).max(1),
            metalness: z.number().finite().min(0).max(1),
        }).strict().optional(),
        surface: z.object({
            mode: z.enum(['translucent', 'ghost']),
            opacity: z.number().finite().min(0).max(1),
        }).strict().optional(),
        regions: z.array(skinPartRegionSchema).max(16).optional(),
    }).strict()).max(256),
    regionMasks: z.record(regionMaskSchema).optional(),
}).strict();

export const skinThumbnailSchema = z.string().max(1_000_000).regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/);

export const skinEditSaveSchema = skinEditExportSchema.extend({
    name: z.string().trim().min(1).max(120), thumbnailDataUrl: skinThumbnailSchema.optional(),
}).strict();
