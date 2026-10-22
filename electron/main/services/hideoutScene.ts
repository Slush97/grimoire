import { app } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { z } from 'zod';
import { getCitadelPath } from './deadlock';
import { runVpkmerge, runVpkmergeStdout } from './modMerger';
import type { HideoutSceneInfo, HideoutInstance } from '../../../src/types/skinEditor';

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const row = z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]);
const matrix = z.tuple([row, row, row]);
const worldSchema = z.object({
    m_worldNodes: z.array(z.object({ m_worldNodePrefix: z.string() })).max(256),
    m_entityLumps: z.array(z.string()).max(256),
});
const objectSchema = z.object({
    m_renderableModel: z.string(), m_vTransform: matrix.optional(),
    m_vTintColor: z.array(z.number().finite()).optional(),
    m_aggregateMeshes: z.array(z.object({ m_nDrawCallIndex: z.number().int().nonnegative(),
        m_bHasTransform: z.boolean(), m_vTintColor: vec3,
    })).optional(),
    m_fragmentTransforms: z.array(z.array(z.number().finite()).length(12)).optional(),
});
const nodeSchema = z.object({
    m_sceneObjects: z.array(objectSchema), m_aggregateSceneObjects: z.array(objectSchema),
    m_aggregateInstanceStreams: z.array(z.unknown()).optional(),
});
const entitySchema = z.object({
    m_childLumps: z.array(z.string()).optional(),
    m_entityKeyValues: z.array(z.object({ keyValues3Data: z.object({ values: z.object({
        classname: z.string().optional(), targetname: z.string().optional(), model: z.string().optional(),
        origin: vec3.optional(), angles: vec3.optional(),
    }) }).optional() })),
});
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const cacheSchema = z.object({ key: z.string(), anchor: vec3, heading: z.number().finite(),
    instances: z.array(z.object({ model: z.string(), primitive: z.number().int().nonnegative().nullable(), matrix: z.array(z.number()).length(16), tint: vec3 })),
    failures: z.array(z.string()), omissions: z.array(z.string()),
});

export function compiledMapEntry(path: string): string {
    const entry = path.replace(/\\/g, '/');
    if (!/^[a-zA-Z0-9_./-]+$/.test(entry) || entry.split('/').includes('..') || entry.startsWith('/')) throw new Error('Invalid map resource path.');
    return entry.endsWith('_c') ? entry : `${entry}_c`;
}

export function sourceMatrix(rows: z.infer<typeof matrix> | undefined): number[] {
    if (!rows) return [...identity];
    return [rows[0][0], rows[1][0], rows[2][0], 0, rows[0][1], rows[1][1], rows[2][1], 0,
        rows[0][2], rows[1][2], rows[2][2], 0, rows[0][3], rows[1][3], rows[2][3], 1];
}

export function hideoutCacheFile(key: string, name: string): string | null {
    if (!/^[a-f0-9]{24}$/.test(key) || !/^[a-f0-9]{24}\.glb$/.test(name)) return null;
    return join(app.getPath('userData'), 'viewer-scenes', key, name);
}

async function decode(vpk: string, entry: string): Promise<unknown> {
    // The pinned CLI's soundevents decoder projects any binary-KV3 DATA resource.
    return JSON.parse(await runVpkmergeStdout(['soundevents', compiledMapEntry(entry), '--from-vpk', vpk]));
}

async function validGlb(path: string): Promise<boolean> {
    try {
        const file = await fs.open(path, 'r');
        try {
            const header = Buffer.alloc(12);
            await file.read(header, 0, 12, 0);
            const stat = await file.stat();
            return header.toString('ascii', 0, 4) === 'glTF' && header.readUInt32LE(4) === 2 && header.readUInt32LE(8) === stat.size;
        } finally { await file.close(); }
    } catch { return false; }
}

const inFlight = new Map<string, Promise<HideoutSceneInfo>>();

export async function loadHideoutScene(deadlockPath: string): Promise<HideoutSceneInfo> {
    const citadel = getCitadelPath(deadlockPath);
    const map = join(citadel, 'maps', 'dl_hideout.vpk');
    const base = join(citadel, 'pak01_dir.vpk');
    const [mapStat, baseStat] = await Promise.all([fs.stat(map), fs.stat(base)]);
    const key = createHash('sha256').update(`hideout-v6:${map}:${mapStat.size}:${mapStat.mtimeMs}:${baseStat.size}:${baseStat.mtimeMs}`).digest('hex').slice(0, 24);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const work = build(map, base, key);
    inFlight.set(key, work);
    try { return await work; } finally { inFlight.delete(key); }
}

async function build(map: string, base: string, key: string): Promise<HideoutSceneInfo> {
    const dir = join(app.getPath('userData'), 'viewer-scenes', key);
    try {
        const cached = cacheSchema.parse(JSON.parse(await fs.readFile(join(dir, 'scene.json'), 'utf8')));
        await Promise.all(cached.instances.map((instance) => fs.access(join(dir, instance.model))));
        return cached;
    } catch { /* Missing or interrupted cache: rebuild from the installed map. */ }
    await fs.mkdir(dir, { recursive: true });
    const world = worldSchema.parse(await decode(map, 'maps/dl_hideout/world.vwrld'));
    const result: HideoutSceneInfo = { key, anchor: [0, 0, 0], heading: 0, instances: [], failures: [], omissions: ['mapLighting', 'layerBlending', 'mapEffects', 'dynamicProps'] };
    let spawnFound = false;
    const lumps = [...world.m_entityLumps];
    const visited = new Set<string>();
    while (lumps.length && visited.size < 256) {
        const lump = lumps.shift();
        if (!lump || visited.has(lump)) continue;
        visited.add(lump);
        const entities = entitySchema.parse(await decode(map, lump));
        lumps.push(...(entities.m_childLumps ?? []));
        for (const item of entities.m_entityKeyValues) {
            const entity = item.keyValues3Data?.values;
            if (entity?.classname === 'info_team_spawn' && entity.origin && entity.targetname?.includes('player_spawn')) {
                result.anchor = entity.origin;
                result.heading = entity.angles?.[1] ?? 0;
                spawnFound = true;
            }
        }
    }
    if (!spawnFound) throw new Error('Hideout player spawn was not found in this game build.');
    const models = new Map<string, string | null>();
    for (const worldNode of world.m_worldNodes) {
        const node = nodeSchema.parse(await decode(map, `${worldNode.m_worldNodePrefix}.vwnod`));
        if (node.m_aggregateInstanceStreams?.length) result.omissions.push('instanceStreams');
        for (const object of [...node.m_sceneObjects, ...node.m_aggregateSceneObjects]) {
            if (!object.m_renderableModel) continue;
            const entry = compiledMapEntry(object.m_renderableModel);
            let model = models.get(entry);
            if (model === undefined) {
                const name = `${createHash('sha256').update(entry).digest('hex').slice(0, 24)}.glb`;
                try {
                    const out = join(dir, name);
                    if (!await validGlb(out)) {
                        await runVpkmerge(['model', 'export', '--vpk', map, '--base', base, '--entry', entry,
                            '--max-texture', '256', '--out', out]);
                        if (!await validGlb(out)) throw new Error('Invalid exported GLB.');
                    }
                    model = name;
                } catch {
                    model = null;
                    result.failures.push(entry);
                }
                models.set(entry, model);
            }
            if (!model) continue;
            const tint = object.m_vTintColor;
            const instance: HideoutInstance = { model, primitive: null, matrix: sourceMatrix(object.m_vTransform),
                tint: [tint?.[0] ?? 1, tint?.[1] ?? 1, tint?.[2] ?? 1] };
            if (object.m_aggregateMeshes) {
                let transformIndex = 0;
                for (const fragment of object.m_aggregateMeshes) {
                    let transform = [...identity];
                    if (fragment.m_bHasTransform) {
                        const values = object.m_fragmentTransforms?.[transformIndex++];
                        if (!values) { result.failures.push(`${entry}: missing fragment transform`); continue; }
                        transform = [values[0], values[4], values[8], 0, values[1], values[5], values[9], 0,
                            values[2], values[6], values[10], 0, values[3], values[7], values[11], 1];
                    }
                    result.instances.push({ ...instance, primitive: fragment.m_nDrawCallIndex, matrix: transform,
                        tint: [fragment.m_vTintColor[0] / 255, fragment.m_vTintColor[1] / 255, fragment.m_vTintColor[2] / 255] });
                }
            } else result.instances.push(instance);
        }
    }
    if (!result.instances.length) throw new Error('No hideout geometry could be exported.');
    result.omissions = [...new Set(result.omissions)];
    await fs.writeFile(join(dir, 'scene.json'), JSON.stringify(result));
    return result;
}
