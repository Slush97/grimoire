import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { z } from 'zod';
import { withHeroSkinSource } from './heroPoseModels';
import { runVpkmerge, runVpkmergeStdout, verifyVpkOutput } from './modMerger';
import { exportVpkFileName, exportVpkViaDialog } from './foundryExport';
import { editedPartCount, skinPartLabel, skinTintVector } from '../../../src/lib/skinParts';
import { hasColorAdjustments, ORIGINAL_SKIN_COLOR } from '../../../src/lib/skinColorAdjustments';
import type { SkinEditInfo, SkinEditSource, SkinEditExport, SkinPart } from '../../../src/types/skinEditor';
import type { VpkExportResult } from '../../../src/types/foundry';

export { skinEditSourceSchema, skinEditExportSchema } from '../../../src/lib/skinEditSchema';
import { skinEditSourceSchema, skinEditExportSchema } from '../../../src/lib/skinEditSchema';

const drawCallsSchema = z.object({ draw_calls: z.array(z.object({
    material: z.string().min(1), vertex_count: z.number().int().nonnegative(), index_count: z.number().int().nonnegative().optional(),
})) });

export function partsFromDrawCalls(value: unknown): SkinPart[] {
    const calls = drawCallsSchema.parse(value).draw_calls;
    const parts = new Map<string, SkinPart>();
    for (const call of calls) {
        if (call.index_count === 0) continue;
        const part = parts.get(call.material) ?? { material: call.material, label: skinPartLabel(call.material), drawCalls: 0, vertices: 0, tintable: false, patternable: false };
        part.drawCalls++;
        part.vertices += call.vertex_count;
        parts.set(call.material, part);
    }
    return [...parts.values()].sort((a, b) => a.label.localeCompare(b.label));
}

async function inspect(vpk: string, base: string, entry: string): Promise<SkinPart[]> {
    const parts = partsFromDrawCalls(JSON.parse(await runVpkmergeStdout([
        'model', 'edit', '--vpk', vpk, '--base', base, '--entry', entry, '--list-drawcalls', '--json',
    ])));
    const materialSchema = z.object({ m_shaderName: z.string(),
        m_vectorParams: z.array(z.object({ m_name: z.string() })),
        m_dynamicParams: z.array(z.object({ m_name: z.string() })).default([]),
        m_textureParams: z.array(z.object({ m_name: z.string(), m_pValue: z.string() })).default([]),
    });
    for (const part of parts) {
        for (const pak of new Set([vpk, base])) {
            try {
                const path = part.material.endsWith('_c') ? part.material : `${part.material}_c`;
                const material = materialSchema.parse(JSON.parse(await runVpkmergeStdout(['soundevents', path, '--from-vpk', pak])));
                part.tintable = material.m_shaderName === 'pbr.vfx' && material.m_vectorParams.some((param) => param.m_name === 'g_vColorTint1')
                    && !material.m_dynamicParams.some((param) => param.m_name === 'g_vColorTint1');
                part.patternable = material.m_shaderName === 'pbr.vfx' && material.m_textureParams.some((param) => ['g_tColor', 'g_tColorA', 'g_tBaseColor', 'g_tAlbedo'].includes(param.m_name));
                const colorTexture = ['g_tColor', 'g_tColorA', 'g_tBaseColor', 'g_tAlbedo'].map((slot) => material.m_textureParams.find((param) => param.m_name === slot)).find(Boolean);
                if (colorTexture) {
                    try {
                        part.textureSize = z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).parse(JSON.parse(await runVpkmergeStdout([
                            'texture-info', '--vpk', vpk, '--base', base, '--entry', colorTexture.m_pValue,
                        ])));
                    } catch { /* A missing texture must not disable the other part controls. */ }
                }
                break;
            } catch { /* Try the base material before disabling its tint control. */ }
        }
    }
    return parts;
}

const skinInfoCache = new Map<string, Promise<SkinEditInfo>>();

export async function getSkinEditInfo(deadlockPath: string, input: SkinEditSource): Promise<SkinEditInfo> {
    const request = skinEditSourceSchema.parse(input);
    return withHeroSkinSource(deadlockPath, request.heroName, request.skinSources, async (source) => {
        const key = JSON.stringify([source.base, source.entry, source.fingerprint]);
        const cached = skinInfoCache.get(key);
        if (cached) { skinInfoCache.delete(key); skinInfoCache.set(key, cached); return cached; }
        const pending = inspect(source.vpk, source.base, source.entry).then((parts) => ({ fingerprint: source.fingerprint, entry: source.entry, parts }));
        skinInfoCache.set(key, pending);
        while (skinInfoCache.size > 12) {
            const oldest = skinInfoCache.keys().next().value;
            if (oldest !== undefined) skinInfoCache.delete(oldest);
        }
        try { return await pending; }
        catch (error) { if (skinInfoCache.get(key) === pending) skinInfoCache.delete(key); throw error; }
    });
}

export function validateSkinEdits(info: SkinEditInfo, request: SkinEditExport): void {
    if (info.fingerprint !== request.fingerprint) throw new Error('The source skin or game changed. Reload the editor before exporting.');
    if (editedPartCount(request.edits) === 0) throw new Error('No skin changes to export.');
    const materials = new Set(info.parts.map((part) => part.material));
    const seen = new Set<string>();
    for (const edit of request.edits) {
        if (!materials.has(edit.material) || seen.has(edit.material)) throw new Error('Unknown or repeated skin part.');
        seen.add(edit.material);
        if (edit.tint !== null && !info.parts.some((part) => part.material === edit.material && part.tintable)) {
            throw new Error('This material does not expose a supported static color tint.');
        }
        if ((edit.pattern || hasColorAdjustments(edit.adjustments)) && !info.parts.some((part) => part.material === edit.material && part.patternable)) throw new Error('This part does not support texture edits.');
        if (edit.hidden && [...materials].some((material) => material !== edit.material && material.toLowerCase().includes(edit.material.toLowerCase()))) {
            throw new Error('This material name also selects another part. Hiding it cannot be exported safely.');
        }
    }
    if (info.parts.every((part) => request.edits.some((edit) => edit.material === part.material && edit.hidden))) {
        throw new Error('Keep at least one skin part visible.');
    }
}

/** Resolves to the model entry the overlay was built against. */
export async function buildSkinEditVpk(deadlockPath: string, input: SkinEditExport, out: string): Promise<string> {
    const request = skinEditExportSchema.parse(input);
    return withHeroSkinSource(deadlockPath, request.heroName, request.skinSources, async (source) => {
        const parts = await inspect(source.vpk, source.base, source.entry);
        validateSkinEdits({ ...source, parts }, request);
        const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-skin-edit-'));
        try {
            const layers: string[] = [];
            let modelVpk = source.vpk;
            let hiddenIndex = 0;
            for (const edit of request.edits.filter((item) => item.hidden)) {
                const layer = join(dir, `hidden-${hiddenIndex++}_dir.vpk`);
                await runVpkmerge(['model', 'edit', '--vpk', modelVpk, '--base', source.base, '--entry', source.entry,
                    '--remove-material', edit.material, '--encode-vpk', layer]);
                await verifyVpkOutput(layer);
                modelVpk = layer;
            }
            if (modelVpk !== source.vpk) layers.push(modelVpk);
            const patternLayers = new Map<string, string>();
            for (const edit of request.edits.filter((item) => (item.pattern || hasColorAdjustments(item.adjustments)) && !item.hidden)) {
                const pattern = edit.pattern;
                const color = edit.adjustments ?? ORIGINAL_SKIN_COLOR;
                const layer = join(dir, `pattern-${layers.length}_dir.vpk`);
                await runVpkmerge(['trippy-skin', '--hero', request.heroName, '--vpk', source.vpk, '--base', source.base,
                    '--material', edit.material, '--style', pattern?.style ?? 'confetti', '--intensity', String(pattern?.intensity ?? 0),
                    '--phase', String(pattern?.phase ?? 0), '--scroll', String(pattern?.scroll ?? 0),
                    '--hue-shift', String(color.hue), '--saturation', String(color.saturation), '--brightness', String(color.brightness), '--encode-vpk', layer]);
                await verifyVpkOutput(layer);
                layers.push(layer);
                patternLayers.set(edit.material, layer);
            }
            for (const edit of request.edits.filter((item) => item.tint !== null && !item.hidden)) {
                if (edit.tint === null) continue;
                const tintSource = patternLayers.get(edit.material) ?? source.vpk;
                const layer = join(dir, `tint-${layers.length}_dir.vpk`);
                await runVpkmerge(['vmat', '--vpk', tintSource, '--base', source.base,
                    '--entry', edit.material.endsWith('_c') ? edit.material : `${edit.material}_c`,
                    '--set-vec', `g_vColorTint1=${skinTintVector(edit.tint).join(',')},0`, '--set-int', `g_nTextureColorTintMode1=${edit.colorize === false ? 0 : 1}`, '--encode-vpk', layer]);
                await verifyVpkOutput(layer);
                layers.push(layer);
            }
            if (layers.length === 1) await fs.copyFile(layers[0], out);
            else await runVpkmerge([out, ...layers]);
            await verifyVpkOutput(out);
            return source.entry;
        } finally { await fs.rm(dir, { recursive: true, force: true }); }
    });
}

export async function exportSkinEdits(deadlockPath: string, input: unknown): Promise<VpkExportResult> {
    const request = skinEditExportSchema.parse(input);
    const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-skin-export-'));
    try {
        const out = join(dir, 'skin_dir.vpk');
        await buildSkinEditVpk(deadlockPath, request, out);
        return await exportVpkViaDialog(out, exportVpkFileName(`${request.heroName}_skin_overlay`));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
