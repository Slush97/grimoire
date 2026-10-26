import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { z } from 'zod';
import { withHeroSkinSource } from './heroPoseModels';
import { runVpkmerge, runVpkmergeStdout, verifyVpkOutput } from './modMerger';
import { exportVpkFileName, exportVpkViaDialog } from './foundryExport';
import { editedPartCount, skinPartLabel, skinTintVector } from '../../../src/lib/skinParts';
import { hasColorAdjustments, ORIGINAL_SKIN_COLOR } from '../../../src/lib/skinColorAdjustments';
import { skinModelForms, type SkinModelForm } from '../../../src/lib/skinModelForms';
import type { SkinEditInfo, SkinEditSource, SkinEditExport, SkinEditProgress, SkinPart } from '../../../src/types/skinEditor';
import type { VpkExportResult } from '../../../src/types/foundry';

export { skinEditSourceSchema, skinEditExportSchema } from '../../../src/lib/skinEditSchema';
import { skinEditSourceSchema, skinEditExportSchema } from '../../../src/lib/skinEditSchema';

const drawCallsSchema = z.object({ draw_calls: z.array(z.object({
    material: z.string().min(1), vertex_count: z.number().int().nonnegative(), index_count: z.number().int().nonnegative().optional(),
    mesh_index: z.number().int().nonnegative().optional(),
})) });

const modelFormsSchema = z.object({
    m_meshGroups: z.array(z.string()).default([]),
    m_refMeshGroupMasks: z.array(z.number().int().nonnegative()).default([]),
    m_nDefaultMeshGroupMask: z.number().int().nonnegative().default(0),
    m_materialGroups: z.array(z.object({ m_name: z.string(), m_materials: z.array(z.string()) })).default([]),
});

/** Match the exporter's authored body masks and material slots before inspecting capabilities. */
export function formDrawCalls(drawCalls: unknown, model: unknown, form: Pick<SkinModelForm, 'meshGroup' | 'materialGroup' | 'materialOverride'>) {
    const calls = drawCallsSchema.parse(drawCalls).draw_calls;
    const data = modelFormsSchema.parse(model);
    const group = form.meshGroup ? data.m_meshGroups.findIndex((name) => name === form.meshGroup || name.split('#&').at(-1) === form.meshGroup) : -1;
    if (form.meshGroup && group < 0) throw new Error('This skin does not contain the requested body group.');
    const mask = group >= 0 ? 2 ** group : data.m_nDefaultMeshGroupMask;
    const original = data.m_materialGroups[0]?.m_materials ?? [];
    const selected = form.materialGroup ? data.m_materialGroups.find((item) => item.m_name === form.materialGroup) : undefined;
    if (form.materialGroup && (!selected || selected.m_materials.length !== original.length)) throw new Error('This skin does not contain the requested material group.');
    const hideable = new Map<string, boolean>();
    return { draw_calls: calls.filter((call) => !mask || call.mesh_index === undefined
        || data.m_refMeshGroupMasks[call.mesh_index] === undefined
        || (BigInt(data.m_refMeshGroupMasks[call.mesh_index]) & BigInt(mask)) !== 0n).map((call) => {
        const slot = original.indexOf(call.material);
        const material = form.materialOverride ?? (slot >= 0 && selected ? selected.m_materials[slot] : call.material);
        hideable.set(material, !form.materialOverride && !(slot >= 0 && data.m_materialGroups.some((item) => item.m_materials[slot] !== call.material)));
        return { ...call, material };
    }), hideable };
}

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

async function inspect(vpk: string, base: string, form: SkinModelForm, withForms: boolean): Promise<SkinPart[]> {
    const entry = form.entry;
    let calls: unknown = JSON.parse(await runVpkmergeStdout([
        'model', 'edit', '--vpk', vpk, '--base', base, '--entry', entry, '--list-drawcalls', '--json',
    ]));
    let hideable = new Map<string, boolean>();
    if (withForms) {
        let metadata: unknown;
        for (const pak of new Set([vpk, base])) {
            try { metadata = JSON.parse(await runVpkmergeStdout(['soundevents', entry, '--from-vpk', pak])); break; }
            catch (error) { if (pak === base) throw error; }
        }
        const filtered = formDrawCalls(calls, metadata, form);
        calls = filtered;
        hideable = filtered.hideable;
    }
    const parts = partsFromDrawCalls(calls);
    const materialSchema = z.object({ m_shaderName: z.string(),
        m_intParams: z.array(z.object({ m_name: z.string(), m_nValue: z.number() })).default([]),
        m_vectorParams: z.array(z.object({ m_name: z.string() })),
        m_dynamicParams: z.array(z.object({ m_name: z.string() })).default([]),
        m_dynamicTextureParams: z.array(z.object({ m_name: z.string() })).default([]),
        m_textureParams: z.array(z.object({ m_name: z.string(), m_pValue: z.string() })).default([]),
    });
    for (const part of parts) {
        part.hideable = hideable.get(part.material) ?? true;
        for (const pak of new Set([vpk, base])) {
            try {
                const path = part.material.endsWith('_c') ? part.material : `${part.material}_c`;
                const material = materialSchema.parse(JSON.parse(await runVpkmergeStdout(['soundevents', path, '--from-vpk', pak])));
                part.tintable = material.m_shaderName === 'pbr.vfx'
                    && !material.m_dynamicParams.some((param) => param.m_name === 'g_vColorTint1');
                part.patternable = material.m_shaderName === 'pbr.vfx' && material.m_textureParams.some((param) => ['g_tColor', 'g_tColorA', 'g_tBaseColor', 'g_tAlbedo'].includes(param.m_name));
                part.finishable = material.m_shaderName === 'pbr.vfx' && !material.m_dynamicParams.some((param) => /Roughness|Metalness/.test(param.m_name));
                part.surfaceable = material.m_shaderName === 'pbr.vfx'
                    && material.m_textureParams.some((param) => param.m_name === 'g_tColor')
                    && !material.m_intParams.some((param) => param.m_name === 'F_ALPHA_TEST' && param.m_nValue !== 0)
                    && ![...material.m_dynamicParams, ...material.m_dynamicTextureParams].some((param) => /Opacity|Transluc|Alpha|Glass/i.test(param.m_name));
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
const textureBakeEnv = { RAYON_NUM_THREADS: process.env['RAYON_NUM_THREADS'] ?? '4' };

async function inspectSkinModels(heroName: string, source: { vpk: string; base: string; entry: string; fingerprint: string }): Promise<SkinEditInfo> {
    const key = JSON.stringify([heroName, source.base, source.entry, source.fingerprint]);
    const cached = skinInfoCache.get(key);
    if (cached) { skinInfoCache.delete(key); skinInfoCache.set(key, cached); return cached; }
    const pending = (async () => {
        const parts = new Map<string, SkinPart>();
        const forms = skinModelForms(heroName, source.entry);
        const available: NonNullable<SkinEditInfo['forms']> = [];
        for (const form of forms) {
            let inspected: SkinPart[];
            try { inspected = await inspect(source.vpk, source.base, form, forms.length > 1); }
            catch (error) {
                if (form.id === 'default') throw error;
                available.push({ id: form.id, available: false });
                continue;
            }
            available.push({ id: form.id, available: inspected.length > 0 });
            for (const part of inspected) {
                const previous = parts.get(part.material);
                if (previous) {
                    previous.modelEntries = [...new Set([...previous.modelEntries ?? [], form.entry])];
                    previous.formIds?.push(form.id);
                    previous.hideable &&= part.hideable ?? true;
                } else parts.set(part.material, { ...part, modelEntries: [form.entry], formIds: [form.id] });
            }
        }
        return { fingerprint: source.fingerprint, entry: source.entry, parts: [...parts.values()], forms: available };
    })();
    skinInfoCache.set(key, pending);
    while (skinInfoCache.size > 12) {
        const oldest = skinInfoCache.keys().next().value;
        if (oldest !== undefined) skinInfoCache.delete(oldest);
    }
    try { return await pending; }
    catch (error) { if (skinInfoCache.get(key) === pending) skinInfoCache.delete(key); throw error; }
}

export async function getSkinEditInfo(deadlockPath: string, input: SkinEditSource): Promise<SkinEditInfo> {
    const request = skinEditSourceSchema.parse(input);
    return withHeroSkinSource(deadlockPath, request.heroName, request.skinSources, async (source) => {
        return inspectSkinModels(request.heroName, source);
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
        if (!edit.hidden && edit.surface?.mode === 'ghost') throw new Error('Ghost surfaces are experimental and cannot be exported from the editor. Choose Translucent or Original.');
        if (edit.hidden && info.parts.some((part) => part.material === edit.material && part.hideable === false)) throw new Error('This part shares geometry with another form and cannot be hidden independently.');
        if (edit.finish && !info.parts.some((part) => part.material === edit.material && part.finishable)) throw new Error('This part does not support static material finishes.');
        if (!edit.hidden && edit.surface && !info.parts.some((part) => part.material === edit.material && part.surfaceable)) throw new Error('This part does not support static transparency.');
        if (edit.tint !== null && !info.parts.some((part) => part.material === edit.material && part.tintable)) {
            throw new Error('This material does not expose a supported static color tint.');
        }
        if ((edit.pattern || hasColorAdjustments(edit.adjustments)) && !info.parts.some((part) => part.material === edit.material && part.patternable)) throw new Error('This part does not support texture edits.');
        if (edit.hidden && [...materials].some((material) => material !== edit.material && material.toLowerCase().includes(edit.material.toLowerCase()))) {
            throw new Error('This material name also selects another part. Hiding it cannot be exported safely.');
        }
    }
    const forms = new Set(info.parts.flatMap((part) => part.formIds ?? part.modelEntries ?? [info.entry]));
    if ([...forms].some((form) => info.parts.filter((part) => (part.formIds ?? part.modelEntries ?? [info.entry]).includes(form))
        .every((part) => request.edits.some((edit) => edit.material === part.material && edit.hidden)))) {
        throw new Error('Keep at least one skin part visible.');
    }
}

/** Resolves to the model entry the overlay was built against. */
export async function buildSkinEditVpk(deadlockPath: string, input: SkinEditExport, out: string, onProgress?: (progress: SkinEditProgress) => void): Promise<string> {
    const request = skinEditExportSchema.parse(input);
    onProgress?.({ stage: 'inspect' });
    return withHeroSkinSource(deadlockPath, request.heroName, request.skinSources, async (source) => {
        const { parts } = await inspectSkinModels(request.heroName, source);
        validateSkinEdits({ ...source, parts }, request);
        const total = 1 + request.edits.reduce((count, edit) => count + (edit.hidden ? parts.find((part) => part.material === edit.material)?.modelEntries?.length ?? 1
            : Number(!!edit.pattern || hasColorAdjustments(edit.adjustments)) + Number(edit.tint !== null) + Number(!!edit.surface) + Number(!!edit.finish)), 0);
        let completed = 0;
        const advance = () => onProgress?.({ stage: 'build', completed: ++completed, total });
        onProgress?.({ stage: 'build', completed, total });
        const dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-skin-edit-'));
        try {
            const layers: string[] = [];
            const modelLayers = new Map<string, string>();
            let hiddenIndex = 0;
            for (const edit of request.edits.filter((item) => item.hidden)) {
                for (const entry of parts.find((part) => part.material === edit.material)?.modelEntries ?? [source.entry]) {
                    const layer = join(dir, `hidden-${hiddenIndex++}_dir.vpk`);
                    await runVpkmerge(['model', 'edit', '--vpk', modelLayers.get(entry) ?? source.vpk, '--base', source.base, '--entry', entry,
                        '--remove-material', edit.material, '--encode-vpk', layer]);
                    await verifyVpkOutput(layer);
                    modelLayers.set(entry, layer);
                    advance();
                }
            }
            layers.push(...modelLayers.values());
            const patternLayers = new Map<string, string>();
            for (const edit of request.edits.filter((item) => (item.pattern || hasColorAdjustments(item.adjustments)) && !item.hidden)) {
                const pattern = edit.pattern;
                const color = edit.adjustments ?? ORIGINAL_SKIN_COLOR;
                const layer = join(dir, `pattern-${layers.length}_dir.vpk`);
                await runVpkmerge(['trippy-skin', '--hero', request.heroName, '--vpk', source.vpk, '--base', source.base,
                    '--material', edit.material, '--style', pattern?.style ?? 'confetti', '--intensity', String(pattern?.intensity ?? 0),
                    '--phase', String(pattern?.phase ?? 0), '--scroll', String(pattern?.scroll ?? 0),
                    '--scale', String(pattern?.style === 'moo' ? pattern.scale ?? 1 : 1),
                    ...(pattern?.colors ? ['--palette', pattern.colors.join(',')] : []),
                    '--hue-shift', String(color.hue), '--saturation', String(color.saturation), '--brightness', String(color.brightness), '--encode-vpk', layer], 300000, textureBakeEnv);
                await verifyVpkOutput(layer);
                layers.push(layer);
                patternLayers.set(edit.material, layer);
                advance();
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
                patternLayers.set(edit.material, layer);
                advance();
            }
            for (const edit of request.edits.filter((item) => item.surface && !item.hidden)) {
                if (!edit.surface) continue;
                const layer = join(dir, `surface-${layers.length}_dir.vpk`);
                const paks = [...new Set([patternLayers.get(edit.material) ?? source.vpk, ...layers.slice().reverse(), source.vpk, source.base])];
                await runVpkmerge(['workshop', 'surface', ...paks.flatMap((pak) => ['--vpk', pak]), '--entry', edit.material,
                    '--mode', edit.surface.mode, '--opacity', String(edit.surface.opacity), '--encode-vpk', layer], 300000, textureBakeEnv);
                await verifyVpkOutput(layer);
                layers.push(layer);
                patternLayers.set(edit.material, layer);
                advance();
            }
            // Separate opacity first so finish edits change metalness without changing alpha.
            for (const edit of request.edits.filter((item) => item.finish && !item.hidden)) {
                if (!edit.finish) continue;
                const layer = join(dir, `finish-${layers.length}_dir.vpk`);
                const paks = [...new Set([patternLayers.get(edit.material) ?? source.vpk, ...layers.slice().reverse(), source.vpk, source.base])];
                await runVpkmerge(['workshop', 'finish', ...paks.flatMap((pak) => ['--vpk', pak]), '--entry', edit.material,
                    '--roughness', String(edit.finish.roughness), '--metalness', String(edit.finish.metalness), '--encode-vpk', layer], 300000, textureBakeEnv);
                await verifyVpkOutput(layer);
                layers.push(layer);
                advance();
            }
            if (layers.length === 1) await fs.copyFile(layers[0], out);
            else await runVpkmerge([out, ...layers]);
            await verifyVpkOutput(out);
            advance();
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
