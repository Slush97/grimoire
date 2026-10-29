// Exports a hero's particle bundle (src/lib/particles/host/bundle.ts) for the renderer's faithful
// particle simulation: every definition in each discovered root's tree with its stored KV3 format,
// the snapshots they load, their textures as PNG with header and sheet, and the model the model
// functions and the control point binding read. Node only, no Electron: the main process and the
// dev export script share it. Reads go through the mounted package stack in priority order.

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
    type BundleDiagnostic,
    type BundleSystem,
    type BundleTexture,
    PARTICLE_BUNDLE_VERSION,
    type ParticleBundle,
    bundleSystemKey,
    bundleTextureFile,
} from '../../../src/lib/particles/host/bundle';
import { type KVObject, type KVValue, getArray, getString, isCollection } from '../../../src/lib/particles/kv';
import { type ParticleMaterialData, type SerializedModelMesh, particleResourceKey, readParticleMaterial, serializeModelMesh } from '../../../src/lib/particles/render/particleModels';
import { readParticleTextureInfo } from '../../../src/lib/particles/render/sheet';
import { type SerializedSnapshot, readSnapshotResource, serializeSnapshot } from '../../../src/lib/particles/snapshotResource';
import type { AmbientDiscovery } from './heroAmbientDiscovery';
import type { PackageStack, VpkmergeRunner } from './heroParticleSources';
import { exportParticleModelMesh } from './particleMeshExport';
import { readParticleModel } from './particleModelExport';

export const BUNDLE_FILENAME = 'bundle.json';
export const BUNDLE_TEXTURE_DIRNAME = 'tex';

const LIMITS = {
    systems: 160,
    textures: 128,
    models: 8,
    snapshotBytes: 4 * 1024 * 1024,
    textureBytes: 64 * 1024 * 1024,
    depth: 12,
};

const SYSTEM_PATH = /^particles\/[a-zA-Z0-9_./-]+\.vpcf$/;
const SNAPSHOT_PATH = /^particles\/[a-zA-Z0-9_./-]+\.vsnap$/;
const TEXTURE_PATH = /^(?:materials|models)\/[a-zA-Z0-9_./-]+\.vtex$/;
const MODEL_PATH = /^models\/[a-zA-Z0-9_./-]+\.vmdl$/;
const MATERIAL_PATH = /^(?:materials|models)\/[a-zA-Z0-9_./-]+\.vmat$/;

/** The models and override materials a definition's C_OP_RenderModels renderers name. */
function rendererModels(definition: KVObject): { models: string[]; materials: string[] } {
    const models = new Set<string>();
    const materials = new Set<string>();
    for (const renderer of (getArray(definition, 'm_Renderers') ?? []).filter(isCollection)) {
        if (getString(renderer, '_class') !== 'C_OP_RenderModels') continue;
        for (const entry of (getArray(renderer, 'm_ModelList') ?? []).filter(isCollection)) {
            const path = getString(entry, 'm_model')?.replace(/\\/g, '/');
            if (path && MODEL_PATH.test(path) && !path.includes('..')) models.add(path);
        }
        const material = getString(renderer, 'm_hOverrideMaterial')?.replace(/\\/g, '/');
        if (material && MATERIAL_PATH.test(material) && !material.includes('..')) materials.add(material);
    }
    return { models: [...models], materials: [...materials] };
}

/**
 * The texture each spritecard renderer draws when it names none, or leaves a colour group empty
 * (see buildTextureLayers). Always bundled for those renderers, as they are small.
 */
const RENDERER_DEFAULT_TEXTURES: Readonly<Record<string, string>> = {
    C_OP_RenderSprites: 'materials/particle/base_sprite.vtex',
    C_OP_RenderRopes: 'materials/particle/base_trail.vtex',
    C_OP_RenderTrails: 'materials/particle/base_trail.vtex',
};

/** Every texture a definition's renderers name, wherever in the renderer block, plus their defaults. */
function rendererTextures(definition: KVObject): string[] {
    const found = new Set<string>();
    for (const renderer of getArray(definition, 'm_Renderers') ?? []) {
        const fallback = isCollection(renderer) ? RENDERER_DEFAULT_TEXTURES[getString(renderer, '_class') ?? ''] : undefined;
        if (fallback) found.add(fallback);
    }
    const visit = (value: KVValue) => {
        if (typeof value === 'string') {
            const path = value.replace(/\\/g, '/');
            if (TEXTURE_PATH.test(path) && !path.includes('..')) found.add(path);
        } else if (Array.isArray(value)) value.forEach(visit);
        else if (isCollection(value)) Object.values(value).forEach(visit);
    };
    visit(getArray(definition, 'm_Renderers') ?? []);
    return [...found];
}

export interface ExportBundleOptions {
    /** World effects have no bound model. Supply their empty world binding explicitly. */
    modelBinding?: Awaited<ReturnType<typeof readParticleModel>>;
    hero: string;
    /** The directory the bundle is written to; its `tex/` is replaced. */
    outDir: string;
    vpkmerge: VpkmergeRunner;
}

export async function exportParticleBundle(stack: PackageStack, discovery: AmbientDiscovery, options: ExportBundleOptions): Promise<ParticleBundle> {
    const diagnostics: BundleDiagnostic[] = discovery.notes.map((message) => ({ kind: 'discovery', message }));
    const systems: Record<string, BundleSystem> = {};
    const snapshots: Record<string, SerializedSnapshot> = {};
    const textureOwners = new Map<string, string>();
    const modelPaths = new Set<string>();
    const materialPaths = new Set<string>();

    // Model metadata and the mip capability do not depend on the particle tree. Start them while
    // definitions decode, rather than making the texture export wait for all of these CLI calls.
    const modelResult = (async () => {
        if (options.modelBinding) return options.modelBinding;
        const modelBytes = stack.read(discovery.modelEntry);
        if (!modelBytes) throw new Error(`${discovery.modelEntry} is not in any mounted package.`);
        return readParticleModel(modelBytes, (resource) => stack.decodeLoose(resource), (path) => stack.decode(path));
    })();
    // Observe a failure immediately, including while another export stage is still awaiting a CLI.
    const modelReady = modelResult.then((value) => ({ value }), (error: unknown) => ({ error }));
    const mipSupport = stack.supportsMips();

    try {
    if (!(await stack.supportsFormat())) {
        diagnostics.push({
            kind: 'format-unknown',
            message: 'The bundled vpkmerge does not report stored KV3 formats (soundevents --with-format); every definition is upgraded from the oldest format, as the runtime does for an unknown one.',
        });
    }

    // Every definition in each root's tree, breadth first
    const queue = discovery.effects.map((effect) => ({ path: bundleSystemKey(effect.system), depth: 0 }));
    while (queue.length > 0) {
        const { path, depth } = queue.shift()!;
        if (path in systems || !SYSTEM_PATH.test(path) || path.includes('..')) continue;
        if (Object.keys(systems).length >= LIMITS.systems || depth > LIMITS.depth) {
            diagnostics.push({ kind: 'limit', message: `Skipped ${path}: the bundle holds at most ${LIMITS.systems} systems ${LIMITS.depth} levels deep.` });
            continue;
        }
        const decoded = await stack.decodeWithFormat(`${path}_c`);
        if (!decoded) {
            diagnostics.push({ kind: 'missing-system', message: `${path} is not in any mounted package.` });
            continue;
        }
        if (decoded.data._class !== 'CParticleSystemDefinition') {
            diagnostics.push({ kind: 'missing-system', message: `${path} is not a particle system definition.` });
            continue;
        }
        systems[path] = { data: decoded.data, format: decoded.format };

        for (const child of (getArray(decoded.data, 'm_Children') ?? []).filter(isCollection)) {
            const ref = getString(child, 'm_ChildRef');
            if (ref) queue.push({ path: bundleSystemKey(ref), depth: depth + 1 });
        }

        const snapshotPath = getString(decoded.data, 'm_hSnapshot')?.replace(/\\/g, '/');
        if (snapshotPath && !(snapshotPath in snapshots)) {
            if (!SNAPSHOT_PATH.test(snapshotPath) || snapshotPath.includes('..')) {
                diagnostics.push({ kind: 'missing-snapshot', message: `${path} names an invalid snapshot path.` });
            } else {
                const bytes = stack.read(`${snapshotPath}_c`);
                const data = bytes && bytes.length <= LIMITS.snapshotBytes ? await stack.decode(`${snapshotPath}_c`) : null;
                if (bytes && data) snapshots[snapshotPath] = serializeSnapshot(readSnapshotResource(bytes, data));
                else diagnostics.push({ kind: 'missing-snapshot', message: `${snapshotPath} is unavailable or exceeds ${LIMITS.snapshotBytes} bytes.` });
            }
        }

        const named = rendererModels(decoded.data);
        named.models.forEach((path) => modelPaths.add(path));
        named.materials.forEach((path) => materialPaths.add(path));

        for (const texture of rendererTextures(decoded.data)) {
            if (textureOwners.has(texture)) continue;
            if (textureOwners.size >= LIMITS.textures) {
                diagnostics.push({ kind: 'limit', message: `Skipped ${texture}: the bundle holds at most ${LIMITS.textures} textures.` });
                continue;
            }
            const owner = stack.owner(`${texture}_c`);
            if (owner) textureOwners.set(texture, owner);
            else diagnostics.push({ kind: 'missing-texture', message: `${texture} is not in any mounted package.` });
        }
    }

    // Model draw materials and overrides share the same decode and texture export path.
    const models: Record<string, SerializedModelMesh> = {};
    const materials: Record<string, ParticleMaterialData> = {};
    for (const path of [...modelPaths].slice(0, LIMITS.models)) {
        try {
            models[particleResourceKey(path)] = serializeModelMesh(await exportParticleModelMesh(stack, options.vpkmerge, `${path}_c`, join(options.outDir, '.models')));
            for (const primitive of models[particleResourceKey(path)].primitives) {
                if (primitive.material && MATERIAL_PATH.test(primitive.material) && !primitive.material.includes('..')) materialPaths.add(primitive.material);
            }
        } catch (error) {
            diagnostics.push({ kind: 'missing-model', message: `${path}: ${String(error)}` });
        }
    }
    if (modelPaths.size > LIMITS.models) diagnostics.push({ kind: 'limit', message: `Skipped ${modelPaths.size - LIMITS.models} particle models: the bundle holds at most ${LIMITS.models}.` });
    await fs.rm(join(options.outDir, '.models'), { recursive: true, force: true });
    for (const path of materialPaths) {
        const data = await stack.decode(`${path}_c`).catch(() => null);
        if (!data) {
            diagnostics.push({ kind: 'missing-model', message: `${path} is not in any mounted package.` });
            continue;
        }
        const material = readParticleMaterial(data);
        materials[particleResourceKey(path)] = material;
        for (const texture of Object.values(material.textureParams)) {
            if (!TEXTURE_PATH.test(texture) || texture.includes('..') || textureOwners.has(texture)) continue;
            if (textureOwners.size >= LIMITS.textures) {
                diagnostics.push({ kind: 'limit', message: `${texture}: the bundle holds at most ${LIMITS.textures} textures.` });
                continue;
            }
            const owner = stack.owner(`${texture}_c`);
            if (owner) textureOwners.set(texture, owner);
            else diagnostics.push({ kind: 'missing-texture', message: `${texture} is not in any mounted package.` });
        }
    }

    // The model the effects are bound to
    // Textures: the top mip decoded to PNG (and every stored mip when vpkmerge can write them, which
    // the renderer samples minified noise with), the header and sheet read from the compiled file
    const withMips = await mipSupport;
    if (!withMips && textureOwners.size > 0) {
        diagnostics.push({ kind: 'mips-unavailable', message: 'The bundled vpkmerge cannot export stored mips (panorama dump --mips); the renderer generates them from the top level.' });
    }
    const textureDir = join(options.outDir, BUNDLE_TEXTURE_DIRNAME);
    await fs.rm(textureDir, { recursive: true, force: true });
    await fs.mkdir(textureDir, { recursive: true });
    const textures: Record<string, BundleTexture> = {};
    const byOwner = new Map<string, string[]>();
    for (const [texture, owner] of textureOwners) byOwner.set(owner, [...(byOwner.get(owner) ?? []), texture]);
    const scratch = await fs.mkdtemp(join(options.outDir, 'decode-'));
    try {
        for (const [owner, group] of byOwner) {
            const decodedDir = join(scratch, String([...byOwner.keys()].indexOf(owner)));
            await options.vpkmerge.stdout(['panorama', 'dump', '--vpk', owner, '--out-dir', decodedDir, ...(withMips ? ['--mips'] : []),
                ...group.flatMap((texture) => ['--prefix', `${texture}_c`])]);
            for (const texture of group) {
                const bytes = stack.read(`${texture}_c`);
                const info = bytes && bytes.length <= LIMITS.textureBytes ? readParticleTextureInfo(bytes) : null;
                const png = join(decodedDir, texture.replace(/\.vtex$/, '.png'));
                if (!info || !(await fs.stat(png).then((stat) => stat.isFile(), () => false))) {
                    diagnostics.push({ kind: 'missing-texture', message: `${texture} could not be decoded.` });
                    continue;
                }
                const file = bundleTextureFile(texture);
                await fs.copyFile(png, join(textureDir, file));
                const mips = withMips ? await copyStoredMips(decodedDir, texture, textureDir, info.width, info.height) : null;
                if (withMips && mips === null) diagnostics.push({ kind: 'mips-unavailable', message: `${texture}: no stored mips were exported.` });
                textures[texture] = mips ? { file, info, mips } : { file, info };
            }
        }
    } finally {
        await fs.rm(scratch, { recursive: true, force: true });
    }

    const result = await modelReady;
    if ('error' in result) throw result.error;
    const { model, attachments } = result.value;
    const bundle: ParticleBundle = {
        version: PARTICLE_BUNDLE_VERSION,
        hero: options.hero,
        modelEntry: discovery.modelEntry,
        effects: discovery.effects,
        systems,
        snapshots,
        textures,
        ...(Object.keys(models).length > 0 ? { models } : {}),
        ...(Object.keys(materials).length > 0 ? { materials } : {}),
        model,
        attachments,
        diagnostics,
    };
    await fs.writeFile(join(options.outDir, BUNDLE_FILENAME), JSON.stringify(bundle));
    return bundle;
    } finally {
        // Callers can now remove the shared scratch directory even when another stage failed.
        await modelReady;
    }
}

/**
 * Copies the stored mip levels `panorama dump --mips` wrote for `texture` (`<stem>.mipN.png`, listed in
 * `<stem>.mips.json`) into the bundle, largest first. Null when the manifest is missing or its levels
 * do not halve down from the texture's size.
 */
async function copyStoredMips(decodedDir: string, texture: string, textureDir: string, width: number, height: number): Promise<string[] | null> {
    const stem = texture.replace(/\.vtex$/, '');
    const manifest = await fs.readFile(join(decodedDir, `${stem}.mips.json`), 'utf8').then((text) => JSON.parse(text) as unknown, () => null);
    const levels = isCollection(manifest as KVValue) ? (manifest as { levels?: unknown }).levels : null;
    if (!Array.isArray(levels) || levels.length === 0 || levels.length > 16) return null;
    const files: string[] = [];
    for (const [index, level] of levels.entries()) {
        const entry = level as { level?: unknown; width?: unknown; height?: unknown; path?: unknown };
        if (entry.level !== index || entry.width !== Math.max(1, width >> index) || entry.height !== Math.max(1, height >> index)
            || entry.path !== `${stem}.mip${index}.png`) return null;
        const file = bundleTextureFile(texture, index);
        await fs.copyFile(join(decodedDir, entry.path), join(textureDir, file));
        files.push(file);
    }
    return files;
}
