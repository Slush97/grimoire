import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { entityVec3, modelEntitySchema, sourceEntityMatrix } from './source2Entity';
import { exportParticleBundle } from './heroParticleBundle';
import { PackageStack, type VpkmergeRunner } from './heroParticleSources';
import type { MapParticle } from '../../../src/lib/mapParticles';
import type { ParticleBundle } from '../../../src/lib/particles/host/bundle';

const entity = modelEntitySchema.extend({
    classname: z.string().default(''), targetname: z.string().optional(), effect_name: z.string().optional(),
    start_active: z.boolean().optional(), tint_cp: z.number().int().min(-1).max(63).optional(), tint_cp_color: entityVec3.optional(),
    data_cp: z.number().int().min(-1).max(63).optional(), data_cp_value: entityVec3.optional(),
    snapshot_file: z.string().optional(), parentAttachmentName: z.string().optional(),
}).passthrough();

/** Resolve names only after all child lumps have been read. Never activate gameplay-triggered effects. */
export function readMapParticles(values: unknown[]): MapParticle[] {
    const entities = values.map(value => entity.parse(value));
    const named = new Map(entities.filter(item => item.targetname).map(item => [item.targetname, item]));
    return entities.flatMap((item, ordinal) => Object.entries(item).flatMap(([field, resource]) => {
        if (typeof resource !== 'string' || !/^particles\/[a-zA-Z0-9_./-]+\.vpcf(?:_c)?$/.test(resource) || resource.includes('..')) return [];
        const issues: string[] = [];
        if (item.classname !== 'info_particle_system' || field !== 'effect_name') issues.push(`Unsupported particle entity ${item.classname}.${field}: requires its game path driver.`);
        if (item.parentname) issues.push(`Unsupported entity parent ${item.parentname}.`);
        if (item.snapshot_file) issues.push(`Unsupported entity snapshot override ${item.snapshot_file}.`);
        const controlPoints: MapParticle['controlPoints'] = [];
        for (let index = 0; index < 64; index++) {
            const name = item[`cpoint${index}`];
            if (typeof name !== 'string' || !name) continue;
            const target = named.get(name);
            if (!target) { issues.push(`Missing control point ${index} target ${name}.`); continue; }
            if (target.parentname) issues.push(`Unsupported control point target parent ${target.parentname}.`);
            const parent = z.number().int().min(0).max(63).parse(item[`cpoint${index}_parent`] ?? 0);
            controlPoints.push({ index, matrix: sourceEntityMatrix(target), parent });
        }
        const points: MapParticle['values'] = [];
        if (item.tint_cp !== undefined && item.tint_cp >= 0) points.push({ index: item.tint_cp, value: item.tint_cp_color ?? [255, 255, 255] });
        if (item.data_cp !== undefined && item.data_cp >= 0) points.push({ index: item.data_cp, value: item.data_cp_value ?? [0, 0, 0] });
        return [{ id: `${ordinal}:${field}`, classname: item.classname, system: resource.replace(/_c$/, ''),
            startActive: item.start_active === true && item.StartDisabled !== true, matrix: sourceEntityMatrix(item), controlPoints, values: points, issues }];
    }));
}

export async function exportMapParticles(packages: string[], entities: MapParticle[], dir: string, runner: VpkmergeRunner): Promise<ParticleBundle> {
    const outDir = join(dir, 'particles');
    await fs.mkdir(outDir, { recursive: true });
    const scratch = await fs.mkdtemp(join(outDir, '.scratch-'));
    try {
        return await exportParticleBundle(new PackageStack(packages, runner, scratch), {
            heroKey: 'dl_hideout', modelEntry: '', notes: [],
            effects: [...new Set(entities.filter(item => item.issues.length === 0).map(item => item.system))].map((system, i) => ({ id: String(i), system,
                source: 'map-entity', evidence: 'dl_hideout entity lump effect_name', configuration: null, attachment: null, attachmentCp1: null })),
        }, { hero: 'dl_hideout', outDir, vpkmerge: runner, modelBinding: { model: { name: 'world', bones: [], hitboxSets: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } }, attachments: [] } });
    } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}

/** The bundle file of every light cookie a particle renderer names, by its texture path. */
export function particleLightCookies(bundle: Pick<ParticleBundle, 'systems' | 'textures'>): Record<string, string> {
    const cookies: Record<string, string> = {};
    for (const system of Object.values(bundle.systems)) {
        const renderers: unknown = (system.data as { m_Renderers?: unknown }).m_Renderers;
        for (const renderer of Array.isArray(renderers) ? renderers : []) {
            const path: unknown = (renderer as { m_hLightCookie?: unknown }).m_hLightCookie;
            const texture = typeof path === 'string' ? bundle.textures[path] : undefined;
            if (texture && /^[A-Za-z0-9_]+\.png$/.test(texture.file)) cookies[path as string] = `particles/tex/${texture.file}`;
        }
    }
    return cookies;
}
